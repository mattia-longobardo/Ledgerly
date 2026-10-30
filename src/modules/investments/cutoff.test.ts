import { describe, expect, it } from "vitest";
import { addDays } from "@/platform/dates";
import { NO_RATES } from "@/platform/fx/rules";
import { cashGaps, cashImpact, openingCashAt } from "./cutoff";
import { pnlOf, type PnlParts, type PnlService, portfolioPnl, type ServicePnl } from "./pnl";
import { contributionsOf } from "./positions";
import {
  type Book,
  type EventLike,
  type OperationLike,
  parseDecimal,
  QUANTITY_SCALE,
  type ReadingLike,
} from "./rules";

// PERS-145: the 12 months of a synced service — a cut-off with its opening, no estimate, no "Other",
// and one engine whose parts add up to every period's P&L, service by service and in the portfolio.

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const cents = (value: number) => BigInt(Math.round(value * 100));
const EUR = { currency: "EUR", rates: NO_RATES };
const CUTOFF = "2025-10-28";

let seq = 0n;
function event(on: string, operations: Partial<OperationLike>[], note: string | null = null): EventLike {
  seq += 1n;
  return {
    id: `e${seq}`,
    on,
    occurredAt: new Date(`${on}T12:00:00Z`),
    seq,
    origin: "provider",
    transferGroupId: null,
    note,
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
  } as EventLike;
}

function service(book: Book, accountId = "a1"): PnlService {
  return {
    accountId,
    currency: book.currency,
    book,
    rates: NO_RATES,
    coverage: [{ stream: "trades", fromOn: "2017-01-01", toOn: "2027-12-31", complete: true }],
    externalIds: new Map(),
  };
}

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

/**
 * An exchange's 12 months (Binance): an opening at the cut-off at the day's close, then trades
 * against the cash, coin fees and rewards, cash in and out, and a reading every day — the coins at
 * the day's close and the cash — as the reconstructed history and the daily readings have them.
 * `leaks` takes cash on some days with no entry: a difference only `cashGaps` can name.
 */
function exchange(next: () => number, days = 160, leaks = 0): { book: Book; leaked: Set<string> } {
  const coins = ["c1", "c2"];
  const price = new Map([
    ["c1", 40 + Math.floor(next() * 60)],
    ["c2", 5 + Math.floor(next() * 10)],
  ]);
  const held = new Map(coins.map((coin) => [coin, 0]));
  let cash = 0;
  const events: EventLike[] = [];
  const readings: ReadingLike[] = [];
  const leaked = new Set<string>();
  // The opening (rule 2): what was held at the cut-off, at that day's close.
  const units = 2 + Math.floor(next() * 5);
  held.set("c1", units);
  cash = 100;
  events.push(
    event(CUTOFF, [
      {
        kind: "opening_position",
        holdingId: "c1",
        quantity: qty(String(units)),
        amountCents: -cents(units * price.get("c1")!),
      },
      { leg: "base", kind: "opening_cash", amountCents: cents(cash) },
    ]),
  );
  for (let index = 0; index < days; index++) {
    const day = addDays(CUTOFF, index);
    if (index > 0) {
      for (const coin of coins) price.set(coin, Math.max(1, price.get(coin)! + Math.floor(next() * 7) - 3));
      const coin = next() < 0.5 ? "c1" : "c2";
      const p = price.get(coin)!;
      const roll = next();
      if (roll < 0.25 && cash >= p) {
        const n = 1 + Math.floor(next() * Math.min(4, cash / p));
        events.push(
          event(day, [
            {
              leg: "base",
              kind: "buy",
              holdingId: coin,
              quantity: qty(String(n)),
              amountCents: -cents(n * p),
            },
          ]),
        );
        held.set(coin, held.get(coin)! + n);
        cash -= n * p;
      } else if (roll < 0.45 && held.get(coin)! >= 1) {
        const n = 1 + Math.floor(next() * held.get(coin)!);
        events.push(
          event(day, [
            {
              leg: "base",
              kind: "sell",
              holdingId: coin,
              quantity: qty(String(n)),
              amountCents: cents(n * p),
            },
          ]),
        );
        held.set(coin, held.get(coin)! - n);
        cash += n * p;
      } else if (roll < 0.55 && held.get(coin)! >= 1) {
        // A fee paid in the coin: a sale of the coin at its value, then the fee (§4.4).
        events.push(
          event(day, [
            { leg: "fee", kind: "fee", holdingId: coin, quantity: qty("1"), amountCents: -cents(p) },
          ]),
        );
        held.set(coin, held.get(coin)! - 1);
      } else if (roll < 0.65) {
        events.push(
          event(day, [{ kind: "income", holdingId: coin, quantity: qty("1"), amountCents: cents(p) }]),
        );
        held.set(coin, held.get(coin)! + 1);
      } else if (roll < 0.72) {
        const amount = 10 + Math.floor(next() * 200);
        events.push(event(day, [{ kind: "deposit", amountCents: cents(amount) }]));
        cash += amount;
      } else if (roll < 0.78 && cash > 20) {
        const amount = Math.floor(cash / 3);
        events.push(event(day, [{ kind: "withdrawal", amountCents: -cents(amount) }]));
        cash -= amount;
      } else if (roll < 0.82 && cash > 2) {
        events.push(event(day, [{ kind: "fee", amountCents: -cents(1) }]));
        cash -= 1;
      } else if (leaked.size < leaks && index < days - 5 && cash > 5 && !leaked.has(addDays(day, -1))) {
        cash -= 3;
        leaked.add(day);
      }
    }
    const positions = coins
      .filter((coin) => held.get(coin)! > 0)
      .map((coin) => ({
        assetId: `asset-${coin}`,
        product: "spot",
        quantity: qty(String(held.get(coin)!)),
        valueCents: cents(held.get(coin)! * price.get(coin)!),
      }));
    readings.push({
      id: `r-${day}`,
      on: day,
      status: index < days - 2 ? "reconstructed" : "complete",
      totalCents: cents(cash) + positions.reduce((sum, one) => sum + one.valueCents, 0n),
      cashCents: cents(cash),
      positions,
      scopes: [{ product: "spot", complete: true }],
    });
  }
  return {
    book: {
      currency: "EUR",
      periods: [
        { fromOn: CUTOFF, startsAt: new Date(`${CUTOFF}T00:00:00Z`), mode: "assets", origin: "synced" },
      ],
      events,
      holdings: coins.map((id) => ({
        id,
        assetId: `asset-${id}`,
        origin: "provider" as const,
        product: "spot",
        currency: "EUR",
      })),
      readings,
      reconciliations: [],
    },
    leaked,
  };
}

/** The book with the entries `settleCutoff` books for its gaps (rule 4). */
function settled(book: Book): Book {
  const gaps = cashGaps(book, CUTOFF).map((gap) =>
    event(
      gap.to,
      [{ kind: gap.cents < 0n ? "fee" : "income", amountCents: gap.cents }],
      "balance_difference",
    ),
  );
  return { ...book, events: [...book.events, ...gaps] };
}

/** A period that ends on a day the service exists: before its cut-off there is nothing to measure. */
function periodOf(next: () => number): [string, string] {
  const from = addDays("2025-09-01", Math.floor(next() * 200));
  const to = addDays(from, Math.floor(next() * 120));
  return [from, to < CUTOFF ? CUTOFF : to];
}

function expectClosed(pnl: ServicePnl) {
  expect(pnl.local).not.toBeNull();
  expect(sumOf(pnl.local!)).toBe(pnl.local!.pnlCents);
  // Rule 4: nothing is left that no part explains.
  expect(pnl.local!.unattributedCents).toBe(0n);
  // Rule 5: an unrealized only with a position open at the end.
  if (pnl.openPositions === 0) expect(pnl.local!.unrealizedChangeCents).toBe(0n);
  // The Positions tab closes on the same number.
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

describe("PERS-145: the residual is zero on a synced service's 12 months (property)", () => {
  it("every period, from before the cut-off to its end, closes to the cent", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed);
      const { book } = exchange(next);
      for (let at = 0; at < 4; at++) {
        const pnl = pnlOf(service(book), ...periodOf(next), EUR);
        expect(pnl.status).toBe("verified");
        expectClosed(pnl);
      }
    }
  });

  it("a difference of the cash is booked as an entry of its own, and then nothing is left", () => {
    for (let seed = 50; seed <= 80; seed++) {
      const next = random(seed);
      const { book, leaked } = exchange(next, 160, 3);
      const gaps = cashGaps(book, CUTOFF);
      expect(gaps.map((gap) => gap.to).sort()).toEqual([...leaked].sort());
      expect(gaps.every((gap) => gap.cents === -300n && !gap.exchange)).toBe(true);
      const fixed = settled(book);
      expect(cashGaps(fixed, CUTOFF)).toEqual([]);
      for (let at = 0; at < 4; at++) expectClosed(pnlOf(service(fixed), ...periodOf(next), EUR));
    }
  });

  it("the services add up to the portfolio, part by part, in every period", () => {
    for (let seed = 100; seed <= 120; seed++) {
      const next = random(seed);
      const [from, to] = periodOf(next);
      const services = [exchange(next).book, exchange(next).book].map((book, index) =>
        pnlOf(service(book, `s${index}`), from, to, EUR),
      );
      const portfolio = portfolioPnl(services, "EUR");
      const parts = portfolio.parts!;
      const keys = [
        "pnlCents",
        "realizedCents",
        "incomeCents",
        "feesCents",
        "correctionsCents",
        "fxCents",
        "unattributedCents",
      ] as const;
      for (const key of keys) {
        expect(parts[key]).toBe(services.reduce((sum, one) => sum + one.display![key], 0n));
      }
      expect(parts.unrealizedChangeCents).toBe(
        services.reduce((sum, one) => sum + (one.display!.unrealizedChangeCents ?? 0n), 0n),
      );
      expect(parts.unattributedCents).toBe(0n);
    }
  });
});

describe("PERS-145 · 5: Binance 2026 — no position open, no unrealized", () => {
  it("a coin held on 31/12 and sold in the year: the year's P&L is all realized, plus income and fees", () => {
    // 10 units worth 1,784.04 € on 31/12/2025 (bought at 2,066.34 at the cut-off); a reward and a
    // fee in the year; everything sold for 1,170.00; 0.04 € of dust left over.
    const opening = event(CUTOFF, [
      { kind: "opening_position", holdingId: "c1", quantity: qty("10"), amountCents: -206_634n },
    ]);
    const reward = event("2026-02-01", [
      { kind: "income", holdingId: "c1", quantity: qty("0.02"), amountCents: 372n },
    ]);
    const fee = event("2026-03-01", [{ kind: "fee", amountCents: -1_383n }]);
    const sale = event("2026-05-10", [
      { leg: "base", kind: "sell", holdingId: "c1", quantity: qty("10.0198"), amountCents: 117_000n },
    ]);
    const out = event("2026-05-19", [{ kind: "withdrawal", amountCents: -(117_000n - 1_383n) }]);
    const at = (on: string, total: bigint, cash: bigint, position: bigint, units: string): ReadingLike => ({
      id: `r-${on}`,
      on,
      status: on < "2026-10-28" ? "reconstructed" : "complete",
      totalCents: total,
      cashCents: cash,
      positions: [{ assetId: "asset-c1", product: "spot", quantity: qty(units), valueCents: position }],
      scopes: [{ product: "spot", complete: true }],
    });
    const book: Book = {
      currency: "EUR",
      periods: [
        { fromOn: CUTOFF, startsAt: new Date(`${CUTOFF}T00:00:00Z`), mode: "assets", origin: "synced" },
      ],
      events: [opening, reward, fee, sale, out],
      holdings: [{ id: "c1", assetId: "asset-c1", origin: "provider", product: "spot", currency: "EUR" }],
      readings: [
        at(CUTOFF, 206_634n, 0n, 206_634n, "10"),
        at("2025-12-31", 178_404n, 0n, 178_404n, "10"),
        at("2026-02-01", 180_000n, 0n, 180_000n, "10.02"),
        at("2026-03-01", 178_000n - 1_383n, -1_383n, 178_000n, "10.02"),
        at("2026-05-10", 117_000n - 1_383n + 4n, 117_000n - 1_383n, 4n, "0.0002"),
        at("2026-05-19", 4n, 0n, 4n, "0.0002"),
        at("2026-10-29", 4n, 0n, 4n, "0.0002"),
      ],
      reconciliations: [],
    };
    const pnl = pnlOf(service(book), "2026-01-01", "2026-10-29", EUR);
    expect(pnl.status).toBe("verified");
    expect(pnl.openPositions).toBe(0);
    // P&L = 0.04 − 1,784.04 − (−1,156.17) = −627.83; realized = all of it but income and fees.
    expect(pnl.local).toMatchObject({
      pnlCents: 4n - 178_404n + (117_000n - 1_383n),
      incomeCents: 372n,
      feesCents: -1_383n,
      unrealizedChangeCents: 0n,
      unattributedCents: 0n,
    });
    expect(pnl.local!.realizedCents).toBe(pnl.local!.pnlCents - 372n + 1_383n);
    expectClosed(pnl);
    // 2025 had the coin open at the end: there the change is unrealized, against the cut-off.
    const before = pnlOf(service(book), "2025-01-01", "2025-12-31", EUR);
    expect(before.local).toMatchObject({ unrealizedChangeCents: 178_404n - 206_634n, realizedCents: 0n });
    expect(before).toMatchObject({ partial: false, startCents: 0n, openPositions: 1 });
  });
});

describe("cashGaps (PERS-145 · 4)", () => {
  it("eToro: the money in eToro Money and the conversions are one exchange cost, on the last flow's day", () => {
    // A USD account read by its total only: 0.33 $ for months, 2,000 € in (2,307.80 $ at the ECB),
    // two positions bought and closed, 2,401.58 € out (2,784.39 $ at the ECB), then nothing.
    const book: Book = {
      currency: "USD",
      periods: [
        {
          fromOn: "2025-11-02",
          startsAt: new Date("2025-11-02T00:00:00Z"),
          mode: "assets",
          origin: "synced",
        },
      ],
      events: [
        event("2025-11-02", [{ kind: "opening_cash", amountCents: 33n }]),
        event("2026-06-10", [{ kind: "deposit", amountCents: 230_780n, nativeCurrency: "EUR" }]),
        event("2026-06-12", [
          { leg: "base", kind: "buy", holdingId: "p1", quantity: qty("6.87"), amountCents: -228_012n },
        ]),
        event("2026-06-16", [
          { leg: "base", kind: "close", holdingId: "p1", quantity: qty("6.87"), amountCents: 279_994n },
        ]),
        event("2026-06-16", [{ kind: "withdrawal", amountCents: -278_439n, nativeCurrency: "EUR" }]),
      ],
      holdings: [{ id: "p1", assetId: "asset-p1", origin: "provider", product: "trading", currency: "USD" }],
      readings: [
        ...["2025-11-02", "2026-06-09"].map((on) => ({
          id: on,
          on,
          status: "complete" as const,
          totalCents: 33n,
          positions: [],
          scopes: [],
        })),
        { id: "a", on: "2026-06-10", status: "complete", totalCents: 230_738n, positions: [], scopes: [] },
        { id: "b", on: "2026-06-11", status: "complete", totalCents: 231_545n, positions: [], scopes: [] },
        { id: "c", on: "2026-06-12", status: "complete", totalCents: 209_842n, positions: [], scopes: [] },
        { id: "d", on: "2026-06-15", status: "complete", totalCents: 282_564n, positions: [], scopes: [] },
        { id: "e", on: "2026-06-16", status: "confirmed_zero", totalCents: 0n, positions: [], scopes: [] },
        { id: "f", on: "2026-06-17", status: "confirmed_zero", totalCents: 0n, positions: [], scopes: [] },
      ],
      reconciliations: [],
    };
    expect(cashGaps(book, "2025-11-02")).toEqual([
      { from: "2026-06-10", to: "2026-06-16", cents: -4_356n, exchange: true },
    ]);
    // Booked, the year closes on the realized and the exchange cost.
    const fixed = {
      ...book,
      events: [...book.events, event("2026-06-16", [{ kind: "fee", amountCents: -4_356n }])],
    };
    const pnl = pnlOf(service(fixed), "2026-01-01", "2026-10-29", { currency: "USD", rates: NO_RATES });
    expect(pnl.local).toMatchObject({
      pnlCents: 47_626n,
      realizedCents: 279_994n - 228_012n,
      feesCents: -4_356n,
      unrealizedChangeCents: 0n,
      unattributedCents: 0n,
    });
    // The money went in and out inside the year: Dietz has no capital to divide by, so the return
    // is on the money put in (0.33 + 2,307.80): +20.6 %.
    expect(pnl.localReturn).toMatchObject({ method: "invested" });
    expect(pnl.localReturn!.dietz).toBeCloseTo(47_626 / 230_813, 10);
  });

  it("a gap counts only once a day with no difference follows it", () => {
    const { book, leaked } = exchange(random(7), 40, 1);
    const last = [...leaked][0];
    const cut = { ...book, readings: book.readings.filter((one) => one.on <= last) };
    expect(cashGaps(cut, CUTOFF)).toEqual([]);
    expect(cashGaps(book, CUTOFF)).toHaveLength(1);
  });

  it("opens the cash of the cut-off, and reads a leg's cash as the parts do", () => {
    const book: Book = {
      currency: "USD",
      periods: [
        {
          fromOn: "2025-11-02",
          startsAt: new Date("2025-11-02T00:00:00Z"),
          mode: "assets",
          origin: "synced",
        },
      ],
      events: [],
      holdings: [],
      readings: [
        { id: "x", on: "2025-11-02", status: "complete", totalCents: 33n, positions: [], scopes: [] },
      ],
      reconciliations: [],
    };
    expect(openingCashAt(book, "2025-11-02")).toBe(33n);
    // An empty service opens too, at zero: its cut-off is booked all the same.
    const empty = { ...book, readings: [{ ...book.readings[0], totalCents: 0n }] };
    expect(openingCashAt(empty, "2025-11-02")).toBe(0n);
    const opened = { ...empty, events: [event("2025-11-02", [{ kind: "opening_cash", amountCents: 0n }])] };
    expect(pnlOf(service(opened), "2025-01-01", "2025-12-31", EUR)).toMatchObject({
      partial: false,
      from: "2025-01-01",
      startCents: 0n,
    });
    expect(openingCashAt({ ...book, readings: [] }, "2025-11-02")).toBeNull();
    const leg = (over: Partial<OperationLike>) =>
      ({
        leg: "main",
        holdingId: null,
        kind: "fee",
        quantity: null,
        unitPrice: null,
        priceCurrency: null,
        amountCents: -5n,
        fxRate: null,
        validUntil: null,
        ...over,
      }) as OperationLike;
    expect(cashImpact(leg({}))).toBe(-5n);
    expect(cashImpact(leg({ holdingId: "c1", quantity: qty("1") }))).toBe(0n);
    expect(cashImpact(leg({ kind: "buy", holdingId: "c1", amountCents: -10n }))).toBe(-10n);
    expect(cashImpact(leg({ kind: "buy", amountCents: -10n }))).toBe(0n);
  });
});
