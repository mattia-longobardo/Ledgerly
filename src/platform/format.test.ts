import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatPercent } from "./format";

/** Intl uses no-break spaces (U+00A0, U+202F); compare with plain spaces. */
const plain = (s: string) => s.replace(/\s/g, " ");

describe("formatMoney", () => {
  it("always groups thousands, even for four-digit amounts", () => {
    expect(plain(formatMoney(713595n, "it-IT"))).toBe("7.135,95 €");
    expect(plain(formatMoney(5914590n, "it-IT"))).toBe("59.145,90 €");
  });

  it("uses a true minus sign and an explicit plus when signed", () => {
    expect(plain(formatMoney(-31240n, "it-IT"))).toBe("−312,40 €");
    expect(plain(formatMoney(136710n, "it-IT", { signed: true }))).toBe("+1.367,10 €");
    expect(plain(formatMoney(0n, "it-IT", { signed: true }))).toBe("0,00 €");
  });

  it("can drop decimals and renders unknown as a dash", () => {
    expect(plain(formatMoney(4095000n, "it-IT", { decimals: false }))).toBe("40.950 €");
    expect(formatMoney(null, "it-IT")).toBe("—");
  });

  it("follows the chosen number format", () => {
    expect(plain(formatMoney(123456n, "en-US"))).toBe("€1,234.56");
    expect(plain(formatMoney(123456n, "fr-FR"))).toBe("1 234,56 €");
  });
});

describe("formatPercent", () => {
  it("puts a space before % outside en-US and signs on request", () => {
    expect(plain(formatPercent(0.016, "it-IT", { signed: true }))).toBe("+1,6 %");
    expect(plain(formatPercent(-0.107, "it-IT", { signed: true }))).toBe("−10,7 %");
    expect(plain(formatPercent(0.297, "it-IT"))).toBe("29,7 %");
    expect(formatPercent(0.297, "en-US")).toBe("29.7%");
    expect(plain(formatPercent(0.0275, "it-IT", { decimals: 2 }))).toBe("2,75 %");
    expect(formatPercent(null, "it-IT")).toBe("—");
  });
});

describe("formatDate", () => {
  it("formats civil dates without timezone drift", () => {
    expect(formatDate("2026-09-09", "dayMonth", "en")).toBe("09 Sep");
    expect(formatDate("2026-09-01", "long", "en")).toBe("1 Sep 2026");
    expect(formatDate("2026-09-01", "monthYear", "en")).toBe("September 2026");
    expect(formatDate("2026-09-01", "monthShort", "en")).toBe("Sep 26");
    expect(formatDate("2026-09-01", "month", "en")).toBe("Sep");
    expect(formatDate("2026-09-01", "month", "it")).toBe("set");
    expect(formatDate("2026-09-09", "dayMonth", "it")).toBe("09 set");
    expect(formatDate("2026-09-01", "monthYear", "it")).toBe("settembre 2026");
    expect(formatDate(null, "long", "en")).toBe("—");
  });
});
