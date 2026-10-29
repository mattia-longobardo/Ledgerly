import { describe, expect, it } from "vitest";
import { rateTable, NO_RATES } from "@/platform/fx/rules";
import {
  type Book,
  computePoints,
  emptyReadingStatus,
  type EventLike,
  flowEntriesOn,
  flowsOn,
  formatDecimal,
  investorFlows,
  holdingStates,
  type OperationLike,
  openingCashFor,
  parseDecimal,
  performance,
  pointDays,
  positionCents,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type ReadingLike,
  type TransferLeg,
  transferProposals,
  unitPriceOf,
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

function book(partial: Partial<Book> & Pick<Book, "events">): Book {
  return {
    currency: "EUR",
    periods: [
      { fromOn: "2026-01-01", startsAt: new Date("2026-01-01T00:00:00Z"), mode: "assets", origin: "manual" },
    ],
    holdings: [],
    readings: [],
    reconciliations: [],
    ...partial,
  };
}

function reading(on: string, total: number, extra: Partial<ReadingLike> = {}): ReadingLike {
  return {
    id: `r-${on}`,
    on,
    status: "complete",
    totalCents: eur(total),
    positions: [],
    scopes: [
      { product: "spot", complete: true },
      { product: "funding", complete: true },
    ],
    ...extra,
  };
}

const synced = (currency = "EUR") => ({
  currency,
  periods: [
    {
      fromOn: "2026-01-01",
      startsAt: new Date("2026-01-01T00:00:00Z"),
      mode: "assets" as const,
      origin: "synced" as const,
    },
  ],
});

// ——— Decimals ———————————————————————————————————————————————————————————————————————————

describe("fixed-point decimals", () => {
  it("parses and prints without floats, rounding half away from zero past the scale", () => {
    expect(parseDecimal("0.000000000000000001", 18)).toBe(1n);
    expect(parseDecimal("-1.5", 2)).toBe(-150n);
    expect(parseDecimal("1.005", 2)).toBe(101n);
    expect(formatDecimal(qty("0.5"), QUANTITY_SCALE)).toBe("0.5");
    expect(formatDecimal(-300n, 2)).toBe("-3");
    expect(() => parseDecimal("1,5", 2)).toThrow(RangeError);
  });

  it("values quantity × price in cents and finds the price of a total", () => {
    expect(positionCents(qty("100"), price("60"))).toBe(eur(6000));
    expect(positionCents(qty("0.5"), price("2400"))).toBe(eur(1200));
    expect(unitPriceOf(eur(6000), qty("100"))).toBe(price("60"));
  });
});

// ——— §2.1 Manual account ————————————————————————————————————————————————————————————————

describe("§2.1 manual account, assets mode (the Directa example)", () => {
  const vwce = {
    id: "h-vwce",
    assetId: "a-vwce",
    origin: "manual" as const,
    product: "custody",
    currency: "EUR",
  };
  const directa = book({
    periods: [
      { fromOn: "2026-03-01", startsAt: new Date("2026-03-01T00:00:00Z"), mode: "assets", origin: "manual" },
    ],
    holdings: [vwce],
    events: [
      event("2026-03-01", [{ kind: "deposit", amountCents: eur(10000) }]),
      event("2026-03-02", [
        {
          kind: "buy",
          holdingId: vwce.id,
          quantity: qty("100"),
          unitPrice: price("60"),
          priceCurrency: "EUR",
          amountCents: -eur(6000),
        },
        { kind: "fee", amountCents: -eur(2) },
      ]),
      event("2026-06-30", [
        { kind: "valuation", holdingId: vwce.id, unitPrice: price("65"), priceCurrency: "EUR" },
      ]),
      event("2026-09-15", [
        {
          kind: "close",
          holdingId: vwce.id,
          quantity: qty("100"),
          unitPrice: price("70"),
          priceCurrency: "EUR",
          amountCents: eur(7000),
        },
        { kind: "fee", amountCents: -eur(2) },
      ]),
      event("2026-09-20", [{ kind: "withdrawal", amountCents: -eur(2000) }]),
    ],
  });

  it.each([
    ["2026-03-01", 10000, 10000, 0],
    ["2026-03-02", 9998, 3998, 6000],
    ["2026-06-30", 10498, 3998, 6500],
    ["2026-09-15", 10996, 10996, 0],
    ["2026-09-20", 8996, 8996, 0],
  ])("on %s V is %d (cash %d, assets %d)", (on, v, cash, assets) => {
    const day = valueOn(directa, on, NO_RATES);
    expect(day.valueCents).toBe(eur(v));
    expect(day.cashCents).toBe(eur(cash));
    expect(day.assetsCents).toBe(eur(assets));
  });

  it("holds between events: the day before the valuation is still worth the buy price", () => {
    expect(valueOn(directa, "2026-06-29", NO_RATES).valueCents).toBe(eur(9998));
  });

  it("closes the position at zero: its proceeds are already in cash", () => {
    const state = holdingStates(directa, "2026-09-16", NO_RATES).get(vwce.id);
    expect(state?.open).toBe(false);
    expect(state?.valueCents).toBe(0n);
  });

  it("counts the opening and the deposits as money in, and the gain against them", () => {
    const flows = flowsOn(directa, "2026-09-20");
    expect(flows).toEqual({ openingCents: 0n, depositedCents: eur(10000), withdrawnCents: eur(2000) });
    expect(performance(flows, eur(8996))).toEqual({
      investedCents: eur(8000),
      gainCents: eur(996),
      simpleReturn: 0.0996,
    });
  });
});

describe("§2.1 a position kept by value only (A3)", () => {
  const btp = {
    id: "h-btp",
    assetId: "a-btp",
    origin: "manual" as const,
    product: "custody",
    currency: "EUR",
  };
  const account = book({
    holdings: [btp],
    events: [
      event("2026-01-10", [{ kind: "deposit", amountCents: eur(5000) }]),
      event("2026-01-11", [{ kind: "buy", holdingId: btp.id, amountCents: -eur(5000) }]),
      event("2026-04-01", [{ kind: "valuation", holdingId: btp.id, amountCents: eur(5100) }]),
    ],
  });

  it("is worth what it was bought for, without a valuation after the buy", () => {
    expect(valueOn(account, "2026-01-11", NO_RATES).valueCents).toBe(eur(5000));
  });

  it("then the last valuation", () => {
    expect(valueOn(account, "2026-04-01", NO_RATES).valueCents).toBe(eur(5100));
  });

  it("allows negative cash, which is incomplete data rather than an error", () => {
    const short = book({
      holdings: [btp],
      events: [event("2026-01-11", [{ kind: "buy", holdingId: btp.id, amountCents: -eur(5000) }])],
    });
    const day = valueOn(short, "2026-01-11", NO_RATES);
    expect(day.cashCents).toBe(-eur(5000));
    expect(day.valueCents).toBe(0n);
  });
});

describe("§2.1 manual account, total mode", () => {
  const account = book({
    periods: [
      { fromOn: "2026-01-01", startsAt: new Date("2026-01-01T00:00:00Z"), mode: "total", origin: "manual" },
    ],
    events: [
      event("2026-01-05", [{ kind: "deposit", amountCents: eur(1000) }]),
      event("2026-02-01", [{ kind: "account_valuation", amountCents: eur(1100) }], {
        occurredAt: new Date("2026-02-01T23:59:59Z"),
      }),
      event("2026-02-01", [{ kind: "deposit", amountCents: eur(50) }], {
        occurredAt: new Date("2026-02-01T09:00:00Z"),
      }),
      event("2026-02-10", [{ kind: "withdrawal", amountCents: -eur(200) }]),
    ],
  });

  it("before any valuation the value is unknown, never zero, once money went in", () => {
    expect(valueOn(account, "2026-01-05", NO_RATES).valueCents).toBeNull();
  });

  it("an account where nothing happened yet is worth zero", () => {
    expect(valueOn(account, "2026-01-02", NO_RATES).valueCents).toBe(0n);
  });

  it("never goes below zero: more came out than the valuation held", () => {
    const drained = {
      ...account,
      events: [...account.events, event("2026-03-01", [{ kind: "withdrawal", amountCents: -eur(5000) }])],
    };
    expect(valueOn(drained, "2026-03-01", NO_RATES).valueCents).toBe(0n);
  });

  it("a valuation is the end of its day: that day's earlier flows are already in it", () => {
    expect(valueOn(account, "2026-02-01", NO_RATES).valueCents).toBe(eur(1100));
  });

  it("then the last valuation plus the net flows after it", () => {
    expect(valueOn(account, "2026-02-10", NO_RATES).valueCents).toBe(eur(900));
  });
});

// ——— §2.2 Synced account ————————————————————————————————————————————————————————————————

describe("§2.2 example 1: provider only (eToro in USD)", () => {
  const etoro = book({
    ...synced("USD"),
    events: [],
    readings: [reading("2026-11-10", 12340), reading("2026-11-12", 12410)],
  });
  const rates = rateTable([
    { on: "2026-11-10", currency: "USD", eurPerUnit: "0.92" },
    { on: "2026-11-11", currency: "USD", eurPerUnit: "0.93" },
    { on: "2026-11-12", currency: "USD", eurPerUnit: "0.93" },
  ]);

  it.each([
    ["2026-11-10", 12340],
    ["2026-11-11", 12340],
    ["2026-11-12", 12410],
  ])("on %s the balance is %d USD (R1, R5 hold)", (on, v) => {
    expect(valueOn(etoro, on, rates).valueCents).toBe(eur(v));
  });

  it("a manual deposit enters the return, never V: the provider already counts it", () => {
    const withDeposit = {
      ...etoro,
      events: [event("2026-11-12", [{ kind: "deposit", amountCents: eur(1000) }])],
    };
    expect(valueOn(withDeposit, "2026-11-12", rates).valueCents).toBe(eur(12410));
    expect(flowsOn(withDeposit, "2026-11-12").depositedCents).toBe(eur(1000));
  });
});

describe("§2.2 example 2: provider + a manual asset in another product (Binance + Earn)", () => {
  const eth = { id: "h-eth", assetId: "a-eth", origin: "manual" as const, product: "earn", currency: "EUR" };
  const binance = book({
    ...synced(),
    holdings: [eth],
    events: [
      event("2026-12-01", [
        {
          kind: "buy",
          holdingId: eth.id,
          quantity: qty("0.5"),
          unitPrice: price("2400"),
          priceCurrency: "EUR",
          amountCents: -eur(1200),
        },
      ]),
      event("2026-12-15", [
        { kind: "valuation", holdingId: eth.id, unitPrice: price("2600"), priceCurrency: "EUR" },
      ]),
    ],
    readings: [
      reading("2026-12-01", 3000, {
        positions: [{ assetId: "a-eth", product: "spot", valueCents: eur(240) }],
      }),
      reading("2026-12-15", 3100),
    ],
  });

  it("adds the manual Earn position to the reading: 4.200 then 4.400", () => {
    expect(valueOn(binance, "2026-12-01", NO_RATES).valueCents).toBe(eur(4200));
    expect(valueOn(binance, "2026-12-15", NO_RATES).valueCents).toBe(eur(4400));
  });

  it("the same asset in another product is no conflict (A1)", () => {
    expect(valueOn(binance, "2026-12-01", NO_RATES).conflicts).toEqual([]);
  });

  it("in a synced account, the manual buy's cash does not move V (R2)", () => {
    expect(valueOn(binance, "2026-12-01", NO_RATES).manualCents).toBe(eur(1200));
  });
});

describe("§2.2 example 2b: the provider starts covering the product (R4)", () => {
  const eth = { id: "h-eth", assetId: "a-eth", origin: "manual" as const, product: "earn", currency: "EUR" };
  const earnScopes = [
    { product: "spot", complete: true },
    { product: "funding", complete: true },
    { product: "earn", complete: true },
  ];
  const base = book({
    ...synced(),
    holdings: [eth],
    events: [
      event("2026-12-01", [
        {
          kind: "buy",
          holdingId: eth.id,
          quantity: qty("0.5"),
          unitPrice: price("2400"),
          priceCurrency: "EUR",
          amountCents: -eur(1200),
        },
      ]),
      event("2026-12-15", [
        { kind: "valuation", holdingId: eth.id, unitPrice: price("2600"), priceCurrency: "EUR" },
      ]),
    ],
    readings: [
      reading("2026-12-15", 3100),
      reading("2026-12-20", 4460, {
        scopes: earnScopes,
        positions: [{ assetId: "a-eth", product: "earn", valueCents: eur(1310) }],
      }),
      reading("2026-12-21", 4470, {
        scopes: earnScopes,
        positions: [{ assetId: "a-eth", product: "earn", valueCents: eur(1320) }],
      }),
    ],
  });

  it("while the conflict is open nothing jumps and nothing counts twice: 4.450", () => {
    const day = valueOn(base, "2026-12-20", NO_RATES);
    expect(day.readingCents).toBe(eur(4460));
    expect(day.conflictCents).toBe(eur(1310));
    expect(day.manualCents).toBe(eur(1300));
    expect(day.valueCents).toBe(eur(4450));
    expect(day.conflicts).toEqual([
      { holdingId: eth.id, readingId: "r-2026-12-20", providerCents: eur(1310) },
    ]);
  });

  it("'the provider covers it all' from 20/12: 4.470, and 20/12 rewritten to 4.460", () => {
    const decided = {
      ...base,
      reconciliations: [
        {
          holdingId: eth.id,
          effectiveOn: "2026-12-20",
          kind: "covered_by_provider" as const,
          quantity: null,
          decidedAt: new Date("2026-12-21T10:00:00Z"),
        },
      ],
    };
    expect(valueOn(decided, "2026-12-21", NO_RATES).valueCents).toBe(eur(4470));
    expect(valueOn(decided, "2026-12-20", NO_RATES).valueCents).toBe(eur(4460));
    expect(valueOn(decided, "2026-12-20", NO_RATES).conflictCents).toBe(0n);
  });

  it("'it covers part of it' (0,3 ETH): the 0,2 ETH left stays in M", () => {
    const partial = {
      ...base,
      reconciliations: [
        {
          holdingId: eth.id,
          effectiveOn: "2026-12-20",
          kind: "partial" as const,
          quantity: qty("0.3"),
          decidedAt: new Date("2026-12-21T10:00:00Z"),
        },
      ],
    };
    const day = valueOn(partial, "2026-12-21", NO_RATES);
    expect(day.manualCents).toBe(eur(520)); // 0,2 × 2.600
    expect(day.valueCents).toBe(eur(4470 + 520));
  });

  it("a later reopening brings the conflict back", () => {
    const reopened = {
      ...base,
      reconciliations: [
        {
          holdingId: eth.id,
          effectiveOn: "2026-12-20",
          kind: "covered_by_provider" as const,
          quantity: null,
          decidedAt: new Date("2026-12-21T10:00:00Z"),
        },
        {
          holdingId: eth.id,
          effectiveOn: "2026-12-21",
          kind: "reopened" as const,
          quantity: null,
          decidedAt: new Date("2026-12-22T10:00:00Z"),
        },
      ],
    };
    expect(valueOn(reopened, "2026-12-21", NO_RATES).conflicts).toHaveLength(1);
  });
});

describe("§2.2 examples 3 and 4: adjustments (R3)", () => {
  it("a transfer in transit counts until its last day, then expires", () => {
    const kraken = book({
      ...synced(),
      events: [
        event("2026-11-05", [{ kind: "adjustment", amountCents: eur(500), validUntil: "2026-11-06" }]),
      ],
      readings: [reading("2026-11-05", 10000), reading("2026-11-06", 10020), reading("2026-11-07", 10530)],
    });
    expect(valueOn(kraken, "2026-11-05", NO_RATES).valueCents).toBe(eur(10500));
    expect(valueOn(kraken, "2026-11-06", NO_RATES).valueCents).toBe(eur(10520));
    expect(valueOn(kraken, "2026-11-07", NO_RATES).valueCents).toBe(eur(10530));
    expect(pointDays(kraken, "2026-11-30")).toContain("2026-11-07");
  });

  it("a permanent adjustment stays: V = P − 37", () => {
    const account = book({
      ...synced(),
      events: [event("2026-10-03", [{ kind: "adjustment", amountCents: -eur(37) }])],
      readings: [reading("2026-10-03", 2000), reading("2026-12-01", 2100)],
    });
    expect(valueOn(account, "2026-10-03", NO_RATES).valueCents).toBe(eur(1963));
    expect(valueOn(account, "2026-12-01", NO_RATES).valueCents).toBe(eur(2063));
  });
});

describe("§2.2 example 5: an emptied account (R5)", () => {
  it("a withdrawal that explains it confirms the zero", () => {
    expect(emptyReadingStatus({ previousCents: eur(10000), withdrawalWithin7Days: true })).toBe(
      "confirmed_zero",
    );
  });

  it("without one the zero waits, and V holds at 10.000", () => {
    const status = emptyReadingStatus({ previousCents: eur(10000), withdrawalWithin7Days: false });
    expect(status).toBe("pending_zero");
    const account = book({
      ...synced(),
      events: [],
      readings: [reading("2027-01-10", 10000), reading("2027-01-11", 0, { status })],
    });
    expect(valueOn(account, "2027-01-11", NO_RATES).valueCents).toBe(eur(10000));
  });

  it("a small balance needs no confirmation", () => {
    expect(emptyReadingStatus({ previousCents: eur(49.99), withdrawalWithin7Days: false })).toBe(
      "confirmed_zero",
    );
  });

  it("once confirmed the zero counts", () => {
    const account = book({
      ...synced(),
      events: [],
      readings: [reading("2027-01-10", 10000), reading("2027-01-11", 0, { status: "confirmed_zero" })],
    });
    expect(valueOn(account, "2027-01-11", NO_RATES).valueCents).toBe(0n);
  });

  it("a synced period with no reading yet has no value, so the balance before it holds", () => {
    expect(valueOn(book({ ...synced(), events: [] }), "2026-02-01", NO_RATES).valueCents).toBeNull();
  });
});

describe("R6 and the rewrite rule (§1.7, principle 4)", () => {
  it("a corrected reading moves its day and the ones after, never the ones before", () => {
    const before = book({
      ...synced(),
      events: [],
      readings: [reading("2026-03-01", 100), reading("2026-03-10", 120)],
    });
    const after = { ...before, readings: [reading("2026-03-01", 100), reading("2026-03-10", 150)] };
    const old = computePoints(before, NO_RATES, "2026-04-30");
    const fresh = computePoints(after, NO_RATES, "2026-04-30");
    expect(fresh.filter((p) => p.on < "2026-03-10")).toEqual(old.filter((p) => p.on < "2026-03-10"));
    expect(fresh.find((p) => p.on === "2026-03-10")?.cents).toBe(eur(150));
    expect(computePoints(after, NO_RATES, "2026-04-30", "2026-03-10")).toEqual(
      fresh.filter((p) => p.on >= "2026-03-10"),
    );
  });

  it("writes a point on every event day and every month end, never past today", () => {
    const account = book({
      events: [event("2026-01-15", [{ kind: "deposit", amountCents: eur(10) }])],
    });
    expect(pointDays(account, "2026-03-20")).toEqual([
      "2026-01-01",
      "2026-01-15",
      "2026-01-31",
      "2026-02-28",
    ]);
  });
});

describe("ordering within a day (A2)", () => {
  it("sorts by the moment, then by the insertion sequence", () => {
    const h = { id: "h", assetId: "a", origin: "manual" as const, product: "custody", currency: "EUR" };
    const at = new Date("2026-05-01T10:00:00Z");
    const account = book({
      holdings: [h],
      events: [
        event(
          "2026-05-01",
          [{ kind: "valuation", holdingId: h.id, unitPrice: price("12"), priceCurrency: "EUR" }],
          { occurredAt: at, seq: 20n },
        ),
        event(
          "2026-05-01",
          [
            {
              kind: "buy",
              holdingId: h.id,
              quantity: qty("1"),
              unitPrice: price("10"),
              priceCurrency: "EUR",
              amountCents: -eur(10),
            },
          ],
          { occurredAt: at, seq: 10n },
        ),
      ],
    });
    expect(holdingStates(account, "2026-05-01", NO_RATES).get(h.id)?.unitPrice).toBe(price("12"));
  });
});

describe("assets quoted in another currency (§1.8, A5)", () => {
  const spy = {
    id: "h-spy",
    assetId: "a-spy",
    origin: "manual" as const,
    product: "custody",
    currency: "USD",
  };
  const rates = rateTable([
    { on: "2026-03-02", currency: "USD", eurPerUnit: "0.9" },
    { on: "2026-06-30", currency: "USD", eurPerUnit: "0.8" },
  ]);
  const account = book({
    holdings: [spy],
    events: [
      event("2026-03-02", [
        {
          kind: "buy",
          holdingId: spy.id,
          quantity: qty("10"),
          unitPrice: price("100"),
          priceCurrency: "USD",
          fxRate: parseDecimal("0.9", 10),
          amountCents: -eur(900),
        },
      ]),
    ],
  });

  it("values the position at the rate of the day, and splits the exchange effect out", () => {
    const state = holdingStates(account, "2026-06-30", rates).get(spy.id);
    expect(state?.valueCents).toBe(eur(800));
    expect(state?.costCents).toBe(eur(900));
    expect(state?.fxEffectCents).toBe(-eur(100));
  });

  it("without a rate for the day it falls back to the saved one and says so", () => {
    const state = holdingStates(account, "2026-06-30", NO_RATES).get(spy.id);
    expect(state?.valueCents).toBe(eur(900));
    expect(state?.staleRate).toBe(true);
    expect(valueOn(account, "2026-06-30", NO_RATES).missing).toBe(1);
  });
});

describe("§2.5 conversions keep V(T)", () => {
  it("total → assets: 10.000 with 100 VWCE @ 60 opens 4.000 of cash", () => {
    const vwce = {
      id: "h-vwce",
      assetId: "a-vwce",
      origin: "manual" as const,
      product: "custody",
      currency: "EUR",
    };
    const cash = openingCashFor(eur(10000), [
      { holdingId: vwce.id, quantity: qty("100"), unitPrice: price("60"), valueCents: eur(6000) },
    ]);
    expect(cash).toBe(eur(4000));
    const conversionAt = new Date("2026-02-10T15:00:00Z");
    const account = book({
      periods: [
        { fromOn: "2026-01-01", startsAt: new Date("2026-01-01T00:00:00Z"), mode: "total", origin: "manual" },
        { fromOn: "2026-02-10", startsAt: conversionAt, mode: "assets", origin: "manual" },
      ],
      holdings: [vwce],
      events: [
        event("2026-02-01", [{ kind: "account_valuation", amountCents: eur(10000) }]),
        event("2026-02-10", [{ kind: "opening_cash", amountCents: cash }], {
          origin: "conversion",
          occurredAt: conversionAt,
        }),
        event(
          "2026-02-10",
          [
            {
              kind: "opening_position",
              holdingId: vwce.id,
              quantity: qty("100"),
              unitPrice: price("60"),
              priceCurrency: "EUR",
              amountCents: -eur(6000),
            },
          ],
          { origin: "conversion", occurredAt: conversionAt },
        ),
      ],
    });
    expect(valueOn(account, "2026-02-09", NO_RATES).valueCents).toBe(eur(10000));
    expect(valueOn(account, "2026-02-10", NO_RATES).valueCents).toBe(eur(10000));
    // The conversion is no flow: nothing went in.
    expect(flowsOn(account, "2026-02-10").openingCents).toBe(0n);
  });

  it("assets → total: an account valuation at T equal to V(T)", () => {
    const at = new Date("2026-03-01T15:00:00Z");
    const account = book({
      periods: [
        {
          fromOn: "2026-01-01",
          startsAt: new Date("2026-01-01T00:00:00Z"),
          mode: "assets",
          origin: "manual",
        },
        { fromOn: "2026-03-01", startsAt: at, mode: "total", origin: "manual" },
      ],
      events: [
        event("2026-01-02", [{ kind: "deposit", amountCents: eur(700) }]),
        event("2026-03-01", [{ kind: "account_valuation", amountCents: eur(700) }], {
          origin: "conversion",
          occurredAt: at,
        }),
        event("2026-03-02", [{ kind: "deposit", amountCents: eur(100) }]),
      ],
    });
    expect(valueOn(account, "2026-03-01", NO_RATES).valueCents).toBe(eur(700));
    expect(valueOn(account, "2026-03-02", NO_RATES).valueCents).toBe(eur(800));
  });

  it("a handover opens the first period with the balance at T, which is money in", () => {
    const at = new Date("2026-04-01T08:00:00Z");
    const account = book({
      periods: [{ fromOn: "2026-04-01", startsAt: at, mode: "total", origin: "manual" }],
      events: [
        event("2026-04-01", [{ kind: "account_valuation", amountCents: eur(2500) }], {
          origin: "conversion",
          occurredAt: at,
        }),
      ],
    });
    expect(valueOn(account, "2026-04-01", NO_RATES).valueCents).toBe(eur(2500));
    expect(flowsOn(account, "2026-04-01").openingCents).toBe(eur(2500));
  });
});

describe("§2.4 flows, and transfers between the person's accounts (A10)", () => {
  it("lists every flow with its day and its transfer, and sums to flowsOn", () => {
    const account = book({
      events: [
        event("2026-01-05", [{ kind: "deposit", amountCents: eur(1000) }]),
        event("2026-02-05", [{ kind: "withdrawal", amountCents: -eur(300) }], { transferGroupId: "t1" }),
      ],
    });
    const entries = flowEntriesOn(account, "2026-12-31");
    expect(entries).toEqual([
      { on: "2026-01-05", kind: "deposit", cents: eur(1000), transferGroupId: null },
      { on: "2026-02-05", kind: "withdrawal", cents: eur(300), transferGroupId: "t1" },
    ]);
    // For the account itself a transfer is a flow like any other.
    expect(flowsOn(account, "2026-12-31")).toEqual({
      openingCents: 0n,
      depositedCents: eur(1000),
      withdrawnCents: eur(300),
    });
    expect(investorFlows(entries, "2026-12-31", eur(800))).toEqual([
      { on: "2026-01-05", cents: -eur(1000) },
      { on: "2026-02-05", cents: eur(300) },
      { on: "2026-12-31", cents: eur(800) },
    ]);
  });

  const leg = (partial: Partial<TransferLeg> & Pick<TransferLeg, "eventId" | "accountId" | "kind">) => ({
    on: "2026-03-01",
    assetId: null,
    amount: price("1000"),
    currency: "EUR",
    transferGroupId: null,
    ...partial,
  });

  it("proposes a withdrawal and a deposit of the same amount within 3 days, in two accounts", () => {
    const out = leg({ eventId: "w1", accountId: "a", kind: "withdrawal" });
    const into = leg({ eventId: "d1", accountId: "b", kind: "deposit", on: "2026-03-04" });
    expect(transferProposals([out, into])).toEqual([{ withdrawal: out, deposit: into }]);
  });

  it("matches an asset by asset and quantity, never by value", () => {
    const out = leg({
      eventId: "w1",
      accountId: "a",
      kind: "withdrawal",
      assetId: "btc",
      amount: qty("0.5"),
      currency: null,
    });
    const same = leg({
      eventId: "d1",
      accountId: "b",
      kind: "deposit",
      assetId: "btc",
      amount: qty("0.5"),
      currency: null,
    });
    const other = leg({
      eventId: "d2",
      accountId: "b",
      kind: "deposit",
      assetId: "eth",
      amount: qty("0.5"),
      currency: null,
    });
    expect(transferProposals([out, other, same])).toEqual([{ withdrawal: out, deposit: same }]);
  });

  it("proposes nothing in the same account, past 3 days, for another amount, currency, or a linked leg", () => {
    const out = leg({ eventId: "w1", accountId: "a", kind: "withdrawal" });
    expect(transferProposals([out, leg({ eventId: "d1", accountId: "a", kind: "deposit" })])).toEqual([]);
    expect(
      transferProposals([out, leg({ eventId: "d2", accountId: "b", kind: "deposit", on: "2026-03-05" })]),
    ).toEqual([]);
    expect(
      transferProposals([out, leg({ eventId: "d3", accountId: "b", kind: "deposit", amount: price("999") })]),
    ).toEqual([]);
    expect(
      transferProposals([out, leg({ eventId: "d4", accountId: "b", kind: "deposit", currency: "USD" })]),
    ).toEqual([]);
    expect(
      transferProposals([out, leg({ eventId: "d5", accountId: "b", kind: "deposit", transferGroupId: "t" })]),
    ).toEqual([]);
  });

  it("gives each leg one partner, the closest", () => {
    const out = leg({ eventId: "w1", accountId: "a", kind: "withdrawal", on: "2026-03-02" });
    const far = leg({ eventId: "d1", accountId: "b", kind: "deposit", on: "2026-03-05" });
    const near = leg({ eventId: "d2", accountId: "c", kind: "deposit", on: "2026-03-02" });
    const second = leg({ eventId: "w2", accountId: "a", kind: "withdrawal", on: "2026-03-04" });
    expect(transferProposals([far, out, near, second])).toEqual([
      { withdrawal: out, deposit: near },
      { withdrawal: second, deposit: far },
    ]);
  });
});
