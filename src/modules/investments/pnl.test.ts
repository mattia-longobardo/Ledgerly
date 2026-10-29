import { describe, expect, it } from "vitest";
import { addDays } from "@/platform/dates";
import { NO_RATES, rateTable } from "@/platform/fx/rules";
import {
  type AdjustmentClass,
  type CoverageWindow,
  modifiedDietz,
  type PnlParts,
  periodOf,
  pnlOf,
  type PnlService,
  portfolioPnl,
  replayHoldings,
  type ServicePnl,
} from "./pnl";
import { contributionsOf } from "./positions";
import {
  type Book,
  type EventLike,
  flowsOn,
  type HoldingLike,
  type OperationLike,
  parseDecimal,
  performance,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type ReadingLike,
  valueOn,
} from "./rules";

// ——— Builders —————————————————————————————————————————————————————————————————————————————

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const eur = (value: number) => BigInt(Math.round(value * 100));

let seq = 0n;
function event(on: string, operations: Partial<OperationLike>[], extra: Partial<EventLike> = {}): EventLike {
  seq += 1n;
  return {
    id: `e${seq}`,
    on,
    occurredAt: new Date(`${on}T12:00:00Z`),
    seq,
    origin: "manual",
    transferGroupId: null,
    ...extra,
    operations: operations.map((op, index) => ({
      leg: index === 0 ? "main" : "fee",
      holdingId: null,
      kind: "deposit",
      quantity: null,
      unitPrice: null,
      priceCurrency: null,
      amountCents: 0n,
      fxRate: null,
      validUntil: null,
      ...op,
    })),
  };
}

const deposit = (on: string, amount: number, extra: Partial<EventLike> = {}) =>
  event(on, [{ kind: "deposit", amountCents: eur(amount) }], extra);
const withdrawal = (on: string, amount: number, extra: Partial<EventLike> = {}) =>
  event(on, [{ kind: "withdrawal", amountCents: -eur(amount) }], extra);
const buy = (on: string, holdingId: string, units: string, unit: string) =>
  event(on, [
    {
      kind: "buy",
      holdingId,
      quantity: qty(units),
      unitPrice: price(unit),
      priceCurrency: "EUR",
      amountCents: -eur(Number(units) * Number(unit)),
    },
  ]);
const sell = (on: string, holdingId: string, units: string, unit: string) =>
  event(on, [
    {
      kind: "sell",
      holdingId,
      quantity: qty(units),
      unitPrice: price(unit),
      priceCurrency: "EUR",
      amountCents: eur(Number(units) * Number(unit)),
    },
  ]);
const valuation = (on: string, holdingId: string, unit: string) =>
  event(on, [{ kind: "valuation", holdingId, unitPrice: price(unit), priceCurrency: "EUR" }]);
const accountValuation = (on: string, amount: number) =>
  event(on, [{ kind: "account_valuation", amountCents: eur(amount) }]);
const opening = (on: string, amount: number) =>
  event(on, [{ kind: "opening_cash", amountCents: eur(amount) }], { origin: "conversion" });
/** The opening of an account kept by value: its first valuation, a flow in (§2.4). */
const openingValue = (on: string, amount: number) =>
  event(on, [{ kind: "account_valuation", amountCents: eur(amount) }], { origin: "conversion" });

const holding = (id: string, currency = "EUR"): HoldingLike => ({
  id,
  assetId: `asset-${id}`,
  origin: "manual",
  product: "spot",
  currency,
});

function manual(events: EventLike[], extra: Partial<Book> = {}): Book {
  return {
    currency: "EUR",
    periods: [
      { fromOn: "2025-01-01", startsAt: new Date("2025-01-01T00:00:00Z"), mode: "assets", origin: "manual" },
    ],
    events,
    holdings: [holding("h1"), holding("h2")],
    readings: [],
    reconciliations: [],
    ...extra,
  };
}

function totalBook(events: EventLike[], fromOn = "2025-01-01"): Book {
  return manual(events, {
    periods: [{ fromOn, startsAt: new Date(`${fromOn}T00:00:00Z`), mode: "total", origin: "manual" }],
  });
}

function reading(on: string, total: number, extra: Partial<ReadingLike> = {}): ReadingLike {
  return {
    id: `r-${on}`,
    on,
    status: "complete",
    totalCents: eur(total),
    positions: [],
    scopes: [{ product: "spot", complete: true }],
    ...extra,
  };
}

function syncedBook(events: EventLike[], readings: ReadingLike[], fromOn = "2025-01-01"): Book {
  return {
    currency: "EUR",
    periods: [{ fromOn, startsAt: new Date(`${fromOn}T00:00:00Z`), mode: "assets", origin: "synced" }],
    events,
    holdings: [{ ...holding("h1"), origin: "provider" }],
    readings,
    reconciliations: [],
  };
}

/** A provider position of a reading, of the asset of holding `id`, in the `spot` product. */
function spot(id: string, units: string, value: number, cost?: number): ReadingLike["positions"][number] {
  return {
    assetId: `asset-${id}`,
    product: "spot",
    quantity: qty(units),
    valueCents: eur(value),
    costCents: cost === undefined ? null : eur(cost),
  };
}

function service(book: Book, extra: Partial<PnlService> = {}): PnlService {
  return {
    accountId: extra.accountId ?? "a1",
    currency: book.currency,
    book,
    rates: NO_RATES,
    coverage: null,
    quantityMismatch: false,
    externalIds: new Map(),
    ...extra,
  };
}

const EUR_DISPLAY = { currency: "EUR", rates: NO_RATES };

/** Σ of the additive parts (§4.2), the unknown unrealized counted as zero. */
function sumOf(parts: PnlParts): bigint {
  return (
    parts.realizedCents +
    (parts.unrealizedChangeCents ?? 0n) +
    parts.incomeCents +
    parts.feesCents +
    parts.correctionsCents +
    parts.fxCents +
    parts.unattributedCents
  );
}

function expectAdditive(pnl: ServicePnl) {
  expect(pnl.local).not.toBeNull();
  expect(sumOf(pnl.local!)).toBe(pnl.local!.pnlCents);
  if (pnl.display) expect(sumOf(pnl.display)).toBe(pnl.display.pnlCents);
}

const year = (y: number) => [`${y}-01-01`, `${y}-12-31`] as const;

// ——— The period ————————————————————————————————————————————————————————————————————————————

describe("periodOf (§1.2)", () => {
  const todayOn = "2026-10-29";
  it("defaults to the year running, to today", () => {
    expect(periodOf({}, todayOn)).toEqual({ kind: "year", year: 2026, from: "2026-01-01", to: todayOn });
    expect(periodOf({ period: "2030" }, todayOn).year).toBe(2026);
    expect(periodOf({ period: "nonsense" }, todayOn).year).toBe(2026);
  });
  it("reads a past year whole, and All", () => {
    expect(periodOf({ period: "2025" }, todayOn)).toEqual({
      kind: "year",
      year: 2025,
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(periodOf({ period: "all" }, todayOn)).toEqual({
      kind: "all",
      year: null,
      from: null,
      to: todayOn,
    });
  });
  it("lets days win over the period, and stops them today", () => {
    expect(periodOf({ period: "all", from: "2026-06-10", to: "2026-09-30" }, todayOn)).toMatchObject({
      kind: "custom",
      from: "2026-06-10",
      to: "2026-09-30",
    });
    expect(periodOf({ from: "2026-06-10", to: "2027-01-01" }, todayOn).to).toBe(todayOn);
    expect(periodOf({ from: "2026-09-30", to: "2026-06-10" }, todayOn).kind).toBe("year");
    expect(periodOf({ from: "2026-11-01", to: "2026-12-01" }, todayOn).kind).toBe("year");
    expect(periodOf({ from: "2026-13-01", to: "2026-12-01" }, todayOn).kind).toBe("year");
  });
});

// ——— Average cost (§4.4) ————————————————————————————————————————————————————————————————————

describe("replayHoldings (§4.4)", () => {
  it("keeps the cost that leaves at average cost, which holdingStates throws away", () => {
    const book = manual([
      deposit("2025-01-02", 400),
      buy("2025-01-03", "h1", "2", "100"),
      buy("2025-02-03", "h1", "1", "170"),
      sell("2025-03-03", "h1", "1.5", "180"),
    ]);
    const { exits, costs } = replayHoldings(book, "2025-12-31");
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({
      kind: "sell",
      proceedsCents: 27_000n,
      costCents: 18_500n,
      realizedCents: 8_500n,
    });
    expect(costs.get("h1")).toEqual({ quantity: qty("1.5"), costCents: 18_500n });
  });

  it("matches an eToro close with its opening by positionId, not the holding's average (§4.4)", () => {
    const open = (on: string, invested: number) =>
      event(
        on,
        [{ leg: "base", kind: "buy", holdingId: "h1", quantity: qty("1"), amountCents: -eur(invested) }],
        {
          origin: "provider",
        },
      );
    const close = (on: string, back: number) =>
      event(
        on,
        [{ leg: "base", kind: "close", holdingId: "h1", quantity: qty("1"), amountCents: eur(back) }],
        {
          origin: "provider",
        },
      );
    const a = open("2026-02-01", 100);
    const b = open("2026-03-01", 300);
    const closeA = close("2026-04-01", 130);
    const ids = new Map([
      [a.id, "trade:7001:open"],
      [b.id, "trade:7002:open"],
      [closeA.id, "trade:7001:close"],
    ]);
    const { exits } = replayHoldings(syncedBook([a, b, closeA], []), "2026-12-31", ids);
    // The average would say 130 − 200 = −70; eToro's own position made +30.
    expect(exits).toEqual([
      expect.objectContaining({ realizedCents: 3_000n, costCents: 10_000n, matched: "position" }),
    ]);
  });

  it("does not invent a cost for more than the book held", () => {
    const book = manual([sell("2025-03-03", "h1", "1", "50")]);
    expect(replayHoldings(book, "2025-12-31").exits[0].realizedCents).toBeNull();
  });
});

// ——— The P&L of a service, by hand (§4.1–§4.2) ———————————————————————————————————————————————

describe("pnlOf: cases by hand (§4.2)", () => {
  it("a purchase and a partial sale in the period: realized + unrealized = P&L", () => {
    const book = manual([
      deposit("2026-01-02", 1000),
      buy("2026-01-05", "h1", "10", "100"),
      sell("2026-03-01", "h1", "4", "120"),
      valuation("2026-06-30", "h1", "130"),
    ]);
    const pnl = pnlOf(service(book), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    expect(pnl.status).toBe("verified");
    expect(pnl.local).toMatchObject({
      pnlCents: 26_000n,
      realizedCents: 8_000n,
      unrealizedChangeCents: 18_000n,
      unattributedCents: 0n,
    });
    expectAdditive(pnl);
  });

  it("PERS-113 · 1: bought in 2025 at 100, worth 150 on 31/12, sold at 160 in 2026 → +10", () => {
    const book = manual([
      deposit("2025-01-02", 100),
      buy("2025-01-03", "h1", "1", "100"),
      valuation("2025-12-31", "h1", "150"),
      sell("2026-03-01", "h1", "1", "160"),
    ]);
    const pnl = pnlOf(service(book), ...year(2026), EUR_DISPLAY);
    expect(pnl.local).toMatchObject({
      pnlCents: 1_000n,
      realizedCents: 6_000n,
      unrealizedChangeCents: -5_000n,
      unattributedCents: 0n,
    });
    expect(pnl.holdings).toMatchObject([
      {
        key: "h1",
        holdingId: "h1",
        realizedCents: 6_000n,
        unrealizedChangeCents: -5_000n,
        contributionCents: 1_000n,
        start: { valueCents: 15_000n, costCents: 10_000n },
        end: null,
      },
    ]);
    // The year before: all of it unrealized.
    expect(pnlOf(service(book), ...year(2025), EUR_DISPLAY).local).toMatchObject({
      pnlCents: 5_000n,
      realizedCents: 0n,
      unrealizedChangeCents: 5_000n,
    });
  });

  it("PERS-113 · 1: a partial sale after further purchases, and a sale of everything", () => {
    const book = manual([
      deposit("2025-01-02", 200),
      buy("2025-01-03", "h1", "2", "100"),
      valuation("2025-12-31", "h1", "150"),
      deposit("2026-02-01", 170),
      buy("2026-02-01", "h1", "1", "170"),
      sell("2026-03-01", "h1", "1.5", "180"),
      valuation("2026-06-30", "h1", "190"),
      sell("2026-09-01", "h1", "1.5", "200"),
    ]);
    const mid = pnlOf(service(book), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    // Average (200 + 170) / 3; 1.5 out at 185 for 270; 1.5 left worth 285 at cost 185.
    expect(mid.local).toMatchObject({
      pnlCents: 8_500n,
      realizedCents: 8_500n,
      unrealizedChangeCents: 0n,
      unattributedCents: 0n,
    });
    const whole = pnlOf(service(book), ...year(2026), EUR_DISPLAY);
    expect(whole.local).toMatchObject({ realizedCents: 8_500n + 11_500n, unrealizedChangeCents: -10_000n });
    expect(whole.local!.pnlCents).toBe(30_000n + 27_000n - 30_000n - 17_000n);
    expectAdditive(whole);
  });

  it("an account opened in the period starts from zero, its opening a flow, and is not partial", () => {
    const book = manual(
      [opening("2026-03-01", 500), buy("2026-03-02", "h1", "5", "100"), valuation("2026-05-01", "h1", "110")],
      {
        periods: [
          {
            fromOn: "2026-03-01",
            startsAt: new Date("2026-03-01T00:00:00Z"),
            mode: "assets",
            origin: "manual",
          },
        ],
      },
    );
    const pnl = pnlOf(service(book), ...year(2026), EUR_DISPLAY);
    expect(pnl).toMatchObject({ partial: false, from: "2026-01-01", startCents: 0n, endCents: 55_000n });
    expect(pnl.local).toMatchObject({ pnlCents: 5_000n, unrealizedChangeCents: 5_000n });
  });

  it("a flow halfway: Modified Dietz weighs it by the days it was in (§4.3)", () => {
    const book = totalBook([
      deposit("2025-01-02", 1000),
      accountValuation("2025-12-31", 1000),
      deposit("2026-07-01", 1000),
      accountValuation("2026-12-31", 2100),
    ]);
    const pnl = pnlOf(service(book), ...year(2026), EUR_DISPLAY);
    expect(pnl.local?.pnlCents).toBe(10_000n);
    // Value only: the change of value is the unrealized, nothing is unattributed.
    expect(pnl.local).toMatchObject({ unrealizedChangeCents: 10_000n, unattributedCents: 0n });
    const capital = 100_000 + (100_000 * 183) / 365;
    expect(pnl.localReturn?.dietz).toBeCloseTo(10_000 / capital, 10);
    expect(pnl.localReturn?.xirr?.status).toBe("ok");
  });

  it("the exchange: one EUR P&L, the local result at the last day's rate plus the effect (§4.5)", () => {
    const rates = rateTable([
      { on: "2025-12-31", currency: "USD", eurPerUnit: "0.9" },
      { on: "2026-06-30", currency: "USD", eurPerUnit: "0.8" },
    ]);
    const book: Book = {
      ...totalBook([
        deposit("2025-01-02", 1000),
        accountValuation("2025-12-31", 1000),
        accountValuation("2026-06-30", 1100),
      ]),
      currency: "USD",
    };
    const pnl = pnlOf(service(book), "2026-01-01", "2026-06-30", { currency: "EUR", rates });
    expect(pnl.local?.pnlCents).toBe(10_000n);
    // 1100 × 0.8 − 1000 × 0.9 = −20 €; the local +100 USD is +80 € at 0.8; the exchange −100 €.
    expect(pnl.display).toMatchObject({
      pnlCents: -2_000n,
      unrealizedChangeCents: 8_000n,
      fxCents: -10_000n,
    });
    expectAdditive(pnl);
  });

  it("dust is no missing price; a real unpriced position makes the P&L estimated", () => {
    const dust = { assetId: "x", product: "funding", valueCents: null, quantity: qty("0.0000765") };
    const real = { assetId: "y", product: "spot", valueCents: null, quantity: qty("2") };
    const at = (positions: ReadingLike["positions"]) =>
      pnlOf(
        service(
          syncedBook(
            [deposit("2025-03-01", 10)],
            [reading("2025-12-31", 100), reading("2026-06-30", 120, { positions })],
          ),
          {
            coverage: [{ stream: "deposits", fromOn: "2020-01-01", toOn: "2026-10-29", complete: true }],
          },
        ),
        "2026-01-01",
        "2026-06-30",
        EUR_DISPLAY,
      );
    expect(at([dust]).status).toBe("verified");
    expect(at([dust, real])).toMatchObject({ status: "estimated", reasons: ["stale_price"] });
  });

  it("a synced service: a position whose trades do not add up has no cost, and goes to Other (§4.2)", () => {
    const sale = event(
      "2026-03-01",
      [{ leg: "base", kind: "sell", holdingId: "h1", quantity: qty("1"), amountCents: eur(60) }],
      { origin: "provider" },
    );
    const fee = event("2026-03-01", [{ leg: "fee", kind: "fee", amountCents: -eur(1) }], {
      origin: "provider",
    });
    const book = syncedBook(
      [
        event(
          "2025-02-01",
          [{ leg: "base", kind: "buy", holdingId: "h1", quantity: qty("2"), amountCents: -eur(80) }],
          { origin: "provider" },
        ),
        sale,
        fee,
      ],
      // The provider reads 3 units; the trades say 2, then 1: no cost to trust.
      [
        reading("2025-12-31", 130, { positions: [spot("h1", "3", 100)] }),
        reading("2026-06-30", 150, { positions: [spot("h1", "3", 120)] }),
      ],
    );
    const pnl = pnlOf(
      service(book, {
        coverage: [{ stream: "trades", fromOn: "2020-01-01", toOn: "2026-10-29", complete: true }],
        quantityMismatch: true,
      }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    expect(pnl.local).toMatchObject({
      pnlCents: 2_000n,
      realizedCents: 2_000n,
      unrealizedChangeCents: null,
      feesCents: -100n,
      unattributedCents: 100n,
    });
    expectAdditive(pnl);
  });

  describe("U4: the unrealized of a synced service, with its base at s⁻ (§4.2, §4.7)", () => {
    const covered = {
      coverage: [{ stream: "trades", fromOn: "2020-01-01", toOn: "2026-10-29", complete: true }],
    } satisfies Partial<PnlService>;

    it("eToro gives the cost: the change of the unrealized is U(e) − U(s⁻), nothing left to Other", () => {
      const book = syncedBook(
        [],
        [
          reading("2025-12-31", 150, { positions: [spot("h1", "2", 150, 100)] }),
          reading("2026-06-30", 170, { positions: [spot("h1", "2", 170, 100)] }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 2_000n,
        unrealizedChangeCents: 2_000n,
        unattributedCents: 0n,
      });
      expect(pnl.holdings).toMatchObject([
        {
          key: "h1",
          contributionCents: 2_000n,
          start: { unrealizedCents: 5_000n, costSource: "provider" },
          end: { unrealizedCents: 7_000n, costSource: "provider" },
        },
      ]);
      expectAdditive(pnl);
    });

    it("bought after s: the base is the cost, not a value at s⁻", () => {
      const book = syncedBook(
        [],
        [
          reading("2025-12-31", 100, { cashCents: eur(100) }),
          reading("2026-06-30", 130, { positions: [spot("h1", "1", 130, 100)] }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 3_000n,
        unrealizedChangeCents: 3_000n,
        unattributedCents: 0n,
      });
      expect(pnl.holdings[0]).toMatchObject({ start: null, end: { costCents: 10_000n } });
    });

    it("a day of the provider's history says a total and no positions: unknown, never zero", () => {
      // eToro's history and Binance's estimated days: no positions and no cash, only the total.
      const book = syncedBook(
        [],
        [reading("2025-12-31", 150), reading("2026-06-30", 170, { positions: [spot("h1", "2", 170, 100)] })],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 2_000n,
        unrealizedChangeCents: null,
        unattributedCents: 2_000n,
      });
      expect(pnl.holdings[0]).toMatchObject({ start: null, unrealizedChangeCents: null });
      expectAdditive(pnl);
      // An empty reading worth nothing is known: nothing was held.
      const empty = syncedBook(
        [],
        [reading("2025-12-31", 0), reading("2026-06-30", 0, { status: "confirmed_zero" })],
      );
      expect(pnlOf(service(empty, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY).local).toMatchObject({
        unrealizedChangeCents: 0n,
      });
    });

    it("Binance: the cost comes from the trades when they add up to the quantity read", () => {
      const book = syncedBook(
        [
          event(
            "2025-02-01",
            [{ leg: "base", kind: "buy", holdingId: "h1", quantity: qty("2"), amountCents: -eur(80) }],
            { origin: "provider" },
          ),
        ],
        [
          reading("2025-12-31", 100, { positions: [spot("h1", "2", 100)] }),
          reading("2026-06-30", 130, { positions: [spot("h1", "2.0000000001", 130)] }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 3_000n,
        unrealizedChangeCents: 3_000n,
        unattributedCents: 0n,
      });
      expect(pnl.holdings[0].end).toMatchObject({ costCents: 8_000n, costSource: "events" });
    });

    it("an eToro position open at s⁻ and closed in the period: realized +60, unrealized −50, +10", () => {
      const ids = new Map([
        ["open", "trade:42:open"],
        ["close", "trade:42:close"],
      ]);
      const book = syncedBook(
        [
          event(
            "2025-05-01",
            [{ leg: "base", kind: "buy", holdingId: "h1", quantity: qty("1"), amountCents: -eur(100) }],
            { id: "open", origin: "provider" },
          ),
          event(
            "2026-03-01",
            [{ leg: "base", kind: "close", holdingId: "h1", quantity: qty("1"), amountCents: eur(160) }],
            { id: "close", origin: "provider" },
          ),
        ],
        [
          reading("2025-12-31", 150, { positions: [spot("h1", "1", 150, 100)] }),
          reading("2026-06-30", 160, { cashCents: eur(160) }),
        ],
      );
      const pnl = pnlOf(service(book, { ...covered, externalIds: ids }), ...year(2026), EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 1_000n,
        realizedCents: 6_000n,
        unrealizedChangeCents: -5_000n,
        unattributedCents: 0n,
      });
      expect(pnl.holdings).toMatchObject([
        { key: "h1", realizedCents: 6_000n, contributionCents: 1_000n, end: null },
      ]);
      expect(pnl.exits[0]).toMatchObject({ openedOn: "2025-05-01", matched: "position" });
    });

    it("a reading before the cost was saved takes it from a later reading of the same quantity", () => {
      const book = syncedBook(
        [],
        [
          reading("2025-12-31", 150, { positions: [spot("h1", "2", 150)] }),
          reading("2026-06-30", 170, { positions: [spot("h1", "2", 170, 100)] }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({ unrealizedChangeCents: 2_000n, unattributedCents: 0n });
      expect(pnl.holdings[0].start).toMatchObject({ costCents: 10_000n, costSource: "inferred" });
      // Another quantity is another cost: nothing to infer, the change stays in Other.
      const moved = syncedBook(
        [],
        [
          reading("2025-12-31", 150, { positions: [spot("h1", "3", 150)] }),
          reading("2026-06-30", 170, { positions: [spot("h1", "2", 170, 100)] }),
        ],
      );
      const other = pnlOf(service(moved, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(other.local).toMatchObject({ unrealizedChangeCents: null, unattributedCents: 2_000n });
      expectAdditive(other);
    });

    it("one position without a cost leaves the others measured: only its change is Other", () => {
      const book = syncedBook(
        [],
        [
          reading("2025-12-31", 250, {
            positions: [spot("h1", "1", 150, 100), spot("h2", "1", 100)],
          }),
          reading("2026-06-30", 290, {
            positions: [spot("h1", "1", 170, 100), spot("h2", "1", 120)],
          }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.local).toMatchObject({
        pnlCents: 4_000n,
        unrealizedChangeCents: 2_000n,
        unattributedCents: 2_000n,
      });
      const rows = pnl.holdings.reduce(
        (sum, one) => sum + one.realizedCents + (one.unrealizedChangeCents ?? 0n),
        0n,
      );
      expect(rows + pnl.local!.unattributedCents).toBe(pnl.local!.pnlCents);
    });

    it("dust is no position: it has no value and no P&L (V4)", () => {
      const book = syncedBook(
        [],
        [
          reading("2025-12-31", 100, { cashCents: eur(100) }),
          reading("2026-06-30", 100, {
            cashCents: eur(100),
            positions: [{ assetId: "x", product: "funding", valueCents: null, quantity: qty("0.0000765") }],
          }),
        ],
      );
      const pnl = pnlOf(service(book, covered), "2026-01-01", "2026-06-30", EUR_DISPLAY);
      expect(pnl.holdings).toEqual([]);
      expect(pnl.local).toMatchObject({ unrealizedChangeCents: 0n, unattributedCents: 0n });
    });
  });

  it("a fee paid in BNB is a sale of the BNB at its value, then the fee: never counted twice", () => {
    const book = manual([
      deposit("2026-01-02", 100),
      buy("2026-01-03", "h1", "1", "100"),
      event("2026-02-01", [{ kind: "fee", holdingId: "h1", quantity: qty("0.1"), amountCents: -eur(20) }]),
      valuation("2026-06-30", "h1", "200"),
    ]);
    const pnl = pnlOf(service(book), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    // 0.9 BNB worth 180, cost 90; the 0.1 BNB left at 20 for a cost of 10.
    expect(pnl.local).toMatchObject({
      pnlCents: 8_000n,
      realizedCents: 1_000n,
      feesCents: -2_000n,
      unrealizedChangeCents: 9_000n,
      unattributedCents: 0n,
    });
  });

  it('"All" is the Gain of today when the coverage is complete', () => {
    const book = manual([
      opening("2025-01-01", 300),
      deposit("2025-02-01", 700),
      buy("2025-02-02", "h1", "5", "100"),
      withdrawal("2025-08-01", 100),
      sell("2026-01-10", "h1", "2", "130"),
      valuation("2026-10-01", "h1", "140"),
    ]);
    const todayOn = "2026-10-29";
    const gain = performance(flowsOn(book, todayOn), valueOn(book, todayOn, NO_RATES).valueCents).gainCents;
    const pnl = pnlOf(service(book), null, todayOn, EUR_DISPLAY);
    expect(pnl.display?.pnlCents).toBe(gain);
    expect(pnl.from).toBe("2025-01-01");
  });
});

// ——— Status (§4.6, PERS-113 · 2) ———————————————————————————————————————————————————————————

describe("pnlOf: how far the number can be trusted (§4.6)", () => {
  const complete: CoverageWindow[] = [
    { stream: "deposits", fromOn: "2020-01-01", toOn: "2026-10-29", complete: true },
  ];

  it("an unknown base is never zero: the period starts after the first value known", () => {
    const opening = event(
      "2026-03-01",
      [{ kind: "opening_position", holdingId: "h1", quantity: qty("1"), amountCents: -eur(90) }],
      { origin: "provider" },
    );
    const book = syncedBook(
      [opening, deposit("2026-05-01", 50)],
      [reading("2026-03-01", 100), reading("2026-06-30", 170)],
      "2026-03-01",
    );
    const pnl = pnlOf(service(book, { coverage: complete }), ...year(2026), EUR_DISPLAY);
    expect(pnl).toMatchObject({ partial: true, from: "2026-03-02", startCents: 10_000n, status: "verified" });
    expect(pnl.reasons).toContain("base_unknown");
    expect(pnl.local?.pnlCents).toBe(17_000n - 10_000n - 5_000n);
  });

  it("a gap in the middle moves the start after it and keeps the valid part", () => {
    const coverage: CoverageWindow[] = [
      { stream: "deposits", fromOn: "2020-01-01", toOn: "2026-04-01", complete: true },
      { stream: "deposits", fromOn: "2026-04-01", toOn: "2026-04-15", complete: false },
      { stream: "deposits", fromOn: "2026-04-15", toOn: "2026-10-29", complete: true },
    ];
    const book = syncedBook(
      [deposit("2026-03-01", 500), deposit("2026-05-01", 50)],
      [reading("2025-12-31", 100), reading("2026-04-14", 640), reading("2026-06-30", 700)],
    );
    const pnl = pnlOf(service(book, { coverage }), ...year(2026), EUR_DISPLAY);
    expect(pnl).toMatchObject({
      partial: true,
      from: "2026-04-15",
      startCents: 64_000n,
      reasons: ["flows_gap"],
    });
    expect(pnl.local?.pnlCents).toBe(70_000n - 64_000n - 5_000n);
    // A gap still open at the end leaves nothing to measure.
    const open = [
      ...coverage.slice(0, 1),
      { stream: "deposits", fromOn: "2026-04-01", toOn: "2026-10-29", complete: false },
    ];
    expect(pnlOf(service(book, { coverage: open }), "2026-01-01", "2026-06-30", EUR_DISPLAY)).toMatchObject({
      status: "undetermined",
      local: null,
    });
    // eToro in 2025: deposits covered only from June 2026 — "no reliable data in 2025".
    expect(pnlOf(service(book, { coverage }), ...year(2025), EUR_DISPLAY).status).toBe("verified");
    const etoro = [
      { stream: "deposits", fromOn: "2020-01-01", toOn: "2026-06-10", complete: false },
      { stream: "deposits", fromOn: "2026-06-10", toOn: "2026-10-29", complete: true },
    ];
    expect(pnlOf(service(book, { coverage: etoro }), ...year(2025), EUR_DISPLAY).status).toBe("undetermined");
    expect(pnlOf(service(book, { coverage: etoro }), ...year(2026), EUR_DISPLAY)).toMatchObject({
      from: "2026-06-10",
      partial: true,
    });
  });

  it("an old price is estimated; the rebuilt history is estimated; with quantities that do not add up it is no base", () => {
    const readings = [
      reading("2025-12-31", 100, { status: "estimated" }),
      reading("2026-02-28", 110, { status: "estimated" }),
      reading("2026-03-01", 120),
      reading("2026-06-30", 150),
    ];
    const book = syncedBook([], readings);
    const estimated = pnlOf(service(book, { coverage: complete }), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    expect(estimated).toMatchObject({
      status: "estimated",
      reasons: ["estimated_history"],
      startCents: 10_000n,
    });
    const mismatch = pnlOf(
      service(book, { coverage: complete, quantityMismatch: true }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    expect(mismatch).toMatchObject({
      status: "verified",
      partial: true,
      from: "2026-03-02",
      startCents: 12_000n,
    });
    expect(mismatch.reasons).toEqual(["quantity_mismatch"]);
    // After the first real reading the period stands on real values only.
    expect(pnlOf(service(book, { coverage: complete }), "2026-04-01", "2026-06-30", EUR_DISPLAY).status).toBe(
      "verified",
    );
  });

  it("no value on the last day is undetermined, not zero", () => {
    const book = syncedBook([], [reading("2026-08-01", 100)], "2026-08-01");
    expect(
      pnlOf(service(book, { coverage: complete }), "2026-01-01", "2026-06-30", EUR_DISPLAY),
    ).toMatchObject({
      status: "undetermined",
      local: null,
    });
  });
});

// ——— Transfers and corrections (§4.9, PERS-113 · 6) ———————————————————————————————————————————

describe("transfers and corrections (§4.9)", () => {
  it("a correction already in force at the start changes nothing; one that starts in the period is a correction; a capital one is a flow", () => {
    const fix = (on: string, amount: number, validUntil: string | null = null) =>
      event(on, [{ kind: "adjustment", amountCents: eur(amount), validUntil }]);
    const retro = fix("2025-06-01", 120);
    const now = fix("2026-03-01", 50);
    const capital = fix("2026-04-01", 30, "2026-05-31");
    const book = totalBook([
      deposit("2025-01-02", 1000),
      accountValuation("2025-01-02", 1000),
      retro,
      now,
      capital,
    ]);
    const classes = new Map<string, AdjustmentClass>([[capital.id, "capital"]]);
    const pnl = pnlOf(service(book, { adjustmentClasses: classes }), ...year(2026), EUR_DISPLAY);
    expect(pnl.local).toMatchObject({
      pnlCents: 5_000n,
      correctionsCents: 5_000n,
      unrealizedChangeCents: 0n,
    });
    expect(pnl.flows.map((flow) => [flow.on, flow.cents])).toEqual([
      ["2026-04-01", 3_000n],
      ["2026-06-01", -3_000n],
    ]);
    const asResult = pnlOf(
      service(book, { adjustmentClasses: new Map([[now.id, "result"]]) }),
      ...year(2026),
      EUR_DISPLAY,
    );
    expect(asResult.local).toMatchObject({ pnlCents: 5_000n, correctionsCents: 5_000n });
  });

  it("a transfer in another currency closes the portfolio with its own row", () => {
    const rates = rateTable([{ on: "2025-12-31", currency: "USD", eurPerUnit: "0.9" }]);
    const display = { currency: "EUR", rates };
    const a: Book = {
      ...totalBook([
        deposit("2025-01-02", 1000),
        accountValuation("2025-01-02", 1000),
        withdrawal("2026-03-01", 100, { transferGroupId: "g1" }),
      ]),
      currency: "USD",
    };
    const b = totalBook([
      deposit("2026-03-01", 85, { transferGroupId: "g1" }),
      accountValuation("2026-03-01", 85),
    ]);
    const pa = pnlOf(service(a, { accountId: "A" }), ...year(2026), display);
    const pb = pnlOf(service(b, { accountId: "B" }), ...year(2026), display);
    const portfolio = portfolioPnl([pa, pb], "EUR");
    // 85 € arrived for 100 USD = 90 € sent: 5 € lost in the move.
    expect(portfolio.transfersCents).toBe(-500n);
    expect(portfolio.parts?.pnlCents).toBe(pa.display!.pnlCents + pb.display!.pnlCents - 500n);
    expect(sumOf(portfolio.parts!) + portfolio.transfersCents).toBe(portfolio.parts!.pnlCents);
  });

  it("across the year end each year sees its own leg as a flow; towards Funds a leg is a flow", () => {
    const a = totalBook([
      deposit("2025-01-02", 1000),
      accountValuation("2025-01-02", 1000),
      withdrawal("2025-12-31", 400, { transferGroupId: "g2" }),
      withdrawal("2026-02-01", 100, { transferGroupId: "funds" }),
    ]);
    const b = totalBook([deposit("2026-01-02", 400, { transferGroupId: "g2" })], "2026-01-02");
    const of = (from: string | null, to: string) =>
      portfolioPnl(
        [
          pnlOf(service(a, { accountId: "A" }), from, to, EUR_DISPLAY),
          pnlOf(service(b, { accountId: "B" }), from, to, EUR_DISPLAY),
        ],
        "EUR",
      );
    const y2026 = of(...year(2026));
    expect(y2026.transfersCents).toBe(0n);
    // The 400 in transit is not profit: B's deposit is a flow of 2026.
    expect(y2026.parts?.pnlCents).toBe(0n);
    expect(of(...year(2025)).parts?.pnlCents).toBe(0n);
    const all = of(null, "2026-12-31");
    expect(all.transfersCents).toBe(0n);
    expect(all.parts?.pnlCents).toBe(0n);
  });

  it("an asset moved out leaves at its average cost, with its value and its history kept apart", () => {
    const out = event(
      "2026-03-01",
      [{ kind: "withdrawal", holdingId: "h1", quantity: qty("1"), amountCents: -eur(150) }],
      { transferGroupId: "g3" },
    );
    const book = manual([deposit("2025-01-02", 200), buy("2025-01-03", "h1", "2", "100"), out]);
    const { transfers } = replayHoldings(book, "2026-12-31");
    expect(transfers).toEqual([
      expect.objectContaining({ direction: "out", valueCents: 15_000n, historicalCostCents: 10_000n }),
    ]);
  });
});

// ——— Dietz and XIRR (§4.3, PERS-113 · 7) ———————————————————————————————————————————————————

describe("Modified Dietz and XIRR (§4.3)", () => {
  it("a deposit on the last day weighs nothing and changes no P&L", () => {
    const book = totalBook([
      deposit("2025-01-02", 1000),
      accountValuation("2025-01-02", 1000),
      accountValuation("2026-06-29", 1100),
      deposit("2026-06-30", 500),
    ]);
    const pnl = pnlOf(service(book), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    expect(pnl.local?.pnlCents).toBe(10_000n);
    expect(pnl.localReturn?.averageCapitalCents).toBe(100_000);
    expect(pnl.localReturn?.dietz).toBeCloseTo(0.1, 10);
  });

  it("an account emptied before the period has no return, and a P&L of zero", () => {
    const book = totalBook([
      deposit("2025-01-02", 1000),
      withdrawal("2025-06-01", 1000),
      accountValuation("2025-06-01", 0),
    ]);
    const pnl = pnlOf(service(book), ...year(2026), EUR_DISPLAY);
    expect(pnl.local?.pnlCents).toBe(0n);
    expect(pnl.localReturn?.dietz).toBeNull();
  });

  it("a leap year counts 366 days", () => {
    const flows = [{ on: "2024-07-01", cents: 100_000n }];
    const result = modifiedDietz({
      from: "2024-01-01",
      to: "2024-12-31",
      startCents: 100_000n,
      pnlCents: 10_000n,
      flows,
    });
    expect(result.averageCapital).toBeCloseTo(100_000 + (100_000 * 183) / 366, 6);
  });

  it("a year without movements is the change of value; its XIRR agrees over a whole year", () => {
    const book = totalBook(
      [
        deposit("2024-01-02", 1000),
        accountValuation("2024-12-31", 1000),
        accountValuation("2025-12-31", 1100),
      ],
      "2024-01-01",
    );
    const pnl = pnlOf(service(book), ...year(2025), EUR_DISPLAY);
    expect(pnl.localReturn?.dietz).toBeCloseTo(0.1, 10);
    expect(pnl.localReturn?.xirr).toMatchObject({ status: "ok" });
    if (pnl.localReturn?.xirr?.status === "ok") expect(pnl.localReturn.xirr.rate).toBeCloseTo(0.1, 3);
  });

  it("no XIRR under a year of days covered, even on All", () => {
    const book = totalBook(
      [openingValue("2026-03-01", 1000), accountValuation("2026-10-01", 1100)],
      "2026-03-01",
    );
    const pnl = pnlOf(service(book), null, "2026-10-29", EUR_DISPLAY);
    expect(pnl.localReturn?.xirr).toBeNull();
    // The opening is a flow at the end of its day: in for 242 of the 243 days.
    expect(pnl.localReturn?.dietz).toBeCloseTo(10_000 / ((100_000 * 242) / 243), 10);
  });

  it("a one-day period has the capital of the day before; an account opened that day has none", () => {
    const book = totalBook(
      [openingValue("2026-03-01", 1000), accountValuation("2026-03-02", 1010)],
      "2026-03-01",
    );
    expect(pnlOf(service(book), "2026-03-02", "2026-03-02", EUR_DISPLAY).localReturn).toMatchObject({
      averageCapitalCents: 100_000,
    });
    expect(pnlOf(service(book), "2026-03-01", "2026-03-01", EUR_DISPLAY).localReturn?.dietz).toBeNull();
  });
});

// ——— The portfolio (§4.6, §4.8, PERS-113 · 3, 5, 10) ———————————————————————————————————————————

describe("portfolioPnl (§4.8)", () => {
  const steady = (amount: number, gain: number) =>
    totalBook([
      deposit("2025-01-02", amount),
      accountValuation("2025-12-31", amount),
      accountValuation("2026-06-30", amount + gain),
    ]);

  it("one range: an aggregate return on the same days; two ranges: amounts only", () => {
    const one = pnlOf(
      service(steady(1000, 100), { accountId: "A" }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const two = pnlOf(service(steady(500, -20), { accountId: "B" }), "2026-01-01", "2026-06-30", EUR_DISPLAY);
    const same = portfolioPnl([one, two], "EUR");
    expect(same).toMatchObject({ status: "verified", available: false, rateReason: "ok" });
    expect(same.rate).toBeCloseTo(8_000 / 150_000, 10);

    const late = pnlOf(
      service(syncedBook([], [reading("2026-06-09", 300), reading("2026-06-30", 330)]), {
        accountId: "C",
        coverage: [
          { stream: "deposits", fromOn: "2020-01-01", toOn: "2026-06-10", complete: false },
          { stream: "deposits", fromOn: "2026-06-10", toOn: "2026-10-29", complete: true },
        ],
      }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const mixed = portfolioPnl([one, two, late], "EUR");
    expect(mixed).toMatchObject({
      status: "estimated",
      available: true,
      rate: null,
      rateReason: "mixed_ranges",
    });
    expect(mixed.partial).toEqual([{ accountId: "C", from: "2026-06-10" }]);
    expect(mixed.parts?.pnlCents).toBe(10_000n - 2_000n + 3_000n);
  });

  it("an undetermined service is left out and said so", () => {
    const one = pnlOf(
      service(steady(1000, 100), { accountId: "A" }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const none = pnlOf(
      service(syncedBook([], []), { accountId: "Z", coverage: [] }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const portfolio = portfolioPnl([one, none], "EUR");
    expect(portfolio).toMatchObject({ status: "estimated", included: ["A"], excluded: [{ accountId: "Z" }] });
    expect(portfolioPnl([none], "EUR")).toMatchObject({ status: "undetermined", parts: null });
  });

  it("PERS-113 · 5: the service's EUR P&L is its row in the portfolio, a residual included", () => {
    const rates = rateTable([
      { on: "2025-12-31", currency: "USD", eurPerUnit: "0.9" },
      { on: "2026-06-30", currency: "USD", eurPerUnit: "0.85" },
    ]);
    const sale = event(
      "2026-03-01",
      [{ leg: "base", kind: "sell", holdingId: "h1", quantity: qty("1"), amountCents: eur(60) }],
      { origin: "provider" },
    );
    const usd: Book = {
      ...syncedBook(
        [
          event(
            "2025-02-01",
            [{ leg: "base", kind: "buy", holdingId: "h1", quantity: qty("2"), amountCents: -eur(80) }],
            { origin: "provider" },
          ),
          sale,
        ],
        [reading("2025-12-31", 130), reading("2026-06-30", 151)],
      ),
      currency: "USD",
    };
    const complete = [{ stream: "trades", fromOn: "2020-01-01", toOn: "2026-10-29", complete: true }];
    const service1 = pnlOf(service(usd, { accountId: "U", coverage: complete }), "2026-01-01", "2026-06-30", {
      currency: "EUR",
      rates,
    });
    const service2 = pnlOf(service(steady(1000, 100), { accountId: "E" }), "2026-01-01", "2026-06-30", {
      currency: "EUR",
      rates,
    });
    expect(service1.display?.unattributedCents).not.toBe(0n);
    const portfolio = portfolioPnl([service1, service2], "EUR");
    const row = portfolio.contributions.find((one) => one.accountId === "U");
    expect(row?.cents).toBe(service1.display!.pnlCents);
    expect(portfolio.contributions.reduce((sum, one) => sum + one.cents, 0n) + portfolio.transfersCents).toBe(
      portfolio.parts!.pnlCents,
    );
    expect(sumOf(portfolio.parts!) + portfolio.transfersCents).toBe(portfolio.parts!.pnlCents);
    // The bridge: the local result at the last day's rate plus the exchange effect.
    const local = service1.local!.pnlCents;
    expect(service1.display!.pnlCents - service1.display!.fxCents).toBe(
      sumOf({ ...service1.display!, fxCents: 0n }),
    );
    // 151 − 130 USD, no flows.
    expect(local).toBe(2_100n);
  });

  it("PERS-113 · 10: contributions in money, bars on the largest, no share of a net that is (almost) zero", () => {
    const gain = pnlOf(
      service(steady(1000, 100), { accountId: "A" }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const loss = pnlOf(
      service(steady(1000, -100), { accountId: "B" }),
      "2026-01-01",
      "2026-06-30",
      EUR_DISPLAY,
    );
    const zero = portfolioPnl([gain, loss], "EUR");
    expect(zero.contributions.map((one) => [one.accountId, one.cents, one.bar, one.shareOfNet])).toEqual([
      ["A", 10_000n, 1, null],
      ["B", -10_000n, -1, null],
    ]);
    const almost = portfolioPnl(
      [
        gain,
        pnlOf(service(steady(1000, -99.5), { accountId: "B" }), "2026-01-01", "2026-06-30", EUR_DISPLAY),
      ],
      "EUR",
    );
    expect(almost.contributions.every((one) => one.shareOfNet === null)).toBe(true);
    const negative = portfolioPnl(
      [gain, pnlOf(service(steady(1000, -300), { accountId: "B" }), "2026-01-01", "2026-06-30", EUR_DISPLAY)],
      "EUR",
    );
    expect(negative.contributions.map((one) => one.bar)).toEqual([-1, 1 / 3]);
    expect(negative.contributions[1].shareOfNet).toBeCloseTo(-0.5, 10);
  });
});

// ——— Invariants (§4.6), on random books ————————————————————————————————————————————————————

/** A small deterministic generator (mulberry32): the same seed, the same books. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBook(next: () => number): Book {
  const events: EventLike[] = [opening("2025-01-01", 1000)];
  const held = new Map<string, number>([
    ["h1", 0],
    ["h2", 0],
  ]);
  let cash = 1000;
  let day = "2025-01-01";
  for (let step = 0; step < 40; step++) {
    day = addDays(day, 1 + Math.floor(next() * 20));
    const id = next() < 0.5 ? "h1" : "h2";
    const unit = (50 + Math.floor(next() * 100)).toString();
    const roll = next();
    if (roll < 0.15) {
      const amount = 10 + Math.floor(next() * 300);
      events.push(deposit(day, amount));
      cash += amount;
    } else if (roll < 0.25 && cash > 20) {
      const amount = Math.floor(next() * cash * 0.5);
      if (amount > 0) {
        events.push(withdrawal(day, amount));
        cash -= amount;
      }
    } else if (roll < 0.55) {
      const units = 1 + Math.floor(next() * 4);
      if (cash >= units * Number(unit)) {
        events.push(buy(day, id, units.toString(), unit));
        held.set(id, held.get(id)! + units);
        cash -= units * Number(unit);
      }
    } else if (roll < 0.75 && held.get(id)! > 0) {
      const units = (held.get(id)! * (0.25 + next() * 0.75)).toFixed(2);
      events.push(sell(day, id, units, unit));
      held.set(id, held.get(id)! - Number(units));
      cash += Number(units) * Number(unit);
    } else if (roll < 0.9) {
      events.push(valuation(day, id, unit));
    } else {
      events.push(
        event(day, [{ kind: "income", holdingId: id, amountCents: eur(1 + Math.floor(next() * 20)) }]),
      );
    }
  }
  return manual(events);
}

describe("invariants (§4.6) on random books", () => {
  it("parts add up, nothing is unattributed for positions with a cost, and the portfolio is the sum of its rows", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const next = random(seed);
      const books = [randomBook(next), randomBook(next)];
      const from = addDays("2025-01-01", Math.floor(next() * 500));
      const to = addDays(from, Math.floor(next() * 300));
      const services = books.map((book, index) =>
        pnlOf(service(book, { accountId: `s${index}` }), from, to, EUR_DISPLAY),
      );
      for (const pnl of services) {
        expectAdditive(pnl);
        expect(pnl.local!.unattributedCents).toBe(0n);
        // V(e) − V(s⁻) − flows, by definition.
        const flows = pnl.flows.reduce((sum, flow) => sum + flow.cents, 0n);
        expect(pnl.local!.pnlCents).toBe(pnl.endCents! - pnl.startCents! - flows);
        // The positions add up to the realized and the change of the unrealized.
        const byHolding = pnl.holdings.reduce((sum, one) => sum + (one.contributionCents ?? 0n), 0n);
        expect(byHolding).toBe(pnl.local!.realizedCents + pnl.local!.unrealizedChangeCents!);
        // The Positions tab's rows close on the same number (U4, PERS-113 · 5).
        const tab = contributionsOf(pnl)!;
        expect(
          tab.rows.reduce((sum, row) => sum + row.cents, 0n) +
            tab.incomeCents +
            tab.feesCents +
            tab.correctionsCents +
            tab.valueChangeCents +
            tab.unattributedCents,
        ).toBe(pnl.local!.pnlCents);
      }
      const portfolio = portfolioPnl(services, "EUR");
      const rows = portfolio.contributions.reduce((sum, one) => sum + one.cents, 0n);
      expect(rows + portfolio.transfersCents).toBe(portfolio.parts!.pnlCents);
      expect(sumOf(portfolio.parts!) + portfolio.transfersCents).toBe(portfolio.parts!.pnlCents);
    }
  });

  it('"All" equals the Gain of today on every random book', () => {
    for (let seed = 100; seed < 130; seed++) {
      const book = randomBook(random(seed));
      const todayOn = "2027-06-30";
      const gain = performance(flowsOn(book, todayOn), valueOn(book, todayOn, NO_RATES).valueCents).gainCents;
      expect(pnlOf(service(book), null, todayOn, EUR_DISPLAY).display?.pnlCents).toBe(gain);
    }
  });

  it("consecutive periods add up to the period that holds them", () => {
    for (let seed = 200; seed < 230; seed++) {
      const book = randomBook(random(seed));
      const a = pnlOf(service(book), ...year(2025), EUR_DISPLAY).local!.pnlCents;
      const b = pnlOf(service(book), "2026-01-01", "2026-12-31", EUR_DISPLAY).local!.pnlCents;
      expect(a + b).toBe(pnlOf(service(book), "2025-01-01", "2026-12-31", EUR_DISPLAY).local!.pnlCents);
    }
  });
});
