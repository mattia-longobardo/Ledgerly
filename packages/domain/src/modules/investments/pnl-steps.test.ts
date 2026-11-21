// The steps of a service's P&L (audit INV-8): each one on its own, and the bars of the chart from one
// start and one list of flows, equal day by day to a `pnlOf` per bar, the path they replace.
import { describe, expect, it } from "vitest";
import { addDays, type CivilDate } from "../../shared/dates";
import { NO_RATES, rateTable } from "../../platform/fx/rules";
import { parseDecimal } from "../../shared/money";
import {
  attribute,
  costBases,
  incomeAndFees,
  measuredStart,
  periodFlows,
  pnlOf,
  type PnlService,
  pnlThrough,
} from "./pnl";
import {
  type Book,
  type EventLike,
  type OperationLike,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type ReadingLike,
} from "./rules";

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
    operations: operations.map((operation, index) => ({
      leg: index === 0 ? "main" : "fee",
      holdingId: null,
      kind: "deposit",
      quantity: null,
      unitPrice: null,
      priceCurrency: null,
      amountCents: 0n,
      fxRate: null,
      validUntil: null,
      ...operation,
    })),
  };
}

const deposit = (on: string, amount: number, extra: Partial<EventLike> = {}) =>
  event(on, [{ kind: "deposit", amountCents: eur(amount) }], extra);
const withdrawal = (on: string, amount: number) =>
  event(on, [{ kind: "withdrawal", amountCents: -eur(amount) }]);
const trade = (kind: "buy" | "sell", on: string, units: string, unit: string) =>
  event(on, [
    {
      kind,
      holdingId: "h1",
      quantity: qty(units),
      unitPrice: price(unit),
      priceCurrency: "EUR",
      amountCents: (kind === "buy" ? -1n : 1n) * eur(Number(units) * Number(unit)),
    },
  ]);
const valuation = (on: string, unit: string) =>
  event(on, [{ kind: "valuation", holdingId: "h1", unitPrice: price(unit), priceCurrency: "EUR" }]);
const accountValuation = (on: string, amount: number) =>
  event(on, [{ kind: "account_valuation", amountCents: eur(amount) }]);

function book(
  events: EventLike[],
  extra: Partial<Book> & { mode?: "assets" | "total"; origin?: "manual" | "synced" } = {},
): Book {
  const { mode = "assets", origin = "manual", ...rest } = extra;
  return {
    currency: "EUR",
    periods: [{ fromOn: "2025-01-01", startsAt: new Date("2025-01-01T00:00:00Z"), mode, origin }],
    events,
    holdings: [
      {
        id: "h1",
        assetId: "asset-h1",
        origin: origin === "synced" ? "provider" : "manual",
        product: "spot",
        currency: "EUR",
      },
    ],
    readings: [],
    reconciliations: [],
    ...rest,
  };
}

function reading(on: string, total: number): ReadingLike {
  return {
    id: `r-${on}`,
    on,
    status: "complete",
    totalCents: eur(total),
    cashCents: eur(total),
    positions: [],
    scopes: [{ product: "spot", complete: true }],
  };
}

function service(of: Book, extra: Partial<PnlService> = {}): PnlService {
  return {
    accountId: "a1",
    currency: of.currency,
    book: of,
    rates: NO_RATES,
    coverage: null,
    externalIds: new Map(),
    ...extra,
  };
}

const EUR_DISPLAY = { currency: "EUR", rates: NO_RATES };

const broker = () =>
  book([
    deposit("2025-01-02", 10_000),
    trade("buy", "2025-01-03", "100", "60"),
    valuation("2025-06-30", "65"),
    deposit("2025-09-01", 1_000),
    trade("sell", "2025-10-15", "40", "70"),
    withdrawal("2025-11-20", 2_000),
    valuation("2026-02-27", "72"),
    event("2026-03-10", [{ kind: "income", amountCents: eur(15) }]),
    event("2026-03-11", [{ kind: "fee", amountCents: -eur(3) }]),
    valuation("2026-05-29", "58"),
    event("2026-04-01", [{ kind: "adjustment", amountCents: eur(50), validUntil: "2026-04-30" }]),
  ]);

/** The path the bars replace: one `pnlOf` from the first day measured to each day. */
function perDay(of: PnlService, from: CivilDate, to: CivilDate, display = EUR_DISPLAY) {
  const whole = pnlOf(of, from, to, display);
  const days: CivilDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  const expected = days.map((day) =>
    whole.from === null || day < whole.from
      ? null
      : (pnlOf(of, whole.from, day, display).display?.pnlCents ?? null),
  );
  return { whole, days, expected };
}

describe("pnlThrough (INV-8): the bars from one start and one list of flows", () => {
  it("is pnlOf day by day on a manual service with trades, income, fees and a correction", () => {
    const adjusted = service(broker(), { adjustmentClasses: new Map() });
    for (const [from, to] of [
      ["2025-01-01", "2026-06-30"],
      ["2025-10-01", "2025-12-31"],
      ["2026-01-01", "2026-06-30"],
    ] as const) {
      const { whole, days, expected } = perDay(adjusted, from, to);
      expect(pnlThrough(adjusted, whole, days, EUR_DISPLAY)).toEqual(expected);
    }
  });

  it("is pnlOf day by day with a correction of class capital, a flow", () => {
    const of = broker();
    const adjustment = of.events.find((one) => one.operations[0].kind === "adjustment")!;
    const capital = service(of, { adjustmentClasses: new Map([[adjustment.id, "capital"]]) });
    const { whole, days, expected } = perDay(capital, "2026-01-01", "2026-06-30");
    expect(whole.flows.length).toBeGreaterThan(0);
    expect(pnlThrough(capital, whole, days, EUR_DISPLAY)).toEqual(expected);
  });

  it("is pnlOf day by day on an account kept by value", () => {
    const total = service(
      book(
        [
          deposit("2025-01-02", 1_000),
          accountValuation("2025-03-31", 1_020),
          deposit("2025-05-02", 500),
          accountValuation("2025-12-31", 1_600),
        ],
        { mode: "total" },
      ),
    );
    const { whole, days, expected } = perDay(total, "2025-01-01", "2025-12-31");
    expect(pnlThrough(total, whole, days, EUR_DISPLAY)).toEqual(expected);
  });

  it("is pnlOf day by day in another display currency, a missing rate a gap", () => {
    const usd = {
      ...book(
        [
          deposit("2025-01-02", 1_000),
          accountValuation("2025-03-31", 1_020),
          deposit("2025-09-02", 500),
          accountValuation("2025-12-31", 1_600),
          accountValuation("2026-05-29", 1_650),
        ],
        { mode: "total" },
      ),
      currency: "USD",
    };
    const rates = rateTable([
      { on: "2024-12-02", currency: "USD", eurPerUnit: "0.9" },
      { on: "2025-08-01", currency: "USD", eurPerUnit: "0.85" },
      { on: "2026-03-01", currency: "USD", eurPerUnit: "0.92" },
    ]);
    const display = { currency: "EUR", rates };
    const { whole, days, expected } = perDay(service(usd), "2025-01-01", "2026-06-30", display);
    expect(expected.some((one) => one !== null)).toBe(true);
    expect(pnlThrough(service(usd), whole, days, display)).toEqual(expected);
    const late = {
      currency: "EUR",
      rates: rateTable([{ on: "2025-06-01", currency: "USD", eurPerUnit: "0.9" }]),
    };
    const gaps = perDay(service(usd), "2025-01-01", "2025-12-31", late);
    expect(pnlThrough(service(usd), gaps.whole, gaps.days, late)).toEqual(gaps.expected);
  });

  it("is pnlOf day by day on a synced service with a gap in its flows and days without a value", () => {
    const readings: ReadingLike[] = [];
    for (let day = "2025-12-20"; day <= "2026-02-28"; day = addDays(day, 1)) readings.push(reading(day, 100));
    readings.push(reading("2026-03-15", 1_200), reading("2026-04-30", 1_260), reading("2026-06-30", 1_300));
    const synced = book([deposit("2026-03-10", 1_000, { origin: "provider" })], {
      origin: "synced",
      periods: [
        {
          fromOn: "2025-12-01",
          startsAt: new Date("2025-12-01T00:00:00Z"),
          mode: "assets",
          origin: "synced",
        },
      ],
      readings,
    });
    const coverage = [
      { stream: "deposits", fromOn: "2025-12-01", toOn: "2026-03-05", complete: false },
      { stream: "deposits", fromOn: "2026-03-05", toOn: "2026-05-15", complete: true },
      { stream: "trades", fromOn: "2026-01-15", toOn: "2026-06-30", complete: true },
      { stream: "deposits", fromOn: "2026-05-15", toOn: "2026-06-30", complete: false },
    ];
    const of = service(synced, { coverage });
    const { whole, days, expected } = perDay(of, "2026-01-01", "2026-06-30");
    expect(new Set(expected).has(null)).toBe(true);
    expect(expected.some((one) => one !== null)).toBe(true);
    expect(pnlThrough(of, whole, days, EUR_DISPLAY)).toEqual(expected);
  });
});

describe("the steps of pnlOf (INV-8)", () => {
  it("measuredStart: the value before the first day, zero before a manual account's history", () => {
    expect(measuredStart(service(broker()), "2025-01-01", "2025-12-31")).toEqual({
      from: "2025-01-01",
      base: "2024-12-31",
      startCents: 0n,
    });
    expect(measuredStart(service(broker()), "2025-07-01", "2025-12-31")).toEqual({
      from: "2025-07-01",
      base: "2025-06-30",
      startCents: eur(10_000 - 6_000 + 6_500),
    });
  });

  it("measuredStart: a gap still open on the last day measures nothing, and says why", () => {
    const reasons = new Set<string>();
    const open = [{ stream: "deposits", fromOn: "2025-01-01", toOn: "2026-12-31", complete: false }];
    expect(
      measuredStart(service(broker(), { coverage: open }), "2025-01-01", "2025-12-31", reasons as never),
    ).toBeNull();
    expect([...reasons]).toEqual(["flows_gap"]);
  });

  it("periodFlows: the money in and out of the days, signed, by day", () => {
    const flows = periodFlows(service(broker()), "2025-02-01", "2025-12-31");
    expect(flows.map((flow) => [flow.on, flow.cents])).toEqual([
      ["2025-09-01", eur(1_000)],
      ["2025-11-20", -eur(2_000)],
    ]);
  });

  it("incomeAndFees: what the days booked as income and as fees", () => {
    expect(incomeAndFees(broker(), "2026-01-01", "2026-06-30")).toEqual({
      incomeCents: eur(15),
      feesCents: -eur(3),
    });
    expect(incomeAndFees(broker(), "2025-01-01", "2025-12-31")).toEqual({ incomeCents: 0n, feesCents: 0n });
  });

  it("costBases and attribute: a position open at s⁻ costs its value then; a sale realizes against it", () => {
    const of = service(broker());
    const bases = costBases(of, "2025-06-30", "2025-12-31");
    expect(bases.samePeriod).toBe(true);
    expect(bases.atStart.positions.map((position) => position.valueCents)).toEqual([eur(6_500)]);
    const exits = bases.replayEnd.exits.filter((exit) => exit.on >= "2025-07-01");
    const attribution = attribute(of.book, bases, exits, {
      pnlCents: eur(400),
      endCents: eur(0),
      incomeCents: 0n,
      feesCents: 0n,
      correctionsCents: 0n,
    });
    // 40 sold at 70 against a basis of 65; the 60 left are worth the price of the sale.
    expect([...attribution.realizedBy.values()]).toEqual([eur(200)]);
    expect(attribution.unrealizedChangeCents).toBe(eur(300));
    expect(attribution.openPositions).toBe(1);
  });
});
