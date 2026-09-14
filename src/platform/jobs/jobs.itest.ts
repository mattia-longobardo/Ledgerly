import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { POST } from "@/app/api/jobs/tick/route";
import { getDb } from "@/platform/db/client";
import { heartbeatAgeMs } from "./heartbeat";
import { withJobLock } from "./lock";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";
import { runTier } from "./tick";

const job = (name: string, run: JobDefinition["run"]): JobDefinition => ({ name, tier: "hourly", run });

describe("jobs", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("records success and failure independently and touches the heartbeat", async () => {
    const outcomes = await runTier("hourly", [
      job("ok", async () => ({ processed: 3 })),
      job("broken", async () => {
        throw new Error("provider down");
      }),
    ]);
    expect(outcomes).toEqual([
      { job: "ok", status: "success" },
      { job: "broken", status: "failed" },
    ]);
    const runs = await getDb().select().from(jobRuns).orderBy(jobRuns.job);
    expect(runs.map((r) => [r.job, r.status, r.error])).toEqual([
      ["broken", "failed", "provider down"],
      ["ok", "success", null],
    ]);
    expect(await heartbeatAgeMs()).toBeLessThan(5000);
  });

  it("skips a job that is already running elsewhere", async () => {
    let release: () => void = () => {};
    const held = withJobLock("job:slow", () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const outcomes = await runTier("hourly", [job("slow", async () => ({}))]);
    release();
    await held;
    expect(outcomes).toEqual([{ job: "slow", status: "skipped" }]);
    const [run] = await getDb()
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "slow"))
      .orderBy(desc(jobRuns.startedAt));
    expect(run.status).toBe("skipped");
  });

  it("answers 404 to a wrong secret or tier and runs a tier with the right one", async () => {
    const call = (tier: string, secret: string) =>
      POST(
        new Request(`http://localhost/api/jobs/tick?tier=${tier}`, {
          method: "POST",
          headers: { "x-cron-secret": secret },
        }),
      );
    expect((await call("daily", "wrong-secret-wrong")).status).toBe(404);
    expect((await call("weekly", "integration-cron-secret")).status).toBe(404);
    const ok = await call("daily", "integration-cron-secret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      tier: "daily",
      outcomes: [{ job: "housekeeping", status: "success" }],
    });
  });
});
