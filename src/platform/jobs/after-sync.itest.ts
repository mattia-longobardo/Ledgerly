// The checks that follow a sync (docs/scheduler.md, PERS-157), against a real database: they start
// when a sync changed the movements and only then, one alert however many syncs, and a check that
// fails stays with the check.
import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET_ALERT_KIND } from "@/modules/budgets/jobs";
import { setLimit } from "@/modules/budgets/service";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { dispatchDueConnections } from "@/platform/integrations/jobs";
import { PAPERLESS_PROVIDER } from "@/platform/integrations/rules";
import { integrationConnections } from "@/platform/integrations/schema";
import { finishRun, lastMovementChangeAt, recordRun, saveConnection } from "@/platform/integrations/service";
import { notificationsLog } from "@/platform/notifications/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { AFTER_SYNC_JOBS, runAfterSync } from "./after-sync";
import { withJobLock } from "./lock";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";

let ctx: Ctx;
let walletId: string;

/** One finished Wallet `transactions` run, as the engine leaves it. */
async function walletRun(counts: Record<string, number>, error?: string) {
  const run = await recordRun(ctx, { connectionId: walletId, kind: "transactions" });
  await finishRun(ctx, run.id, { counts, error });
}

const NEW_MOVEMENT = { created: 1, updated: 0, skipped: 0, removed: 0 };
const NOTHING_NEW = { created: 0, updated: 0, skipped: 12, removed: 0 };

async function runsOf(job: string) {
  return getDb().select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt));
}

/** A check that counts its runs and fails when asked to. */
function check(name: string, behaviour: () => void = () => {}) {
  const run = vi.fn(async () => {
    behaviour();
    return { ok: true };
  });
  const job: JobDefinition = { name, tier: "afterSync", run };
  return { job, run };
}

/** Makes Paperless due, so the dispatcher makes a real pass that does not call Wallet. */
async function makeDue() {
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: new Date(Date.now() - 30_000) })
    .where(eq(integrationConnections.provider, PAPERLESS_PROVIDER));
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        next: null,
        results: url.pathname === "/api/document_types/" ? [{ id: 48, name: "Payroll" }] : [],
      });
    }),
  );
  const wallet = await saveConnection(ctx, { provider: "wallet", credentials: { token: "t" } });
  walletId = wallet.id;
  // Wallet stays out of the dispatch, which would call the provider: its runs are written by hand.
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: null })
    .where(eq(integrationConnections.id, walletId));
  await saveConnection(ctx, {
    provider: PAPERLESS_PROVIDER,
    credentials: { baseUrl: "http://paperless-ngx:8000", token: "t", payslipType: "Payroll" },
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(closeDatabase);

describe("runAfterSync", () => {
  it("starts every check after a dispatch whose sync brought new movements", async () => {
    await walletRun(NEW_MOVEMENT);
    const detail = await dispatchDueConnections(new Date());
    expect(detail).toMatchObject({ checks: AFTER_SYNC_JOBS.length, failures: 0 });
    for (const job of AFTER_SYNC_JOBS) {
      expect(await runsOf(job.name), job.name).toMatchObject([{ tier: "minute", status: "success" }]);
    }
  });

  it("starts nothing after a sync with no change, or with no Wallet sync at all", async () => {
    expect(await dispatchDueConnections(new Date())).toMatchObject({ checks: 0, passes: 1 });
    await walletRun(NOTHING_NEW);
    expect(await lastMovementChangeAt()).toBeNull();
    await makeDue();
    expect(await dispatchDueConnections(new Date())).toMatchObject({ checks: 0 });
    expect(await getDb().select().from(jobRuns)).toHaveLength(0);
  });

  it("counts a movement changed or removed, and a failed pass that may have written rows", async () => {
    const { job, run } = check("counted");
    for (const counts of [
      { ...NOTHING_NEW, updated: 1 },
      { ...NOTHING_NEW, removed: 1 },
    ]) {
      await walletRun(counts);
      await runAfterSync("minute", { jobs: [job] });
    }
    await walletRun({}, "Wallet unreachable");
    await runAfterSync("minute", { jobs: [job] });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("runs a check once for one change, however many dispatches follow", async () => {
    const { job, run } = check("once");
    await walletRun(NEW_MOVEMENT);
    await runAfterSync("minute", { jobs: [job] });
    await walletRun(NOTHING_NEW);
    await runAfterSync("minute", { jobs: [job] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sends one budget alert for two syncs in a row", async () => {
    const accountId = await anAccount(ctx);
    const month = monthKey(today(ctx.timeZone));
    await setLimit(ctx, { categoryId: null, accountId, month, cents: 10_000n });
    await upsertFromProvider(ctx, accountId, [movement({ amountCents: -9_000n, occurredAt: new Date() })]);
    await walletRun(NEW_MOVEMENT);
    await runAfterSync("minute");
    await upsertFromProvider(ctx, accountId, [movement({ amountCents: -100n, occurredAt: new Date() })]);
    await walletRun(NEW_MOVEMENT);
    await runAfterSync("minute");
    expect(await runsOf("budgets-alerts")).toHaveLength(2);
    const claims = (await getDb().select().from(notificationsLog)).filter(
      (row) => row.kind === BUDGET_ALERT_KIND,
    );
    expect(claims.map((row) => row.key)).toEqual([`*|${accountId}|${month}|85`]);
  });

  it("keeps a failed check out of the sync, records it and repeats it at the next sync", async () => {
    let broken = true;
    const failing = check("failing", () => {
      if (broken) throw new Error("budgets exploded");
    });
    const after = check("after-it");
    await walletRun(NEW_MOVEMENT);
    const outcomes = await runAfterSync("minute", { jobs: [failing.job, after.job] });
    expect(outcomes).toEqual([
      { job: "failing", status: "failed" },
      { job: "after-it", status: "success" },
    ]);
    expect(await runsOf("failing")).toMatchObject([{ status: "failed", error: "budgets exploded" }]);

    // The next sync brings nothing new: the check that failed runs again, the other does not.
    broken = false;
    await walletRun(NOTHING_NEW);
    await runAfterSync("minute", { jobs: [failing.job, after.job] });
    expect(failing.run).toHaveBeenCalledTimes(2);
    expect(after.run).toHaveBeenCalledTimes(1);
    expect((await runsOf("failing")).map((row) => row.status)).toEqual(["success", "failed"]);
  });

  it("leaves a dispatch with a failing check a successful sync", async () => {
    await walletRun(NEW_MOVEMENT);
    // A database error in the check's own read must not reach the dispatcher either.
    const spy = vi.spyOn(AFTER_SYNC_JOBS[0], "run").mockRejectedValue(new Error("no"));
    const detail = await dispatchDueConnections(new Date());
    spy.mockRestore();
    expect(detail).toMatchObject({ failures: 0, passes: 1 });
    expect(await runsOf(AFTER_SYNC_JOBS[0].name)).toMatchObject([{ status: "failed", error: "no" }]);
  });

  it("records one user's failure as a failure, not as a success with a count", async () => {
    const job: JobDefinition = {
      name: "one-user",
      tier: "afterSync",
      run: async () => ({ users: 2, failed: 1 }),
    };
    await walletRun(NEW_MOVEMENT);
    expect(await runAfterSync("minute", { jobs: [job] })).toEqual([{ job: "one-user", status: "failed" }]);
    expect((await runsOf("one-user"))[0].error).toContain("one-user failed for 1 user(s)");
  });

  it("waits for a job in use, then runs it if it is still behind", async () => {
    const { job, run } = check("in-use");
    await walletRun(NEW_MOVEMENT);
    let release: () => void = () => {};
    const held = withJobLock("job:in-use", () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const outcomes = await runAfterSync("minute", {
      jobs: [job],
      sleep: async () => {
        release();
        await held;
      },
    });
    expect(outcomes).toEqual([{ job: "in-use", status: "success" }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("records a skip when the job stays in use, and the next sync runs it", async () => {
    const { job, run } = check("stuck");
    await walletRun(NEW_MOVEMENT);
    let release: () => void = () => {};
    const held = withJobLock("job:stuck", () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const outcomes = await runAfterSync("minute", { jobs: [job], busyWaitMs: 0 });
    expect(outcomes).toEqual([{ job: "stuck", status: "skipped" }]);
    expect(run).not.toHaveBeenCalled();
    release();
    await held;
    await walletRun(NOTHING_NEW);
    await runAfterSync("minute", { jobs: [job] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not throw when it cannot even read what is behind", async () => {
    const { job } = check("unread");
    await walletRun(NEW_MOVEMENT);
    const jobs = [{ ...job, name: "x\u0000y" }];
    await expect(runAfterSync("minute", { jobs })).resolves.toEqual([]);
  });
});
