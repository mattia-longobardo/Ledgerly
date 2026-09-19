import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { removeAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { interestsAccrualJob } from "./jobs";
import { interestsView, ruleDetail, rulesOnAccount } from "./queries";
import { accruedInterest, createRule, InterestError, setRuleState, updateRule } from "./service";

let ctx: Ctx;
let accountId: string;

/** 10.000,00 € at 3,65 % on 365 days and no tax: exactly 1,00 € a day. */
function rule(overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    taxRate: "0",
    dayBasis: "365" as const,
    settlement: "monthly" as const,
    validFrom: "2026-01-01",
    validTo: "2026-03-31",
    payeeMatch: "interessi",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  accountId = await anAccount(ctx, "Revolut Saving");
  await saveBalanceEntry(ctx, accountId, { on: "2025-12-31", cents: 1_000_000n });
});

afterAll(closeDatabase);

describe("accrual and settlement (spec §7.6)", () => {
  it("accrues every day from the start and settles each closed month", async () => {
    const created = await createRule(ctx, rule());
    const detail = await ruleDetail(ctx, created.id);
    expect(
      detail.settlements.map((row) => [row.entry.periodFrom, row.entry.netCents, row.entry.settleOn]),
    ).toEqual([
      ["2026-03-01", 3_100n, "2026-04-01"],
      ["2026-02-01", 2_800n, "2026-03-01"],
      ["2026-01-01", 3_100n, "2026-02-01"],
    ]);
    expect(detail.days).toHaveLength(90);
    expect(await accruedInterest(ctx, accountId, "2026-01-01", "2026-01-31")).toBe(3_100n);
  });

  it("is idempotent, and a job run writes nothing twice", async () => {
    const created = await createRule(ctx, rule());
    await interestsAccrualJob.run();
    await interestsAccrualJob.run();
    const detail = await ruleDetail(ctx, created.id);
    expect(detail.settlements).toHaveLength(3);
    expect(detail.days).toHaveLength(90);
  });

  it("applies the tiers and the day basis", async () => {
    const created = await createRule(
      ctx,
      rule({
        validTo: "2026-01-31",
        dayBasis: "360",
        tiers: [
          { upToCents: 500_000n, annualRate: "0.036" },
          { upToCents: null, annualRate: "0" },
        ],
      }),
    );
    // 5.000 € × 3,6 % / 360 = 0,50 € a day; the rest earns nothing.
    expect((await ruleDetail(ctx, created.id)).settlements[0].entry.netCents).toBe(31n * 50n);
  });

  it("skips visibly the days with a negative or unknown balance, with no catching up", async () => {
    await saveBalanceEntry(ctx, accountId, { on: "2026-01-10", cents: -100n });
    await saveBalanceEntry(ctx, accountId, { on: "2026-01-20", cents: 1_000_000n });
    const created = await createRule(ctx, rule({ validTo: "2026-01-31" }));
    const detail = await ruleDetail(ctx, created.id);
    // 1–9 and 20–31 earn 1,00 € each; 10–19 are skipped.
    expect(detail.settlements[0]).toMatchObject({ accruedDays: 21, skippedDays: 10 });
    expect(detail.settlements[0].entry.netCents).toBe(2_100n);
    expect(detail.days.filter((day) => day.status === "negative_balance")).toHaveLength(10);
  });

  it("recomputes only what is not settled when the rule changes", async () => {
    const created = await createRule(ctx, rule({ validTo: null }));
    const before = await ruleDetail(ctx, created.id);
    await updateRule(
      ctx,
      created.id,
      rule({ validTo: null, tiers: [{ upToCents: null, annualRate: "0.073" }] }),
    );
    const after = await ruleDetail(ctx, created.id);
    expect(after.settlements.map((row) => row.entry.netCents)).toEqual(
      before.settlements.map((row) => row.entry.netCents),
    );
    // The month under way is never settled while it runs: its days are pending.
    const thisMonth = monthKey(today(ctx.timeZone));
    expect(before.settlements.some((row) => row.entry.periodFrom >= thisMonth)).toBe(false);
    expect(before.pendingCents).toBeGreaterThan(0n);
    expect(after.pendingCents).toBe(before.pendingCents * 2n);
  });

  it("accrues nothing while paused and catches up when resumed", async () => {
    const created = await createRule(ctx, rule({ state: "paused" }));
    expect((await ruleDetail(ctx, created.id)).days).toHaveLength(0);
    await setRuleState(ctx, created.id, "active");
    expect((await ruleDetail(ctx, created.id)).days).toHaveLength(90);
  });
});

describe("reconciliation (spec §7.6)", () => {
  it("matches the interest the bank paid, and tells a missing one", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({
        type: "income",
        amountCents: 3_101n,
        payee: "Interessi creditori",
        categoryName: "Interest",
        occurredAt: new Date("2026-02-03T10:00:00Z"),
      }),
    ]);
    const created = await createRule(ctx, rule());
    const byPeriod = new Map(
      (await ruleDetail(ctx, created.id)).settlements.map((row) => [row.entry.periodFrom, row]),
    );
    expect(byPeriod.get("2026-01-01")).toMatchObject({ paidCents: 3_101n, status: "matched" });
    expect(byPeriod.get("2026-02-01")).toMatchObject({ paidCents: 0n, status: "missing" });
  });

  it("settles a daily payout every day and matches each day's payment once", async () => {
    await upsertFromProvider(
      ctx,
      accountId,
      ["2026-01-02", "2026-01-03"].map((on) =>
        movement({
          type: "income",
          amountCents: 100n,
          payee: "Interessi",
          occurredAt: new Date(`${on}T10:00:00Z`),
        }),
      ),
    );
    const created = await createRule(ctx, rule({ settlement: "daily", validTo: "2026-01-03" }));
    const settlements = (await ruleDetail(ctx, created.id)).settlements;
    expect(
      settlements.map((row) => [row.entry.periodFrom, row.entry.netCents, row.paidCents, row.status]),
    ).toEqual([
      ["2026-01-03", 100n, 0n, "missing"],
      ["2026-01-02", 100n, 100n, "matched"],
      ["2026-01-01", 100n, 100n, "matched"],
    ]);
  });

  it("has no data without a text to look for", async () => {
    const created = await createRule(ctx, rule({ payeeMatch: "" }));
    expect((await ruleDetail(ctx, created.id)).settlements.every((row) => row.status === "no_data")).toBe(
      true,
    );
  });
});

describe("the rest of the page", () => {
  it("lists the rules with their year to date, and on the account", async () => {
    const created = await createRule(ctx, rule());
    const [row] = await interestsView(ctx);
    expect(row).toMatchObject({ accountName: "Revolut Saving", nextPayout: null });
    expect(row.accruedYtdCents).toBe(9_000n);
    expect(await rulesOnAccount(ctx, accountId)).toEqual([
      { id: created.id, tiers: [{ upToCents: null, annualRate: "0.036500" }] },
    ]);
  });

  it("refuses bad tiers, publishing from a manual account, and archives the account it is on", async () => {
    await expect(
      createRule(ctx, rule({ tiers: [{ upToCents: 100n, annualRate: "0.01" }] })),
    ).rejects.toMatchObject({
      code: "invalid_tiers",
    });
    await expect(createRule(ctx, rule({ mode: "post_to_provider" }))).rejects.toMatchObject({
      code: "not_synced",
    });
    await expect(createRule(ctx, rule({ validTo: "2025-01-01" }))).rejects.toThrow();
    await createRule(ctx, rule());
    expect(await removeAccount(ctx, accountId)).toBe("archived");
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, changes or puts a rule on another user's data", async () => {
    const created = await createRule(ctx, rule());
    const other = await newContext();
    expect(await interestsView(other)).toEqual([]);
    expect(await rulesOnAccount(other, accountId)).toEqual([]);
    expect(await accruedInterest(other, accountId, "2026-01-01", "2026-12-31")).toBeNull();
    for (const attempt of [
      () => ruleDetail(other, created.id),
      () => updateRule(other, created.id, rule()),
      () => setRuleState(other, created.id, "paused"),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(InterestError);
    }
    await expect(createRule(other, rule())).rejects.toMatchObject({ code: "invalid_account" });
  });
});
