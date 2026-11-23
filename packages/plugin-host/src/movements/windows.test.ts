// What is left of the Wallet mapping in the core: the windows a pass reads. The rest is the plugin's
// (`plugins/wallet/src/plugin.test.ts`).
import { describe, expect, it } from "vitest";
import { firstLinkWindows, monthWindow, recentWindow } from "./windows";

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
