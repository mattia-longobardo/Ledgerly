// Investments U3 (docs/design/investments-ux.md §3.5, §4.9): the Activity tab paged in the database —
// a stable order across pages, the counts of every chip — and the class of a correction, stored by
// the additive migration 0040 and read by the P&L engine.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { ACTIVITY_PAGE_SIZE, investmentsPnl, serviceActivity, servicePnlView } from "./queries";
import type { OperationKind } from "./rules";
import { investmentAccountPeriods, investmentAccounts, investmentOperations } from "./schema";
import { createManualService, insertEvent, rebuildAll, recordOperation } from "./service";

const eur = (value: number) => BigInt(Math.round(value * 100));

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});

afterAll(closeDatabase);

/** A manual service opened on `from` (the service always opens today; dated examples need it earlier). */
async function serviceFrom(from: string): Promise<{ accountId: string; investmentId: string }> {
  const { accountId } = await createManualService(ctx, {
    target: "new",
    name: "Directa",
    category: "broker",
    currency: "EUR",
    mode: "assets",
    url: null,
  });
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, accountId));
  await getDb()
    .update(investmentAccounts)
    .set({ managedSince: from })
    .where(eq(investmentAccounts.id, investment.id));
  await getDb()
    .update(investmentAccountPeriods)
    .set({ fromOn: from, startsAt: new Date(`${from}T00:00:00Z`) })
    .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
  return { accountId, investmentId: investment.id };
}

/** Events straight into the book, many at the same instant: the order must not depend on luck. */
async function seed(
  investmentId: string,
  rows: { on: string; kind: OperationKind; cents: bigint; note?: string }[],
) {
  await getDb().transaction(async (tx) => {
    for (const row of rows) {
      await insertEvent(ctx, tx, investmentId, {
        on: row.on,
        occurredAt: new Date(`${row.on}T12:00:00Z`),
        origin: "manual",
        note: row.note ?? null,
        legs: [{ leg: "main", kind: row.kind, amountCents: row.cents }],
      });
    }
  });
}

const query = (over: Partial<Parameters<typeof serviceActivity>[2]> = {}) => ({
  from: "2026-01-01",
  to: "2026-12-31",
  family: null,
  q: null,
  assetId: null,
  page: 1,
  ...over,
});

describe("the Activity tab (§3.5)", () => {
  async function busy() {
    const { accountId, investmentId } = await serviceFrom("2025-01-01");
    const day = (n: number) => `2026-0${1 + (n % 6)}-${String(1 + (n % 28)).padStart(2, "0")}`;
    await seed(investmentId, [
      // 2025: outside the year, inside "since the start".
      { on: "2025-03-01", kind: "deposit", cents: eur(1000) },
      { on: "2025-04-01", kind: "deposit", cents: eur(500) },
      // 2026: 70 deposits (ten of them on one day, at one instant), 20 fees, 10 withdrawals, 5 incomes.
      ...Array.from({ length: 70 }, (_, n) => ({
        on: n < 10 ? "2026-02-14" : day(n),
        kind: "deposit" as const,
        cents: eur(10),
      })),
      ...Array.from({ length: 20 }, (_, n) => ({
        on: day(n),
        kind: "fee" as const,
        cents: -eur(1),
        note: n === 0 ? "Overnight NVDA" : undefined,
      })),
      ...Array.from({ length: 10 }, (_, n) => ({ on: day(n), kind: "withdrawal" as const, cents: -eur(5) })),
      ...Array.from({ length: 5 }, (_, n) => ({ on: day(n), kind: "income" as const, cents: eur(2) })),
    ]);
    await rebuildAll(ctx, accountId);
    return accountId;
  }

  it("pages newest first, in the same order every time, with no row twice and none lost", async () => {
    const accountId = await busy();
    const first = await serviceActivity(ctx, accountId, query({ page: 1 }));
    const second = await serviceActivity(ctx, accountId, query({ page: 2 }));
    const third = await serviceActivity(ctx, accountId, query({ page: 3 }));
    expect(first?.total).toBe(105);
    expect(first?.pages).toBe(3);
    expect(first?.rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(third?.rows).toHaveLength(105 - 2 * ACTIVITY_PAGE_SIZE);
    const ids = [...first!.rows, ...second!.rows, ...third!.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(105);
    // Newest first by day; on a tie (the same instant), by id, descending: stable on every read.
    const days = [...first!.rows, ...second!.rows, ...third!.rows].map((row) => row.on);
    expect(days).toEqual([...days].sort().reverse());
    const again = await serviceActivity(ctx, accountId, query({ page: 2 }));
    expect(again?.rows.map((row) => row.id)).toEqual(second?.rows.map((row) => row.id));
    // A page past the last shows the last.
    expect((await serviceActivity(ctx, accountId, query({ page: 99 })))?.page).toBe(3);
  });

  it("counts every chip in the period, and a chip leaves its own rows", async () => {
    const accountId = await busy();
    const all = await serviceActivity(ctx, accountId, query());
    expect(all?.counts).toEqual({ all: 105, trades: 0, flows: 80, income: 5, fees: 20, other: 0 });
    expect(all?.allTime).toBe(107);
    expect(all?.months.reduce((sum, row) => sum + row.count, 0)).toBe(105);
    expect(all?.sums).toEqual({ depositsCents: eur(700), withdrawalsCents: -eur(50), feesCents: -eur(20) });

    const fees = await serviceActivity(ctx, accountId, query({ family: "fees" }));
    expect(fees?.total).toBe(20);
    expect(fees?.rows.every((row) => row.leg.kind === "fee")).toBe(true);
    // The counts of the chips stay those of the period: a chip does not hide the others' counts.
    expect(fees?.counts).toEqual(all?.counts);

    const searched = await serviceActivity(ctx, accountId, query({ q: "overnight" }));
    expect(searched?.total).toBe(1);
    expect(searched?.counts.fees).toBe(1);
    expect(searched?.rows[0].note).toBe("Overnight NVDA");

    const allTime = await serviceActivity(ctx, accountId, query({ from: null }));
    expect(allTime?.total).toBe(107);
  });

  it("is the person's own: another user's service is not found", async () => {
    const accountId = await busy();
    const other = { ...ctx, userId: (await createTestUser()).id };
    expect(await serviceActivity(other, accountId, query())).toBeNull();
  });
});

describe("the class of a correction (§4.9, migration 0040)", () => {
  it("is stored on the leg, `data` by default, and a capital one is a flow, not P&L", async () => {
    const { accountId } = await serviceFrom("2026-01-01");
    await recordOperation(ctx, accountId, { kind: "deposit", on: "2026-01-02", amountCents: eur(1000) });
    await recordOperation(ctx, accountId, {
      kind: "adjustment",
      on: "2026-03-01",
      amountCents: eur(120),
      note: "cash the provider missed",
    });
    const before = await servicePnlView(ctx, accountId, { period: "2026" });
    expect(before?.portfolio.services[0].local?.correctionsCents).toBe(eur(120));
    expect(before?.portfolio.services[0].local?.pnlCents).toBe(eur(120));

    await recordOperation(ctx, accountId, {
      kind: "adjustment",
      on: "2026-04-01",
      amountCents: eur(300),
      adjustmentClass: "capital",
      note: "a deposit never recorded",
    });
    const classes = await getDb()
      .select({ cls: investmentOperations.adjustmentClass })
      .from(investmentOperations)
      .where(eq(investmentOperations.kind, "adjustment"))
      .orderBy(investmentOperations.amountCents);
    expect(classes.map((row) => row.cls)).toEqual(["data", "capital"]);
    const after = await investmentsPnl(ctx, { period: "2026" });
    // The capital correction moves the value and the flows by the same amount: the P&L stays.
    expect(after.portfolio.services[0].local?.pnlCents).toBe(eur(120));
    expect(after.portfolio.services[0].local?.correctionsCents).toBe(eur(120));
  });

  it("is refused on any leg but a correction", async () => {
    const { investmentId } = await serviceFrom("2026-01-01");
    await seed(investmentId, [{ on: "2026-01-02", kind: "deposit", cents: eur(10) }]);
    await expect(
      getDb().execute(sql`update investment_operations set adjustment_class = 'data' where kind = 'deposit'`),
    ).rejects.toThrow();
  });
});
