import { describe, expect, it } from "vitest";
import { parseAmount } from "@/modules/accounts/rules";
import {
  formatAmountInput,
  formatDate,
  formatWholePercent,
  formatMoney,
  formatPercent,
  type NumberStyle,
  numberSeparators,
} from "./format";

/** Intl uses no-break spaces (U+00A0, U+202F); compare with plain spaces. */
const plain = (s: string) => s.replace(/\s/g, " ");

/** A saved style: the number format plus the two explicit overrides, either of them left alone. */
const style = (over: Partial<NumberStyle> = {}): NumberStyle => ({
  format: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
  ...over,
});

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

  it("leaves a style with no override formatting exactly as the format alone does", () => {
    for (const format of ["it-IT", "en-US", "fr-FR"] as const) {
      expect(formatMoney(123456n, style({ format }))).toBe(formatMoney(123456n, format));
      expect(formatMoney(-31240n, style({ format }))).toBe(formatMoney(-31240n, format));
    }
  });

  it("takes the decimal separator and the euro's side from the preferences, in any combination", () => {
    const money = (over: Partial<NumberStyle>) => plain(formatMoney(123456n, style(over)));
    expect(money({ decimalSeparator: ",", currencyPosition: "after" })).toBe("1.234,56 €");
    expect(money({ decimalSeparator: ",", currencyPosition: "before" })).toBe("€ 1.234,56");
    expect(money({ decimalSeparator: ".", currencyPosition: "after" })).toBe("1,234.56 €");
    expect(money({ decimalSeparator: ".", currencyPosition: "before" })).toBe("€ 1,234.56");
  });

  it("keeps the thousands separator different from the decimal one, whatever the format", () => {
    // en-US natively groups with the character an Italian decimal uses, and the other way round:
    // the two swap rather than collide. fr-FR groups with a narrow space, which collides with neither.
    expect(numberSeparators(style({ format: "it-IT", decimalSeparator: "." }))).toEqual({
      decimal: ".",
      group: ",",
    });
    expect(numberSeparators(style({ format: "en-US", decimalSeparator: "," }))).toEqual({
      decimal: ",",
      group: ".",
    });
    for (const format of ["it-IT", "en-US", "fr-FR"] as const) {
      for (const decimalSeparator of [".", ","] as const) {
        const { decimal, group } = numberSeparators(style({ format, decimalSeparator }));
        expect(decimal).toBe(decimalSeparator);
        expect(group).not.toBe(decimal);
      }
    }
    expect(plain(formatMoney(123456n, style({ format: "en-US", decimalSeparator: "," })))).toBe("€1.234,56");
    expect(plain(formatMoney(123456n, style({ format: "fr-FR", decimalSeparator: "." })))).toBe("1 234.56 €");
  });

  it("keeps the typographic minus, the explicit plus and the dash in front of the chosen layout", () => {
    const flipped = style({ decimalSeparator: ".", currencyPosition: "before" });
    expect(plain(formatMoney(-31240n, flipped))).toBe("−€ 312.40");
    expect(plain(formatMoney(136710n, flipped, { signed: true }))).toBe("+€ 1,367.10");
    expect(plain(formatMoney(4095000n, flipped, { decimals: false }))).toBe("€ 40,950");
    expect(formatMoney(null, flipped)).toBe("—");
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

describe("formatAmountInput", () => {
  it("writes the decimal separator of the format and no grouping", () => {
    expect(formatAmountInput(123_456n, "it-IT")).toBe("1234,56");
    expect(formatAmountInput(123_456n, "en-US")).toBe("1234.56");
    expect(formatAmountInput(-50n, "fr-FR")).toBe("-0,50");
    expect(formatAmountInput(null, "it-IT")).toBe("");
  });

  it("writes the chosen decimal separator, overriding the format's own", () => {
    expect(formatAmountInput(123_456n, style({ format: "it-IT", decimalSeparator: "." }))).toBe("1234.56");
    expect(formatAmountInput(123_456n, style({ format: "en-US", decimalSeparator: "," }))).toBe("1234,56");
  });

  it("is read back to the same cents by parseAmount, with either separator", () => {
    for (const format of ["it-IT", "en-US", "fr-FR"] as const) {
      for (const decimalSeparator of [null, ".", ","] as const) {
        const chosen = style({ format, decimalSeparator });
        for (const cents of [123_456n, -50n, 0n, 100_000_000n]) {
          expect(parseAmount(formatAmountInput(cents, chosen), chosen)).toBe(cents);
        }
        // And grouped as the same style displays it, which is what a person copies back into a field.
        expect(parseAmount(formatMoney(123_456n, chosen), chosen)).toBe(123_456n);
      }
    }
  });
});

describe("formatWholePercent", () => {
  it("rounds to a whole number with the locale's spacing", () => {
    expect(plain(formatWholePercent(112, "it-IT"))).toBe("112 %");
    expect(formatWholePercent(88, "en-US")).toBe("88%");
    expect(plain(formatWholePercent(1234, "it-IT"))).toBe("1.234 %");
  });
});

describe("formatPercent and formatWholePercent", () => {
  it("use the chosen separators too, so a percentage never contradicts an amount", () => {
    expect(plain(formatPercent(0.297, style({ decimalSeparator: "." })))).toBe("29.7 %");
    expect(plain(formatWholePercent(1234, style({ decimalSeparator: "." })))).toBe("1,234 %");
    expect(plain(formatPercent(0.297, style()))).toBe("29,7 %");
  });
});
