// Investments phase 2 (docs/design/investments.md §2, §1.3, §2.5): the engine through the service,
// against a real database — the `portfolio` points, the handover, the conversions, the synced
// formula with a reading and a reconciliation, and the one-writer rule Accounts enforces.
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, listBalanceEntries } from "@/modules/accounts/queries";
import {
  applyProviderAccounts,
  createAccount,
  saveBalanceEntry,
  saveProviderBalance,
} from "@/modules/accounts/service";
import { createFund } from "@/modules/funds/service";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { accountMovement, assetsService, engineService, manualService } from "../../../test/investments";
import { createTestUser } from "../../../test/users";
import {
  catalogView,
  investmentOperationsExport,
  investmentsHome,
  investmentsPnlView,
  investmentsPortfolio,
  serviceDetail,
} from "./queries";
import { parseDecimal, PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentHoldings,
  investmentOperationRevisions,
  investmentSupersededEntries,
} from "./schema";
import {
  addAsset,
  confirmZeroReading,
  createManualService,
  deleteOperation,
  eligibleAccounts,
  InvestmentError,
  linkTransfer,
  rebuildAll,
  recordOperation,
  reconcileHolding,
  saveReading,
  unlinkTransfer,
  updateOperation,
  updateServiceValue,
} from "./service";
import { investmentEvents } from "./schema";

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const eur = (value: number) => BigInt(Math.round(value * 100));

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

let ctx: Ctx;
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

/** The `portfolio` points of an account, by day. */
async function points(accountId: string): Promise<Map<string, bigint>> {
  const rows = (await listBalanceEntries(ctx, accountId, 1000))
    .filter((row) => row.source === "portfolio")
    .sort((a, b) => (a.on < b.on ? -1 : 1));
  return new Map(rows.map((row) => [row.on, row.balanceCents]));
}

/**
 * Test only: moves a service's first period back to `from`, so dated examples of the design can be
 * replayed (the service always opens a period today), and optionally makes it synced.
 */
async function backdate(accountId: string, from: string, origin: "manual" | "synced" = "manual") {
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
    .set({ fromOn: from, startsAt: new Date(`${from}T00:00:00Z`), origin })
    .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
  await rebuildAll(ctx, accountId);
}

/** A service the module writes (`engineService`): the engine's examples need typed operations. */
async function newService(mode: "assets" | "total", name = "Directa") {
  return (await engineService(ctx, { name, category: "broker", currency: "EUR", mode })).accountId;
}

async function holdingId(accountId: string): Promise<string> {
  const detail = await serviceDetail(ctx, accountId);
  return detail?.holdings[0]?.id as string;
}

describe("a manual service is a view on its account in Accounts (§1.3, PERS-342)", () => {
  it("uses an existing account: its value is the balance, its money in and out the movements", async () => {
    const { accountId } = await manualService(ctx, { name: "Directa", category: "broker", currency: "EUR" });
    // Nothing written by the module: no point, no lock.
    expect(await points(accountId)).toEqual(new Map());
    await accountMovement(ctx, accountId, todayOn, eur(10_000));
    await accountMovement(ctx, accountId, todayOn, eur(-2_000));
    // A movement the provider stopped returning is no longer money in.
    await accountMovement(ctx, accountId, todayOn, eur(500), { removed: true });
    // Money in and no balance yet: no P&L, never a made-up one.
    let pnl = (await serviceDetail(ctx, accountId))?.summary.manualPnl;
    expect(pnl).toMatchObject({ valueCents: null, investedCents: eur(8_000), pnlCents: null, stale: true });
    await updateServiceValue(ctx, accountId, { on: todayOn, cents: eur(9_000) });
    const detail = await serviceDetail(ctx, accountId);
    pnl = detail?.summary.manualPnl;
    expect(pnl).toEqual({
      valueCents: eur(9_000),
      investedCents: eur(8_000),
      pnlCents: eur(1_000),
      rate: 0.125,
      valuedOn: todayOn,
      stale: false,
    });
    expect(detail?.summary.performance.gainCents).toBe(eur(1_000));
    // "Update value" is the account's own manual balance: Accounts and the service say the same.
    const entries = await listBalanceEntries(ctx, accountId);
    expect(entries.map((entry) => [entry.on, entry.source, entry.balanceCents])).toEqual([
      [todayOn, "manual", eur(9_000)],
    ]);
    const view = await accountsView(ctx);
    expect(view.rows.find((one) => one.account.id === accountId)?.balance).toBe(eur(9_000));
    expect(view.total).toBe(eur(9_000));
  });

  it("opens at the balance before its first day; the movements of that day count once", async () => {
    const account = await createAccount(ctx, { name: "Directa", type: "investment", currency: "EUR" });
    await saveBalanceEntry(ctx, account.id, { on: addDays(todayOn, -10), cents: eur(1_000) });
    await accountMovement(ctx, account.id, addDays(todayOn, -5), eur(300));
    await accountMovement(ctx, account.id, todayOn, eur(500));
    await saveBalanceEntry(ctx, account.id, { on: todayOn, cents: eur(1_500) });
    await createManualService(ctx, { accountId: account.id, category: "broker", url: null });
    const detail = await serviceDetail(ctx, account.id);
    expect(detail?.summary.mode).toBe("total");
    // Opening 1.000 (the balance of yesterday) + 500 in today; the 300 before the start is in the opening.
    expect(detail?.summary.manualPnl).toMatchObject({
      valueCents: eur(1_500),
      investedCents: eur(1_500),
      pnlCents: 0n,
    });
    // The account keeps every entry: nothing is archived or taken over.
    expect(await getDb().select().from(investmentSupersededEntries)).toEqual([]);
    expect((await listBalanceEntries(ctx, account.id)).map((entry) => entry.source)).toEqual([
      "manual",
      "manual",
    ]);
  });

  it("Fineco from Wallet: Wallet keeps writing the balance and the movements count; the value is not typed", async () => {
    // The bug: once a service, Fineco took no Wallet balance and its deposit counted nowhere.
    await applyProviderAccounts(ctx, "wallet", [
      {
        provider: "wallet",
        providerAccountId: "fineco",
        name: "Fineco",
        type: "investment",
        currency: "EUR",
      },
    ]);
    const [fineco] = (await accountsView(ctx)).rows.filter((one) => one.account.name === "Fineco");
    const accountId = fineco.account.id;
    await saveProviderBalance(ctx, accountId, { on: addDays(todayOn, -1), cents: 0n });
    const reasons = new Map((await eligibleAccounts(ctx)).map((one) => [one.account.id, one.reason]));
    expect(reasons.get(accountId)).toBeNull();
    await createManualService(ctx, { accountId, category: "broker", url: null });

    // The next Wallet pass: the deposit and the balance it brings.
    await accountMovement(ctx, accountId, todayOn, eur(8_000), { payee: "MATTIA LONGOBARDO" });
    await expect(
      saveProviderBalance(ctx, accountId, { on: todayOn, cents: eur(8_000) }),
    ).resolves.not.toBeNull();
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.summary.valueCents).toBe(eur(8_000));
    expect(detail?.summary.manualPnl).toMatchObject({
      valueCents: eur(8_000),
      investedCents: eur(8_000),
      pnlCents: 0n,
      valuedOn: todayOn,
    });
    const view = await accountsView(ctx);
    expect(view.rows.find((one) => one.account.id === accountId)?.balance).toBe(eur(8_000));
    // Counted once in the net worth.
    expect(view.total).toBe(eur(8_000));
    // Its value is Wallet's: not typed in Investments.
    await expect(updateServiceValue(ctx, accountId, { on: todayOn, cents: eur(1) })).rejects.toMatchObject({
      code: "not_editable",
    });
  });

  it("takes no operation of its own: money in and out are the account's", async () => {
    const { accountId } = await manualService(ctx, { name: "Directa", category: "broker", currency: "EUR" });
    for (const input of [
      { kind: "deposit" as const, on: todayOn, amountCents: eur(1) },
      { kind: "account_valuation" as const, on: todayOn, amountCents: eur(1) },
    ]) {
      await expect(recordOperation(ctx, accountId, input)).rejects.toMatchObject({ code: "not_editable" });
    }
    await expect(
      addAsset(ctx, accountId, {
        asset: { create: { class: "etf", name: "Vanguard FTSE All-World", symbol: "VWCE", currency: "EUR" } },
        on: todayOn,
        quantity: qty("1"),
        unitPrice: price("60"),
      }),
    ).rejects.toMatchObject({ code: "wrong_mode" });
  });

  it("an exchange is a crypto account, with its link", async () => {
    const { accountId } = await manualService(ctx, {
      name: "Ledger",
      category: "crypto",
      currency: "EUR",
      url: "ledger.com",
    });
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.summary.account.type).toBe("crypto");
    expect(detail?.summary.investment.url).toBe("https://ledger.com");
    expect(detail?.summary.valueCents).toBeNull();
  });
});

describe("§2.1 the Directa example, end to end", () => {
  async function directa() {
    const accountId = await newService("assets");
    await backdate(accountId, "2026-03-01");
    await recordOperation(ctx, accountId, { kind: "deposit", on: "2026-03-01", amountCents: eur(10000) });
    await addAsset(ctx, accountId, {
      asset: { create: { class: "etf", name: "Vanguard FTSE All-World", symbol: "VWCE", currency: "EUR" } },
      product: "custody",
      on: "2026-03-02",
      quantity: qty("100"),
      unitPrice: price("60"),
      feeCents: eur(2),
    });
    const holding = await holdingId(accountId);
    await recordOperation(ctx, accountId, {
      kind: "valuation",
      holdingId: holding,
      on: "2026-06-30",
      unitPrice: price("65"),
    });
    await recordOperation(ctx, accountId, {
      kind: "close",
      holdingId: holding,
      on: "2026-09-15",
      quantity: qty("100"),
      unitPrice: price("70"),
      feeCents: eur(2),
    });
    await recordOperation(ctx, accountId, { kind: "withdrawal", on: "2026-09-20", amountCents: eur(2000) });
    return accountId;
  }

  it("writes the table's values as portfolio points, plus every month end", async () => {
    const accountId = await directa();
    const written = await points(accountId);
    expect(written.get("2026-03-01")).toBe(eur(10000));
    expect(written.get("2026-03-02")).toBe(eur(9998));
    expect(written.get("2026-03-31")).toBe(eur(9998));
    expect(written.get("2026-06-30")).toBe(eur(10498));
    expect(written.get("2026-09-15")).toBe(eur(10996));
    expect(written.get("2026-09-20")).toBe(eur(8996));
    expect(written.get("2026-09-30")).toBe(eur(8996));
    expect([...written.keys()].every((on) => on <= todayOn)).toBe(true);
  });

  it("is idempotent: a full rebuild leaves every point as it was", async () => {
    const accountId = await directa();
    const before = await points(accountId);
    await rebuildAll(ctx, accountId);
    expect(await points(accountId)).toEqual(before);
  });

  it("rewrites from the day a change touches, never before it", async () => {
    const accountId = await directa();
    const before = await points(accountId);
    await recordOperation(ctx, accountId, { kind: "deposit", on: "2026-07-01", amountCents: eur(100) });
    const after = await points(accountId);
    for (const [on, cents] of before) {
      if (on < "2026-07-01") expect(after.get(on)).toBe(cents);
      else expect(after.get(on)).toBe(cents + eur(100));
    }
  });

  it("shows the holdings, flows and gain on the service page", async () => {
    const accountId = await directa();
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.summary.valueCents).toBe(eur(8996));
    expect(detail?.holdings).toEqual([]);
    expect(detail?.summary.performance.investedCents).toBe(eur(8000));
    expect(detail?.summary.performance.gainCents).toBe(eur(996));
    expect(detail?.operations[0].kind).toBe("withdrawal");
    const buy = detail?.operations.find((row) => row.kind === "buy");
    expect(buy?.legs.map((leg) => [leg.kind, leg.amountCents])).toEqual([
      ["buy", -eur(6000)],
      ["fee", -eur(2)],
    ]);
  });

  it("feeds the P&L home (U2): bars that add up to the hero, the value of each service, its colour", async () => {
    const accountId = await directa();
    const todayOn = today(ctx.timeZone);
    const year = await investmentsPnlView(ctx, {});
    expect(year.period).toMatchObject({ kind: "year", year: Number(todayOn.slice(0, 4)) });
    // The year to date is the gain of today: the service opened this year.
    expect(year.portfolio.parts?.pnlCents).toBe(eur(996));
    expect(year.barGrain).toBe("month");
    expect(year.intervals.at(-1)?.to).toBe(todayOn);
    const service = year.chart.find((one) => one.accountId === accountId)!;
    expect(service.bars).toHaveLength(year.intervals.length);
    expect(service.bars.reduce<bigint>((sum, cents) => sum + (cents ?? 0n), 0n)).toBe(eur(996));
    expect(service.values.at(-1)).toBe(eur(8996));
    expect(year.valueDays.at(-1)).toBe(todayOn);
    expect(year.colorIndex.has(accountId)).toBe(true);
    expect(year.firstOn).toBe("2026-03-01");

    // A quarter goes by week, and its bars still add up to its own P&L.
    const quarter = await investmentsPnlView(ctx, { from: addDays(todayOn, -80), to: todayOn });
    expect(quarter.barGrain).toBe("week");
    expect(quarter.valueGrain).toBe("day");
    const bars = quarter.chart.find((one) => one.accountId === accountId)!.bars;
    expect(bars.reduce<bigint>((sum, cents) => sum + (cents ?? 0n), 0n)).toBe(
      quarter.portfolio.parts?.pnlCents,
    );

    // "All" starts on the first day with data.
    const all = await investmentsPnlView(ctx, { period: "all" });
    expect(all.span.from).toBe("2026-03-01");
    expect(all.portfolio.parts?.pnlCents).toBe(eur(996));
  });

  it("feeds the home: totals, the chart over a window, the allocation by class and by service", async () => {
    const accountId = await directa();
    const home = await investmentsHome(ctx);
    expect(home.services.map((one) => one.account.id)).toEqual([accountId]);
    expect(home.totals).toMatchObject({
      valueCents: eur(8996),
      investedCents: eur(8000),
      gainCents: eur(996),
    });
    expect(home.byClass).toEqual([{ key: "cash", cents: eur(8996), share: 1 }]);
    expect(home.byService.map((slice) => slice.key)).toEqual(["Directa"]);
    // The catalog lists the manual services under "Manual account" (PERS-342: views on Accounts).
    const fineco = await manualService(ctx, { name: "Fineco", category: "broker", currency: "EUR" });
    const catalog = await catalogView(ctx);
    expect(catalog.providers.find((provider) => provider.id === "manual")?.connected).toEqual([
      { accountId: fineco.accountId, name: "Fineco" },
    ]);
  });

  it("refuses an asset in a total account, and an operation before the first period", async () => {
    const accountId = await newService("total");
    await expect(
      addAsset(ctx, accountId, {
        asset: { create: { class: "etf", name: "X", symbol: "XX", currency: "EUR" } },
        on: todayOn,
        quantity: qty("1"),
        unitPrice: price("1"),
      }),
    ).rejects.toMatchObject({ code: "wrong_mode" });
    await expect(
      recordOperation(ctx, accountId, { kind: "deposit", on: "2020-01-01", amountCents: eur(1) }),
    ).rejects.toMatchObject({ code: "before_period" });
    await expect(
      recordOperation(ctx, accountId, { kind: "deposit", on: addDays(todayOn, 1), amountCents: eur(1) }),
    ).rejects.toMatchObject({ code: "future_date" });
  });
});

describe("revisions (A2)", () => {
  it("an edit keeps the version before; a deletion keeps the last one", async () => {
    const accountId = await newService("total");
    await backdate(accountId, "2026-05-01");
    await recordOperation(ctx, accountId, {
      kind: "account_valuation",
      on: "2026-05-01",
      amountCents: eur(1000),
    });
    const { eventId } = await recordOperation(ctx, accountId, {
      kind: "deposit",
      on: "2026-05-10",
      amountCents: eur(100),
    });
    expect((await points(accountId)).get("2026-05-10")).toBe(eur(1100));

    await updateOperation(ctx, eventId, { kind: "deposit", on: "2026-05-05", amountCents: eur(300) });
    let written = await points(accountId);
    expect(written.get("2026-05-05")).toBe(eur(1300));
    expect(written.has("2026-05-10")).toBe(false);
    await expect(
      updateOperation(ctx, eventId, { kind: "withdrawal", on: "2026-05-05", amountCents: eur(1) }),
    ).rejects.toMatchObject({ code: "not_editable" });

    await deleteOperation(ctx, eventId);
    written = await points(accountId);
    expect(written.has("2026-05-05")).toBe(false);
    expect(written.get("2026-05-31")).toBe(eur(1000));

    const revisions = await getDb()
      .select()
      .from(investmentOperationRevisions)
      .where(eq(investmentOperationRevisions.eventId, eventId))
      .orderBy(asc(investmentOperationRevisions.changedAt));
    expect(revisions.map((row) => [row.reason, row.before.amountCents, row.before.on])).toEqual([
      ["edited", "10000", "2026-05-10"],
      ["deleted", "30000", "2026-05-05"],
    ]);
  });
});

describe("the accounts a service may use (§1.3)", () => {
  async function existing() {
    const account = await createAccount(ctx, { name: "Fineco", type: "investment", currency: "EUR" });
    await saveBalanceEntry(ctx, account.id, { on: todayOn, cents: eur(1500) });
    return account.id;
  }

  it("Accounts still takes a manual balance of a manual service, any day (PERS-342)", async () => {
    const accountId = await existing();
    await createManualService(ctx, { accountId, category: "broker", url: null });
    await expect(saveBalanceEntry(ctx, accountId, { on: todayOn, cents: eur(1) })).resolves.toBeTruthy();
    expect((await serviceDetail(ctx, accountId))?.summary.valueCents).toBe(eur(1));
  });

  it("a fund's valuation account and a service are not offered, and are refused", async () => {
    const fund = await createFund(ctx, {
      name: "Fideuram PAC",
      provider: null,
      isin: null,
      compartment: null,
      debitAccountId: null,
      debitDay: null,
      ter: null,
      startOn: "2026-01-01",
      monthlyCents: null,
      depositFeeCents: null,
      valuationAccountId: null,
    });
    const accountId = await existing();
    await createManualService(ctx, { accountId, category: "broker", url: null });
    const reasons = new Map((await eligibleAccounts(ctx)).map((one) => [one.account.id, one.reason]));
    expect(reasons.get(fund.valuationAccountId)).toBe("fund");
    expect(reasons.get(accountId)).toBe("managed");
    for (const id of [fund.valuationAccountId, accountId]) {
      await expect(
        createManualService(ctx, { accountId: id, category: "broker", url: null }),
      ).rejects.toMatchObject({
        code: "not_eligible",
      });
    }
  });
});

describe("§2.2 a synced account: example 2b with a reading and a reconciliation", () => {
  const earn = [
    { externalAccountId: "ext-1", product: "spot", complete: true },
    { externalAccountId: "ext-1", product: "funding", complete: true },
    { externalAccountId: "ext-1", product: "earn", complete: true },
  ];

  async function binance() {
    const { accountId } = await assetsService(ctx, {
      name: "Binance",
      category: "crypto",
      currency: "EUR",
      url: null,
    });
    await backdate(accountId, "2026-08-01", "synced");
    await addAsset(ctx, accountId, {
      asset: { create: { class: "crypto", name: "Ether", symbol: "ETHX", currency: "EUR" } },
      product: "earn",
      on: "2026-08-01",
      quantity: qty("0.5"),
      unitPrice: price("2400"),
    });
    const [holding] = await getDb().select().from(investmentHoldings);
    await recordOperation(ctx, accountId, {
      kind: "valuation",
      holdingId: holding.id,
      on: "2026-08-15",
      unitPrice: price("2600"),
    });
    const reading = (on: string, total: number, positions: number | null, scopes = earn) =>
      saveReading(ctx, accountId, {
        on,
        observedAt: new Date(`${on}T20:30:00Z`),
        status: "complete",
        totalCents: eur(total),
        positions:
          positions === null
            ? []
            : [
                {
                  assetId: holding.assetId,
                  product: "earn",
                  quantity: qty("0.5"),
                  price: null,
                  priceCurrency: "EUR",
                  priceSource: "provider",
                  valueCents: eur(positions),
                },
              ],
        scopes,
      });
    await reading("2026-08-15", 3100, null, earn.slice(0, 2));
    const { readingId } = await reading("2026-08-20", 4460, 1310);
    await reading("2026-08-21", 4470, 1320);
    return { accountId, holding, readingId };
  }

  it("adds the manual Earn position while no reading covers it", async () => {
    const { accountId } = await binance();
    expect((await points(accountId)).get("2026-08-15")).toBe(eur(4400));
  });

  it("an open conflict neither jumps nor counts twice; 'covered' rewrites from its day", async () => {
    const { accountId, holding, readingId } = await binance();
    let written = await points(accountId);
    expect(written.get("2026-08-20")).toBe(eur(4450));
    const detail = await serviceDetail(ctx, accountId);
    expect(detail?.holdings.find((row) => row.id === holding.id)?.conflict).toBe(true);
    expect(detail?.summary.warnings.conflicts).toBe(1);
    expect(detail?.coveredProducts).toEqual(["earn", "funding", "spot"]);

    await reconcileHolding(ctx, {
      holdingId: holding.id,
      kind: "covered_by_provider",
      effectiveOn: "2026-08-20",
      readingId,
    });
    written = await points(accountId);
    expect(written.get("2026-08-15")).toBe(eur(4400));
    expect(written.get("2026-08-20")).toBe(eur(4460));
    expect(written.get("2026-08-21")).toBe(eur(4470));
  });

  it("an empty reading that waits holds the value until it is confirmed (R5)", async () => {
    const { accountId, holding } = await binance();
    await reconcileHolding(ctx, {
      holdingId: holding.id,
      kind: "covered_by_provider",
      effectiveOn: "2026-08-20",
    });
    const { readingId } = await saveReading(ctx, accountId, {
      on: "2026-08-25",
      observedAt: new Date("2026-08-25T20:30:00Z"),
      status: "pending_zero",
      totalCents: 0n,
      positions: [],
      scopes: earn,
    });
    expect((await points(accountId)).get("2026-08-25")).toBe(eur(4470));
    await confirmZeroReading(ctx, readingId);
    expect((await points(accountId)).get("2026-08-25")).toBe(0n);
    await expect(confirmZeroReading(ctx, readingId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("one person's services are theirs alone", () => {
  it("another user can neither read nor write them", async () => {
    const accountId = await newService("total");
    const other = contextFor((await createTestUser()).id);
    expect(await serviceDetail(other, accountId)).toBeNull();
    await expect(
      recordOperation(other, accountId, { kind: "deposit", on: todayOn, amountCents: eur(1) }),
    ).rejects.toBeInstanceOf(InvestmentError);
    await expect(
      recordOperation(other, accountId, { kind: "account_valuation", on: todayOn, amountCents: eur(1) }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await eligibleAccounts(other)).toEqual([]);
  });

  it("a deleted account takes its service with it", async () => {
    const accountId = await newService("total");
    await getDb().execute(sql`delete from accounts where id = ${accountId}`);
    const rows = await getDb().select().from(investmentAccounts);
    expect(rows).toEqual([]);
  });
});

describe("§2.4 transfers between the person's services (A10)", () => {
  async function twoServices() {
    const make = (name: string) =>
      engineService(ctx, {
        name,
        category: "broker",
        currency: "EUR",
        url: null,
      });
    const a = await make("Directa");
    const b = await make("Fineco");
    await recordOperation(ctx, a.accountId, { kind: "deposit", on: todayOn, amountCents: eur(10_000) });
    await recordOperation(ctx, a.accountId, {
      kind: "account_valuation",
      on: todayOn,
      amountCents: eur(10_000),
    });
    const { eventId: withdrawal } = await recordOperation(ctx, a.accountId, {
      kind: "withdrawal",
      on: todayOn,
      amountCents: eur(2_000),
    });
    const { eventId: deposit } = await recordOperation(ctx, b.accountId, {
      kind: "deposit",
      on: todayOn,
      amountCents: eur(2_000),
    });
    await recordOperation(ctx, b.accountId, {
      kind: "account_valuation",
      on: todayOn,
      amountCents: eur(2_100),
    });
    return { a: a.accountId, b: b.accountId, withdrawal, deposit };
  }

  it("proposes the pair, links it, and leaves it out of the portfolio's flows only", async () => {
    const { a, b, withdrawal, deposit } = await twoServices();
    const detail = await serviceDetail(ctx, a);
    expect(detail?.transferProposals).toEqual([
      expect.objectContaining({
        withdrawalId: withdrawal,
        depositId: deposit,
        direction: "out",
        amountCents: -eur(2_000),
        other: expect.objectContaining({ accountId: b, accountName: "Fineco" }),
      }),
    ]);

    const before = await investmentsPortfolio(ctx);
    // Unlinked, the 2.000 € count as money out of Directa and new money into Fineco: 12.000 € in.
    expect(before.totals.gainCents).toBe(eur(100));
    expect(before.totals.simpleReturn).toBeCloseTo(100 / 12_000, 10);

    await linkTransfer(ctx, { withdrawalId: withdrawal, depositId: deposit });
    const after = await investmentsPortfolio(ctx);
    // Each account keeps the transfer as a flow (§2.4)…
    const byName = new Map(after.services.map((one) => [one.account.name, one]));
    expect(byName.get("Directa")?.performance.investedCents).toBe(eur(8_000));
    expect(byName.get("Fineco")?.performance.investedCents).toBe(eur(2_000));
    expect(byName.get("Fineco")?.performance.gainCents).toBe(eur(100));
    // …the portfolio does not: 10.000 € went in from outside, 10.100 € is there.
    expect(after.totals.valueCents).toBe(eur(10_100));
    expect(after.totals.investedCents).toBe(eur(10_000));
    expect(after.totals.gainCents).toBe(eur(100));
    expect(after.totals.simpleReturn).toBeCloseTo(0.01, 10);

    const linked = await serviceDetail(ctx, b);
    expect(linked?.transferProposals).toEqual([]);
    expect(linked?.operations.find((row) => row.id === deposit)?.transfer).toEqual({
      accountId: a,
      accountName: "Directa",
    });
    const exported = await investmentOperationsExport(ctx);
    expect(exported.find((row) => row.service === "Fineco" && row.kind === "deposit")?.transferWith).toBe(
      "Directa",
    );

    // A leg already linked cannot be linked again.
    await expect(linkTransfer(ctx, { withdrawalId: withdrawal, depositId: deposit })).rejects.toMatchObject({
      code: "not_a_transfer",
    });

    await unlinkTransfer(ctx, deposit);
    const groups = await getDb()
      .select({ id: investmentEvents.id, group: investmentEvents.transferGroupId })
      .from(investmentEvents)
      .where(eq(investmentEvents.userId, ctx.userId));
    expect(groups.every((row) => row.group === null)).toBe(true);
  });

  it("refuses a pair that is not a transfer: same account, other amount, two deposits", async () => {
    const { a, b, withdrawal, deposit } = await twoServices();
    const { eventId: other } = await recordOperation(ctx, a, {
      kind: "deposit",
      on: todayOn,
      amountCents: eur(2_000),
    });
    const { eventId: wrongAmount } = await recordOperation(ctx, b, {
      kind: "deposit",
      on: todayOn,
      amountCents: eur(1_999),
    });
    for (const input of [
      { withdrawalId: withdrawal, depositId: other },
      { withdrawalId: withdrawal, depositId: wrongAmount },
      { withdrawalId: deposit, depositId: other },
    ]) {
      await expect(linkTransfer(ctx, input)).rejects.toMatchObject({ code: "not_a_transfer" });
    }
    // Another person cannot link, nor even see, these operations.
    const stranger = contextFor((await createTestUser()).id);
    await expect(
      linkTransfer(stranger, { withdrawalId: withdrawal, depositId: deposit }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("frees the other leg when one is deleted", async () => {
    const { withdrawal, deposit } = await twoServices();
    await linkTransfer(ctx, { withdrawalId: withdrawal, depositId: deposit });
    await deleteOperation(ctx, deposit);
    const [left] = await getDb()
      .select({ group: investmentEvents.transferGroupId })
      .from(investmentEvents)
      .where(eq(investmentEvents.id, withdrawal));
    expect(left.group).toBeNull();
  });
});
