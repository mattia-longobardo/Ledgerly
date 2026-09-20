// The guard of spec §7.6 against accruing on a balance nobody has just read, against a real
// Postgres (spec §11). Wallet itself is never called: `accrueDueRules` takes the pass as a
// function, and every test here hands it a fake that writes (or refuses to write) a reading.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts } from "@/modules/accounts/queries";
import { applyProviderAccounts, saveBalanceEntry, saveProviderBalance } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { deleteConnection, saveConnection } from "@/platform/integrations/service";
import { SyncBusyError, type WalletSyncResult } from "@/platform/integrations/wallet/sync";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, newContext } from "../../../test/fixtures";
import { accrueDueRules } from "./jobs";
import { interestAccruals } from "./schema";
import { createRule } from "./service";

/** 12:00 in Rome, which is the hour a rule with no hour of its own accrues at. */
const NOW = new Date("2026-09-15T10:00:00Z");
const HOUR = 60 * 60 * 1000;
const STALE = new Date(NOW.getTime() - 3 * HOUR);

const OLD_CENTS = 1_000_000n;
const NEW_CENTS = 2_000_000n;

let ctx: Ctx;
let syncedId: string;
let connectionId: string;
let todayOn: CivilDate;
let yesterday: CivilDate;

/** A pass that landed: the readings of the day being accrued and of today, stamped now. */
function landing(cents: bigint, calls: string[]) {
  return async (connection: string): Promise<WalletSyncResult> => {
    calls.push(connection);
    for (const on of [yesterday, todayOn]) {
      await saveProviderBalance(ctx, syncedId, { on, cents }, NOW);
    }
    return { accounts: {}, transactions: {}, refused: null };
  };
}

/** A rule on one account, from the day before yesterday, with its days cleared again. */
async function aRule(accountId: string): Promise<string> {
  const rule = await createRule(ctx, {
    accountId,
    taxRate: "0",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: addDays(yesterday, -1),
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });
  // `createRule` catches the rule up on the spot, on whatever balance is in hand: the pass under
  // test has to start from nothing, or it would find every day already accrued.
  await getDb().delete(interestAccruals).where(eq(interestAccruals.ruleId, rule.id));
  return rule.id;
}

async function daysOf(ruleId: string) {
  return getDb()
    .select({ on: interestAccruals.on, balanceCents: interestAccruals.balanceCents })
    .from(interestAccruals)
    .where(and(eq(interestAccruals.ruleId, ruleId)))
    .orderBy(interestAccruals.on);
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  todayOn = today(ctx.timeZone, NOW);
  yesterday = addDays(todayOn, -1);
  connectionId = (
    await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "wallet-token-x" } })
  ).id;
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    {
      provider: WALLET_PROVIDER,
      providerAccountId: "wa-saving",
      name: "Revolut Saving",
      type: "savings",
      currency: "EUR",
    },
  ]);
  syncedId = (await listAccounts(ctx))[0].id;
  // The reading in hand when the pass starts: three hours old, which is what "out of date" means.
  await saveProviderBalance(ctx, syncedId, { on: yesterday, cents: OLD_CENTS }, STALE);
});

afterAll(closeDatabase);

describe("accruing only on a balance that has just been read (spec §7.6)", () => {
  it("synchronises first and accrues on the reading that pass brought", async () => {
    const ruleId = await aRule(syncedId);
    const calls: string[] = [];

    const pass = await accrueDueRules(ctx, NOW, { sync: landing(NEW_CENTS, calls) });

    expect(calls).toEqual([connectionId]);
    expect(pass).toMatchObject({ rules: 1, stale: 0, reasons: [] });
    const days = await daysOf(ruleId);
    expect(days.at(-1)).toMatchObject({ on: yesterday, balanceCents: NEW_CENTS });
  });

  it("does not accrue at all when the pass fails, and says why", async () => {
    const ruleId = await aRule(syncedId);

    const pass = await accrueDueRules(ctx, NOW, {
      sync: async () => {
        throw new Error("Wallet could not be reached");
      },
    });

    expect(pass).toMatchObject({ rules: 0, stale: 1, reasons: ["sync_failed"] });
    // Not a day accrued on the three-hour-old reading: the days stay open for the next pass.
    expect(await daysOf(ruleId)).toEqual([]);
  });

  it("accrues a manual account without asking Wallet anything", async () => {
    const manualId = await anAccount(ctx, "Cassa");
    await saveBalanceEntry(ctx, manualId, { on: addDays(yesterday, -2), cents: OLD_CENTS });
    const ruleId = await aRule(manualId);

    const pass = await accrueDueRules(ctx, NOW, {
      sync: async () => {
        throw new Error("a manual account has nothing to synchronise");
      },
    });

    expect(pass).toMatchObject({ rules: 1, stale: 0 });
    expect((await daysOf(ruleId)).at(-1)).toMatchObject({ on: yesterday, balanceCents: OLD_CENTS });
  });

  it("asks for one pass per connection, however many rules are due on it", async () => {
    await aRule(syncedId);
    await aRule(syncedId);
    const calls: string[] = [];

    const pass = await accrueDueRules(ctx, NOW, { sync: landing(NEW_CENTS, calls) });

    expect(pass.rules).toBe(2);
    expect(calls).toEqual([connectionId]);
  });

  it("waits for the pass that already holds the lock instead of starting a second one", async () => {
    const ruleId = await aRule(syncedId);
    const calls: string[] = [];
    const other = landing(NEW_CENTS, []);

    const pass = await accrueDueRules(ctx, NOW, {
      sync: async (connection) => {
        calls.push(connection);
        throw new SyncBusyError();
      },
      // The pass that holds the lock lands while this one waits.
      sleep: async () => {
        await other(connectionId);
      },
      busyWaitMs: 10 * 1000,
      busyPollMs: 1,
    });

    expect(calls).toEqual([connectionId]);
    expect(pass).toMatchObject({ rules: 1, stale: 0 });
    expect((await daysOf(ruleId)).at(-1)).toMatchObject({ balanceCents: NEW_CENTS });
  });

  it("skips the rule when the pass holding the lock brings nothing in time", async () => {
    const ruleId = await aRule(syncedId);

    const pass = await accrueDueRules(ctx, NOW, {
      sync: async () => {
        throw new SyncBusyError();
      },
      sleep: async () => undefined,
      busyWaitMs: 0,
    });

    expect(pass).toMatchObject({ rules: 0, stale: 1, reasons: ["sync_busy"] });
    expect(await daysOf(ruleId)).toEqual([]);
  });

  it("skips a synced account with no connection to refresh it, rather than accruing on what is stored", async () => {
    const ruleId = await aRule(syncedId);
    const calls: string[] = [];
    await deleteConnection(ctx, connectionId);

    const pass = await accrueDueRules(ctx, NOW, { sync: landing(NEW_CENTS, calls) });

    expect(calls).toEqual([]);
    expect(pass).toMatchObject({ rules: 0, stale: 1, reasons: ["no_connection"] });
    expect(await daysOf(ruleId)).toEqual([]);
  });
});
