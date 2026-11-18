import { describe, expect, it } from "vitest";
import { estimateHistory, HISTORY_RATE_SCALE, type HistoryLeg, historyMoves } from "./history";
import { QUANTITY_SCALE } from "./rules";

const qty = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(QUANTITY_SCALE, "0"));
};
const rate = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(HISTORY_RATE_SCALE, "0"));
};
const leg = (input: Partial<HistoryLeg> & Pick<HistoryLeg, "on" | "kind">): HistoryLeg => ({
  symbol: null,
  quantity: null,
  nativeCurrency: null,
  amountCents: 0n,
  ...input,
});

describe("historyMoves (PERS-100)", () => {
  it("moves a coin by its quantity and the cash by the legs without a holding", () => {
    const moves = historyMoves(
      [
        leg({ on: "2025-01-02", kind: "deposit", nativeCurrency: "EUR", amountCents: 80_050n }),
        leg({ on: "2025-01-02", kind: "fee", nativeCurrency: "EUR", amountCents: -100n }),
        leg({ on: "2025-01-03", kind: "buy", symbol: "ETH", quantity: qty("0.5"), nativeCurrency: "USDT" }),
        leg({ on: "2025-01-04", kind: "fee", symbol: "BNB", quantity: qty("0.001"), nativeCurrency: "BNB" }),
      ],
      "EUR",
    );
    expect(moves).toEqual([
      { on: "2025-01-02", symbol: null, delta: 80_050n },
      { on: "2025-01-02", symbol: null, delta: -100n },
      { on: "2025-01-03", symbol: "ETH", delta: qty("0.5") },
      { on: "2025-01-04", symbol: "BNB", delta: -qty("0.001") },
    ]);
  });

  it("moves the cash the other way when a coin is traded against the account's currency", () => {
    // A card purchase: 200 € in, 196 € of BNB bought, 4 € of fee — the cash ends where it began.
    const card = historyMoves(
      [
        leg({ on: "2025-01-25", kind: "deposit", nativeCurrency: "EUR", amountCents: 20_000n }),
        leg({
          on: "2025-01-25",
          kind: "buy",
          symbol: "BNB",
          quantity: qty("0.29"),
          nativeCurrency: "EUR",
          amountCents: -19_600n,
        }),
        leg({ on: "2025-01-25", kind: "fee", nativeCurrency: "EUR", amountCents: -400n }),
      ],
      "EUR",
    );
    const cash = card.filter((move) => move.symbol === null).reduce((sum, move) => sum + move.delta, 0n);
    expect(cash).toBe(0n);
    // `EUR/USDT`: selling the euro is cash out, the USDT bought is the coin in.
    const pair = historyMoves(
      [
        leg({ on: "2024-11-12", kind: "sell", nativeCurrency: "USDT", amountCents: 79_569n }),
        leg({
          on: "2024-11-12",
          kind: "buy",
          symbol: "USDT",
          quantity: qty("852.34"),
          nativeCurrency: "USDT",
          amountCents: -79_569n,
        }),
      ],
      "EUR",
    );
    expect(pair).toEqual([
      { on: "2024-11-12", symbol: null, delta: -79_569n },
      { on: "2024-11-12", symbol: "USDT", delta: qty("852.34") },
    ]);
  });

  it("leaves an inferred opening out: it is already in the anchor", () => {
    expect(
      historyMoves([leg({ on: "2024-10-28", kind: "opening_position", amountCents: 0n })], "EUR"),
    ).toEqual([]);
  });
});

describe("estimateHistory (PERS-100)", () => {
  const anchor = { on: "2025-01-05", quantities: new Map([["ETH", qty("1")]]), cashCents: 1_000n };

  it("walks back from the first reading, undoing every later move", () => {
    const days = estimateHistory({
      days: ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"],
      anchor,
      moves: [
        { on: "2025-01-03", symbol: "ETH", delta: qty("0.5") },
        { on: "2025-01-03", symbol: null, delta: -50_000n },
        { on: "2025-01-05", symbol: "ETH", delta: qty("0.25") },
      ],
      rate: () => rate("2000"),
    });
    // On the 4th: 0.75 ETH (the 5th's 0.25 undone) and 10 €; before the 3rd: 0.25 ETH and 510 €.
    expect(days.map(({ on, totalCents, missingPrices }) => ({ on, totalCents, missingPrices }))).toEqual([
      { on: "2025-01-01", totalCents: 50_000n + 51_000n, missingPrices: 0 },
      { on: "2025-01-02", totalCents: 50_000n + 51_000n, missingPrices: 0 },
      { on: "2025-01-03", totalCents: 150_000n + 1_000n, missingPrices: 0 },
      { on: "2025-01-04", totalCents: 150_000n + 1_000n, missingPrices: 0 },
    ]);
    // Each day keeps its positions and its cash (PERS-141): the P&L reads them at the start.
    expect(days[0]).toMatchObject({
      cashCents: 51_000n,
      positions: [{ symbol: "ETH", quantity: qty("0.25"), valueCents: 50_000n }],
    });
    expect(days[3].positions).toEqual([{ symbol: "ETH", quantity: qty("0.75"), valueCents: 150_000n }]);
  });

  it("carries the last close over a day with none, and counts a coin never priced as missing", () => {
    const days = estimateHistory({
      days: ["2025-01-01", "2025-01-02"],
      anchor: {
        on: "2025-01-03",
        quantities: new Map([
          ["ETH", qty("1")],
          ["XYZ", qty("10")],
        ]),
        cashCents: 0n,
      },
      moves: [],
      rate: (symbol, on) => (symbol === "ETH" && on === "2025-01-01" ? rate("1000.5") : null),
    });
    expect(days.map(({ on, totalCents, missingPrices }) => ({ on, totalCents, missingPrices }))).toEqual([
      { on: "2025-01-01", totalCents: 100_050n, missingPrices: 1 },
      { on: "2025-01-02", totalCents: 100_050n, missingPrices: 1 },
    ]);
    expect(days[1].positions).toEqual([
      { symbol: "ETH", quantity: qty("1"), valueCents: 100_050n },
      { symbol: "XYZ", quantity: qty("10"), valueCents: null },
    ]);
  });

  it("counts below zero as nothing, and dust without a price as no missing price", () => {
    const days = estimateHistory({
      days: ["2025-01-01"],
      anchor: { on: "2025-01-02", quantities: new Map([["ETHW", qty("0.0000765")]]), cashCents: 0n },
      moves: [
        { on: "2025-01-02", symbol: "USDT", delta: qty("224") },
        { on: "2025-01-02", symbol: null, delta: 5_000n },
      ],
      rate: (symbol) => (symbol === "USDT" ? rate("0.9") : null),
    });
    expect(days).toEqual([
      {
        on: "2025-01-01",
        totalCents: 0n,
        missingPrices: 0,
        cashCents: 0n,
        positions: [{ symbol: "ETHW", quantity: qty("0.0000765"), valueCents: null }],
      },
    ]);
  });

  it("estimates nothing on or after the anchor", () => {
    expect(
      estimateHistory({ days: ["2025-01-05", "2025-01-06"], anchor, moves: [], rate: () => null }),
    ).toEqual([]);
  });
});
