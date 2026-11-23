import { describe, expect, it } from "vitest";
import type { CivilDate } from "../../shared/dates";
import { classOf, isIsin, isStale, orderListings, pickDue, rangeToRead, workingDaysBetween } from "./rules";

const d = (text: string) => text as CivilDate;

describe("the working days", () => {
  it("count the weekdays after the first day, up to the last", () => {
    // 2026-11-20 is a Friday.
    expect(workingDaysBetween(d("2026-11-20"), d("2026-11-20"))).toBe(0);
    expect(workingDaysBetween(d("2026-11-20"), d("2026-11-22"))).toBe(0);
    expect(workingDaysBetween(d("2026-11-20"), d("2026-11-23"))).toBe(1);
    expect(workingDaysBetween(d("2026-11-20"), d("2026-11-27"))).toBe(5);
    expect(workingDaysBetween(d("2026-11-20"), d("2026-12-21"))).toBe(21);
  });
});

describe("«to update»", () => {
  it("is a price older than 5 working days, or none", () => {
    expect(isStale(d("2026-11-20"), d("2026-11-27"))).toBe(false);
    expect(isStale(d("2026-11-20"), d("2026-11-30"))).toBe(true);
    expect(isStale(null, d("2026-11-27"))).toBe(true);
  });
});

describe("the days to read", () => {
  it("are the last 10 again, or from the last price when it is older", () => {
    expect(rangeToRead(d("2026-11-20"), d("2026-01-01"), d("2026-11-22"))).toEqual({
      from: "2026-11-12",
      to: "2026-11-22",
    });
    expect(rangeToRead(d("2026-10-01"), d("2026-01-01"), d("2026-11-22"))).toEqual({
      from: "2026-10-01",
      to: "2026-11-22",
    });
  });

  it("go back to what the asset needs for a market with no price, two years at most", () => {
    expect(rangeToRead(null, d("2026-03-02"), d("2026-11-22"))).toEqual({
      from: "2026-03-02",
      to: "2026-11-22",
    });
    expect(rangeToRead(null, d("2020-01-01"), d("2026-11-22"))).toEqual({
      from: "2024-11-22",
      to: "2026-11-22",
    });
  });
});

describe("the markets of a run", () => {
  it("take the oldest price first, a market with none before all, within the cap", () => {
    const markets = [
      { id: "a", lastOn: d("2026-11-20") },
      { id: "b", lastOn: null },
      { id: "c", lastOn: d("2026-11-10") },
    ];
    expect(pickDue(markets, 2).map((one) => one.id)).toEqual(["b", "c"]);
    expect(pickDue(markets, 0)).toEqual([]);
  });

  it("are proposed Borsa Italiana first, then Xetra, Euronext, the US and the others", () => {
    const mics = ["XLON", "XNAS", "XPAR", "XETR", "XMIL", "XSWX"].map((mic) => ({ mic }));
    expect(orderListings(mics).map((one) => one.mic)).toEqual([
      "XMIL",
      "XETR",
      "XPAR",
      "XNAS",
      "XLON",
      "XSWX",
    ]);
  });
});

describe("the class of an instrument", () => {
  it("comes from the CFI code first, then from the security type", () => {
    expect(classOf("CEOGLS", null)).toBe("etf");
    expect(classOf("CIOGEU", null)).toBe("fund");
    expect(classOf("ESVUFR", "ETP")).toBe("stock");
    expect(classOf("DBFTFB", null)).toBe("bond");
    expect(classOf(null, "ETP")).toBe("etf");
    expect(classOf(null, "Common Stock")).toBe("stock");
    expect(classOf(null, "Warrant")).toBe("other");
  });
});

describe("an ISIN", () => {
  it("has its shape and a right check digit", () => {
    expect(isIsin("US0378331005")).toBe(true);
    expect(isIsin("US0378331006")).toBe(false);
    expect(isIsin("us0378331005")).toBe(false);
    expect(isIsin("VWCE")).toBe(false);
  });
});
