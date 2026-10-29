import { describe, expect, it } from "vitest";
import { NO_RATES } from "@/platform/fx/rules";
import { pnlOf, type PnlService } from "./pnl";
import { closedGroups, contributionsOf, convertedCurrencies, onCostOf, periodReturnOf } from "./positions";
import {
  type Book,
  type EventLike,
  type OperationLike,
  parseDecimal,
  PRICE_SCALE,
  QUANTITY_SCALE,
} from "./rules";

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const eur = (value: number) => BigInt(Math.round(value * 100));
let seq = 0n;

function event(on: string, operations: Partial<OperationLike>[]): EventLike {
  seq += 1n;
  return {
    id: `e${seq}`,
    on,
    occurredAt: new Date(`${on}T12:00:00Z`),
    seq,
    origin: "manual",
    transferGroupId: null,
    operations: operations.map((op) => ({
      leg: "main",
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

const trade = (kind: "buy" | "sell", on: string, holdingId: string, units: string, unit: number) =>
  event(on, [
    {
      kind,
      holdingId,
      quantity: qty(units),
      unitPrice: parseDecimal(String(unit), PRICE_SCALE),
      priceCurrency: "EUR",
      amountCents: (kind === "buy" ? -1n : 1n) * eur(Number(units) * unit),
    },
  ]);
const valuation = (on: string, holdingId: string, unit: number) =>
  event(on, [
    {
      kind: "valuation",
      holdingId,
      unitPrice: parseDecimal(String(unit), PRICE_SCALE),
      priceCurrency: "EUR",
    },
  ]);

function book(events: EventLike[]): Book {
  return {
    currency: "EUR",
    periods: [
      { fromOn: "2025-01-01", startsAt: new Date("2025-01-01T00:00:00Z"), mode: "assets", origin: "manual" },
    ],
    events,
    holdings: ["h1", "h2", "h3"].map((id) => ({
      id,
      assetId: `asset-${id}`,
      origin: "manual" as const,
      product: "spot",
      currency: "EUR",
    })),
    readings: [],
    reconciliations: [],
  };
}

const service = (one: Book): PnlService => ({
  accountId: "a1",
  currency: "EUR",
  book: one,
  rates: NO_RATES,
  coverage: null,
  quantityMismatch: false,
  externalIds: new Map(),
});
const EUR = { currency: "EUR", rates: NO_RATES };

// Bought h1 at 100 in 2025, worth 150 on 31/12, sold at 160 in 2026 (+10 to 2026); h2 bought in
// 2026 at 50, worth 70; a fee and a dividend in 2026; h3 untouched in 2026.
const sample = book([
  event("2025-01-02", [{ kind: "deposit", amountCents: eur(1000) }]),
  trade("buy", "2025-01-03", "h1", "1", 100),
  trade("buy", "2025-01-03", "h3", "1", 10),
  valuation("2025-12-31", "h1", 150),
  trade("sell", "2026-03-01", "h1", "1", 160),
  trade("buy", "2026-04-01", "h2", "1", 50),
  event("2026-04-01", [{ kind: "fee", amountCents: -eur(2) }]),
  event("2026-05-01", [{ kind: "income", holdingId: "h2", amountCents: eur(3) }]),
  valuation("2026-06-30", "h2", 70),
]);

describe("contributionsOf (§3.4, PERS-113 · 9)", () => {
  it("open and sold positions in one list, the largest first, closing on the service's P&L", () => {
    const pnl = pnlOf(service(sample), "2026-01-01", "2026-06-30", EUR);
    const parts = contributionsOf(pnl)!;
    expect(parts.rows.map((row) => [row.key, row.cents, row.open, row.sold])).toEqual([
      ["h2", eur(20), true, false],
      ["h1", eur(10), false, true],
    ]);
    expect(parts.rows.map((row) => row.bar)).toEqual([1, 0.5]);
    const sum =
      parts.rows.reduce((total, row) => total + row.cents, 0n) +
      parts.incomeCents +
      parts.feesCents +
      parts.correctionsCents +
      parts.valueChangeCents +
      parts.unattributedCents;
    expect(sum).toBe(parts.totalCents);
    expect(parts.totalCents).toBe(pnl.local!.pnlCents);
    expect(parts).toMatchObject({ incomeCents: eur(3), feesCents: -eur(2), valueChangeCents: 0n });
  });

  it("a position bought in the period: its period return is on cost; an older one on its value at s⁻", () => {
    const pnl = pnlOf(service(sample), "2026-01-01", "2026-06-30", EUR);
    const h2 = pnl.holdings.find((one) => one.key === "h2")!;
    expect(periodReturnOf(h2)).toBeCloseTo(0.4);
    expect(onCostOf(h2.end!)).toBeCloseTo(0.4);
    // h3: cost 10, still worth 10 since 2025 — 0 % in the period and on cost.
    const whole = pnlOf(service(sample), "2025-01-01", "2026-06-30", EUR);
    const h1 = whole.holdings.find((one) => one.key === "h1")!;
    expect(h1.contributionCents).toBe(eur(60));
  });

  it("is null when the P&L cannot be measured", () => {
    // A synced service with no reading: no value to measure.
    const unread: Book = {
      ...book([]),
      periods: [
        {
          fromOn: "2025-01-01",
          startsAt: new Date("2025-01-01T00:00:00Z"),
          mode: "assets",
          origin: "synced",
        },
      ],
    };
    expect(contributionsOf(pnlOf(service(unread), "2026-01-01", "2026-06-30", EUR))).toBeNull();
  });
});

describe("closedGroups (§3.4)", () => {
  it("one row per position, with what it cost and what came back, the realized matching the KPI", () => {
    const pnl = pnlOf(service(sample), "2026-01-01", "2026-06-30", EUR);
    const groups = closedGroups(pnl.exits);
    expect(groups).toEqual([
      {
        holdingId: "h1",
        count: 1,
        positions: 0,
        openedOn: "2025-01-03",
        closedOn: "2026-03-01",
        costCents: eur(100),
        proceedsCents: eur(160),
        realizedCents: eur(60),
        onCost: 0.6,
      },
    ]);
    expect(groups.reduce((sum, one) => sum + (one.realizedCents ?? 0n), 0n)).toBe(pnl.local!.realizedCents);
  });

  it("joins the exits of a position, the latest first, and an unknown cost makes the realized unknown", () => {
    const groups = closedGroups([
      {
        eventId: "a",
        on: "2026-02-01",
        holdingId: "h1",
        kind: "close",
        proceedsCents: 120n,
        costCents: 100n,
        realizedCents: 20n,
        matched: "position",
        openedOn: "2026-01-10",
      },
      {
        eventId: "b",
        on: "2026-03-01",
        holdingId: "h1",
        kind: "close",
        proceedsCents: 90n,
        costCents: 100n,
        realizedCents: -10n,
        matched: "position",
        openedOn: "2026-01-05",
      },
      {
        eventId: "c",
        on: "2026-01-15",
        holdingId: "h2",
        kind: "sell",
        proceedsCents: 50n,
        costCents: 0n,
        realizedCents: null,
        matched: "average",
        openedOn: null,
      },
    ]);
    expect(
      groups.map((one) => [one.holdingId, one.count, one.openedOn, one.closedOn, one.realizedCents]),
    ).toEqual([
      ["h1", 2, "2026-01-05", "2026-03-01", 10n],
      ["h2", 1, null, "2026-01-15", null],
    ]);
    expect(groups[0].onCost).toBeCloseTo(0.05);
    expect(groups[1].onCost).toBeNull();
  });
});

describe("convertedCurrencies (PERS-119)", () => {
  it("names the currencies a provider booked cash flows in, apart from the account's", () => {
    const flows = book([
      event("2026-06-10", [{ kind: "deposit", amountCents: eur(2307.8), nativeCurrency: "EUR" }]),
      event("2026-06-16", [{ kind: "withdrawal", amountCents: -eur(100), nativeCurrency: "EUR" }]),
    ]);
    const usd = { ...flows, currency: "USD" };
    expect(convertedCurrencies(pnlOf({ ...service(usd), currency: "USD" }, null, "2026-06-30", EUR))).toEqual(
      ["EUR"],
    );
    // The account's own currency is no conversion.
    expect(convertedCurrencies(pnlOf(service(flows), null, "2026-06-30", EUR))).toEqual([]);
  });
});
