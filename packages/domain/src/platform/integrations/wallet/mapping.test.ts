// What is left of the Wallet mapping in the core: the amount of the interest posting's records and
// the windows a pass reads. The rest is the plugin's (`plugins/wallet/src/plugin.test.ts`).
import { describe, expect, it } from "vitest";
import { firstLinkWindows, monthWindow, recentWindow, walletAmountToCents } from "./mapping";

describe("walletAmountToCents", () => {
  it.each([
    ["1234.56", 123456n],
    ["-8.615", -862n],
    ["1.005", 101n],
    ["0.1", 10n],
    ["1900", 190000n],
    ["+12.3", 1230n],
    [" 7.10 ", 710n],
  ])("reads the source text %s as cents", (text, expected) => {
    expect(walletAmountToCents(text)).toBe(expected);
  });

  it("converts a genuine JSON number through its fixed decimal representation", () => {
    expect(walletAmountToCents(0.1 + 0.2)).toBe(30n);
    expect(walletAmountToCents(2615.39)).toBe(261539n);
    expect(walletAmountToCents(-432.1)).toBe(-43210n);
  });

  it("routes exponent notation, which is legal JSON, through the same conversion", () => {
    expect(walletAmountToCents("1e3")).toBe(100000n);
    expect(walletAmountToCents("-1.5E2")).toBe(-15000n);
  });

  it.each(["", "   ", "abc", "1.234,56", "€1"])("rejects %s", (text) => {
    expect(() => walletAmountToCents(text)).toThrow(RangeError);
  });
});

describe("firstLinkWindows", () => {
  it("builds twelve monthly windows ending with today's own month", () => {
    const windows = firstLinkWindows("2026-03-14");
    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({ from: "2025-04-01", to: "2025-04-30" });
    expect(windows[11]).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    for (const [index, window] of windows.entries()) {
      if (index === 0) continue;
      expect(window.from > windows[index - 1].to).toBe(true);
    }
  });

  it("gets February right in a leap year", () => {
    expect(firstLinkWindows("2028-02-15").at(-1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthWindow("2027-02-01")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("takes a different month count, and rejects a nonsensical one", () => {
    expect(firstLinkWindows("2026-03-14", 1)).toEqual([{ from: "2026-03-01", to: "2026-03-31" }]);
    expect(() => firstLinkWindows("2026-03-14", 0)).toThrow(RangeError);
    expect(() => firstLinkWindows("14/03/2026")).toThrow(RangeError);
  });
});

describe("recentWindow", () => {
  it("covers exactly the last seven civil days, today included", () => {
    expect(recentWindow("2026-03-01")).toEqual({ from: "2026-02-23", to: "2026-03-01" });
    expect(recentWindow("2026-03-01", 1)).toEqual({ from: "2026-03-01", to: "2026-03-01" });
  });

  it("rejects a day count or a date it cannot use", () => {
    expect(() => recentWindow("2026-03-01", 0)).toThrow(RangeError);
    expect(() => recentWindow("not-a-date")).toThrow(RangeError);
  });
});
