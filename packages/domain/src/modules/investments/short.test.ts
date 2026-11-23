import { describe, expect, it } from "vitest";
import { type Book, type EventLike, negativeCash, QUANTITY_SCALE, shortPosition } from "./rules";
import { parseDecimal } from "../../shared/money";

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
let seq = 0n;

function move(
  on: string,
  kind: "buy" | "sell" | "close" | "opening_position",
  holdingId: string,
  units: string | null,
): EventLike {
  seq += 1n;
  return {
    id: `e${seq}`,
    on,
    occurredAt: new Date(`${on}T12:00:00Z`),
    seq,
    origin: "manual",
    transferGroupId: null,
    operations: [
      {
        leg: "main",
        holdingId,
        kind,
        quantity: units === null ? null : qty(units),
        unitPrice: null,
        priceCurrency: "EUR",
        amountCents: 0n,
        fxRate: null,
        validUntil: null,
      },
    ],
  };
}

function book(events: EventLike[], origin: "manual" | "provider" = "manual"): Book {
  return {
    currency: "EUR",
    periods: [
      { fromOn: "2026-01-01", startsAt: new Date("2026-01-01T00:00:00Z"), mode: "assets", origin: "manual" },
    ],
    events,
    holdings: [{ id: "h1", assetId: "a1", origin, product: "custody", currency: "EUR" }],
    readings: [],
    reconciliations: [],
  };
}

describe("a sale of more than is held", () => {
  it("is found on the day the position goes below zero", () => {
    const short = book([move("2026-02-01", "buy", "h1", "10"), move("2026-03-01", "sell", "h1", "10.5")]);
    expect(shortPosition(short)).toEqual({ holdingId: "h1", on: "2026-03-01" });
  });

  it("is not a sale of all that is held, nor a sale typed before a purchase of the same day", () => {
    expect(
      shortPosition(book([move("2026-02-01", "buy", "h1", "10"), move("2026-03-01", "sell", "h1", "10")])),
    ).toBeNull();
    expect(
      shortPosition(book([move("2026-02-01", "sell", "h1", "4"), move("2026-02-01", "buy", "h1", "5")])),
    ).toBeNull();
  });

  it("is a purchase taken away under a later sale, and a close of more than is left", () => {
    expect(shortPosition(book([move("2026-03-01", "sell", "h1", "1")]))).toEqual({
      holdingId: "h1",
      on: "2026-03-01",
    });
    const closed = book([
      move("2026-01-02", "opening_position", "h1", "3"),
      move("2026-03-01", "close", "h1", "4"),
    ]);
    expect(shortPosition(closed)).toEqual({ holdingId: "h1", on: "2026-03-01" });
    expect(
      shortPosition(
        book([move("2026-01-02", "opening_position", "h1", "3"), move("2026-03-01", "close", "h1", null)]),
      ),
    ).toBeNull();
  });

  it("counts only the positions kept by hand: a provider's are its own", () => {
    expect(shortPosition(book([move("2026-03-01", "sell", "h1", "1")], "provider"))).toBeNull();
  });
});

describe("cash below zero", () => {
  const cash = (on: string, kind: "deposit" | "withdrawal" | "buy", cents: bigint): EventLike => {
    const one = move(on, "buy", "h1", null);
    return {
      ...one,
      operations: [
        { ...one.operations[0], kind, holdingId: kind === "buy" ? "h1" : null, amountCents: cents },
      ],
    };
  };

  it("is the end of the first day whose cash is below zero, whatever the order of its operations", () => {
    expect(
      negativeCash(book([cash("2026-02-01", "buy", -100n), cash("2026-02-01", "deposit", 100n)])),
    ).toBeNull();
    expect(negativeCash(book([cash("2026-02-01", "deposit", 100n), cash("2026-02-03", "buy", -150n)]))).toBe(
      "2026-02-03",
    );
    expect(
      negativeCash(book([cash("2026-02-01", "deposit", 100n), cash("2026-02-02", "withdrawal", -100n)])),
    ).toBeNull();
  });
});
