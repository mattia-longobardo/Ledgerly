import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import { updatePreferences } from "@/modules/users/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { notificationsLog } from "@/platform/notifications/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { monthlySummaryJob } from "./jobs";
import { monthlyFigures } from "./monthly";

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

async function anAccount(ctx: Ctx, name = "ING"): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

function movement(overrides: Partial<IncomingTransaction>): IncomingTransaction {
  return {
    externalId: "w-1",
    counterpartExternalId: null,
    occurredAt: new Date("2026-08-10T09:00:00Z"),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Esselunga",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  };
}

/** The 1st of September, when the monthly tier runs and August is the month just ended. */
const NOW = new Date("2026-09-01T00:05:00+02:00");
/** A `MonthKey` is the first day of its month, not "YYYY-MM" (`platform/dates`). */
const AUGUST = "2026-08-01";

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("monthlyFigures", () => {
  it("reports the month's movements and the net worth at its end", async () => {
    const ctx = await newContext();
    const accountId = await anAccount(ctx);
    await saveBalanceEntry(ctx, accountId, { on: "2026-08-31", cents: 10_000_00n });
    await upsertFromProvider(ctx, accountId, [
      movement({}),
      movement({ externalId: "w-2", amountCents: 250_000n, type: "income", payee: "Payroll" }),
      // September: outside the month asked for, so it counts in neither total.
      movement({ externalId: "w-3", occurredAt: new Date("2026-09-02T09:00:00Z"), amountCents: -100n }),
    ]);

    const figures = await monthlyFigures(ctx, AUGUST, NOW);
    expect(figures.month).toBe(AUGUST);
    expect(figures.netWorthCents).toBe(10_000_00n);
    expect(figures.incomeCents).toBe(250_000n);
    expect(figures.expenseCents).toBe(-2_500n);
    expect(figures.transactions).toBe(2);
    expect(figures.accounts).toBe(1);
  });

  it("tells one person nothing about another", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const theirAccount = await anAccount(theirs, "Theirs");
    await saveBalanceEntry(theirs, theirAccount, { on: "2026-08-31", cents: 99_000_00n });
    const figures = await monthlyFigures(mine, AUGUST, NOW);
    expect(figures.netWorthCents).toBeNull();
    expect(figures.accounts).toBe(0);
  });
});

describe("monthlySummaryJob", () => {
  async function wants(ctx: Ctx, monthlySummary: boolean) {
    await updatePreferences(ctx, { ...DEFAULT_PREFERENCES, monthlySummary });
  }

  it("writes to nobody who has not asked for it", async () => {
    const ctx = await newContext();
    await wants(ctx, false);
    expect(await monthlySummaryJob.run()).toMatchObject({ wanted: 0, sent: 0 });
    expect(await getDb().select().from(notificationsLog)).toHaveLength(0);
  });

  it("claims the month once, so a second run does not write again", async () => {
    const ctx = await newContext();
    await wants(ctx, true);
    await anAccount(ctx);

    const first = await monthlySummaryJob.run();
    expect(first).toMatchObject({ wanted: 1 });
    const claims = await getDb().select().from(notificationsLog);
    expect(claims).toHaveLength(1);
    expect(claims[0].kind).toBe("monthly_summary");

    const second = await monthlySummaryJob.run();
    expect(second).toMatchObject({ wanted: 1, sent: 0 });
    expect(await getDb().select().from(notificationsLog)).toHaveLength(1);
  });

  it("visits everyone, and counts only those who asked", async () => {
    const asked = await newContext();
    await wants(asked, true);
    const second = await newContext();
    await wants(second, true);
    const quiet = await newContext();
    await wants(quiet, false);

    const detail = await monthlySummaryJob.run();
    expect(detail).toMatchObject({ users: 3, failed: 0, wanted: 2 });
    // One claim each for the two who asked, and none for the one who did not.
    const claimed = await getDb().select().from(notificationsLog);
    expect(claimed.map((row) => row.userId).sort()).toEqual([asked.userId, second.userId].sort());
  });
});
