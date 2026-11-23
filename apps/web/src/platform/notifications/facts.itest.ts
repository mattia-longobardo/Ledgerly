// The alerts of before R5e, on the service of R5e (acceptance 2): each still sends the same email,
// once, and is now also one open fact — never two for the same thing. An addon that is off has
// neither (acceptance 3), and an email the person turned off is not sent while the fact still shows.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveBalanceEntry, updateAccountSettings } from "@domain/modules/accounts/service";
import { setLimit } from "@domain/modules/budgets/service";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { DEFAULT_PREFERENCES } from "@domain/modules/users/rules";
import { setAddon, updatePreferences } from "@domain/modules/users/service";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import {
  findConnection,
  finishRun,
  recordRun,
  saveConnection,
  savePluginConnection,
  saveSchedule,
  type Connection,
} from "@domain/platform/integrations/service";
import {
  notificationPreferences,
  notifications,
  notificationsLog,
} from "@domain/platform/notifications/schema";
import { monthKey, today } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";
import { accountAlertsJob } from "@/modules/accounts/jobs";
import { budgetAlertsJob } from "@/modules/budgets/jobs";
import { reportConnection } from "@/platform/integrations/alerts";
import { monthlySummaryJob } from "@/platform/reports/jobs";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(resetDatabase);
afterAll(closeDatabase);

const open = async (userId: string) =>
  (await getDb().select().from(notifications).where(eq(notifications.userId, userId)))
    .filter((row) => row.resolvedAt === null)
    .map((row) => ({ event: row.event, subject: row.subject, params: row.params }));

const claims = async (userId: string) =>
  (await getDb().select().from(notificationsLog).where(eq(notificationsLog.userId, userId))).map(
    (row) => `${row.kind}:${row.key}`,
  );

describe("budget thresholds", () => {
  let ctx: Ctx;
  let accountId: string;
  let month: string;
  const spend = (cents: bigint) =>
    upsertFromProvider(ctx, accountId, [movement({ amountCents: -cents, occurredAt: new Date() })], {
      provider: WALLET_PROVIDER,
    });

  beforeEach(async () => {
    ctx = await newContext();
    accountId = await anAccount(ctx);
    month = monthKey(today(ctx.timeZone));
    await setLimit(ctx, { categoryId: null, accountId, month, cents: 10_000n });
  });

  it("are one fact per budget and month, at the highest threshold, with one email per threshold", async () => {
    const subject = `*|${accountId}|${month}`;
    await spend(9_000n);
    await budgetAlertsJob.run();
    await budgetAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([{ event: "budget_threshold", subject, params: { percent: 85 } }]);

    await spend(2_000n);
    await budgetAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([
      { event: "budget_threshold", subject, params: { percent: 100 } },
    ]);
    expect((await claims(ctx.userId)).sort()).toEqual([
      `budget_threshold:${subject}|100`,
      `budget_threshold:${subject}|85`,
    ]);
  });

  it("are closed when the budget is back under every threshold", async () => {
    await spend(9_000n);
    await budgetAlertsJob.run();
    await setLimit(ctx, { categoryId: null, accountId, month, cents: 100_000n });
    await budgetAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([]);
  });

  it("are neither a fact nor an email while Budgets is off", async () => {
    await setAddon(ctx, "budgets", false);
    await spend(9_000n);
    await budgetAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([]);
    expect(await claims(ctx.userId)).toEqual([]);
  });

  it("stay a fact, without an email, for a person who turned their email off", async () => {
    await getDb()
      .insert(notificationPreferences)
      .values({ userId: ctx.userId, event: "budget_threshold", inApp: true, email: false, device: false });
    await spend(9_000n);
    await budgetAlertsJob.run();
    expect(await open(ctx.userId)).toHaveLength(1);
    expect(await claims(ctx.userId)).toEqual([]);
  });
});

describe("a low balance", () => {
  it("is one fact and one email a week, and is closed when the balance is back", async () => {
    const ctx = await newContext();
    const accountId = await anAccount(ctx);
    await updateAccountSettings(ctx, accountId, {
      name: "ING Conto Arancio",
      type: "checking",
      currency: "EUR",
      color: null,
      reference: "",
      purpose: "",
      openedOn: null,
      notes: "",
      inNetWorth: true,
      inSnapshot: true,
      countsAsLiquid: true,
      lowBalanceCents: 50_000n,
      staleAfterHours: 36,
      reminder: "never",
      betweenEntries: "hold",
    });
    await saveBalanceEntry(ctx, accountId, { on: today(ctx.timeZone), cents: 10_000n });

    // No mail server in the tests: the claim of the log is what says the email left once.
    await accountAlertsJob.run();
    await accountAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([
      { event: "account_low_balance", subject: accountId, params: {} },
    ]);
    expect(await claims(ctx.userId)).toEqual([`low_balance:${accountId}`]);

    await saveBalanceEntry(ctx, accountId, { on: today(ctx.timeZone), cents: 90_000n });
    await accountAlertsJob.run();
    expect(await open(ctx.userId)).toEqual([]);
    expect(await claims(ctx.userId)).toEqual([]);
  });
});

describe("a connection", () => {
  const NOW = new Date("2026-11-15T12:00:00Z");
  const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
  const reread = async (ctx: Ctx, connection: Connection) =>
    (await findConnection(ctx, connection.id)) as Connection;
  async function run(ctx: Ctx, connection: Connection, error: string | null, at: Date) {
    const opened = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    const outcome = error === null ? {} : { error, cause: { kind: "network" } };
    await finishRun(ctx, opened.id, { counts: {}, ...outcome }, at);
  }

  it("failing is one fact, which goes when it is read again", async () => {
    const ctx = await newContext();
    const person = { id: ctx.userId, email: "p@example.test" };
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    await run(ctx, connection, null, minutes(-10));
    for (const step of [1, 2, 3, 4]) {
      await run(ctx, connection, "down", minutes(step));
      await reportConnection(person, ctx, await reread(ctx, connection), minutes(step));
    }
    expect(await open(ctx.userId)).toEqual([
      { event: "connection_failed", subject: connection.id, params: {} },
    ]);

    await run(ctx, connection, null, minutes(5));
    await reportConnection(person, ctx, await reread(ctx, connection), minutes(5));
    expect(await open(ctx.userId)).toEqual([]);
  });

  it("ending is one fact at a time: the 3-day warning replaces the 14-day one", async () => {
    const ctx = await newContext();
    const person = { id: ctx.userId, email: "p@example.test" };
    const days = (count: number) => minutes(count * 24 * 60);
    const connection = await savePluginConnection(ctx, {
      provider: "plugin:enablebanking",
      instanceKey: "IT:Alfa",
      credentials: { a: "1" },
      expiresAt: days(20),
    });
    await saveSchedule(
      ctx,
      connection.id,
      { rules: [{ kind: "times", times: ["07:10"], days: { kind: "every" } }] },
      NOW,
    );
    const report = async (at: Date) => {
      await run(ctx, connection, null, at);
      await reportConnection(person, ctx, await reread(ctx, connection), at);
    };
    const end = days(20).toISOString().slice(0, 10);

    await report(days(7));
    expect(await open(ctx.userId)).toEqual([
      {
        event: "connection_expiring",
        subject: `${connection.id}:14:${end}`,
        params: { days: 13, date: end },
      },
    ]);
    await report(days(18));
    expect(await open(ctx.userId)).toEqual([
      { event: "connection_expiring", subject: `${connection.id}:3:${end}`, params: { days: 2, date: end } },
    ]);
    expect(await claims(ctx.userId)).toHaveLength(2);
  });
});

describe("the monthly summary", () => {
  it("is one fact per month, for whoever asked for it", async () => {
    const asked = await newContext();
    await updatePreferences(asked, { ...DEFAULT_PREFERENCES, monthlySummary: true });
    const quiet = await newContext();
    await monthlySummaryJob.run();
    await monthlySummaryJob.run();
    const facts = await open(asked.userId);
    expect(facts.map((fact) => fact.event)).toEqual(["monthly_summary"]);
    expect(await open(quiet.userId)).toEqual([]);
    expect(
      await getDb()
        .select()
        .from(notificationsLog)
        .where(and(eq(notificationsLog.userId, asked.userId), eq(notificationsLog.kind, "monthly_summary"))),
    ).toHaveLength(1);
  });
});
