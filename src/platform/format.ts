import { type CivilDate, isCivilDate } from "./dates";
import { type Cents, centsToDecimal } from "./money";

/** The saved `number_format` preference: the locale whose conventions a number starts from. */
export type NumberFormatName = "it-IT" | "en-US" | "fr-FR";
export type DecimalSeparator = "." | ",";
/** Where the euro sign goes: `€ 1.234,56` or `1.234,56 €`. */
export type CurrencyPosition = "before" | "after";

/**
 * A number format plus the two explicit overrides a user can set (Settings › Profile):
 * `null` on either means "whatever the chosen format does", so a preference left alone
 * formats exactly as it did before the overrides existed.
 */
export interface NumberStyle {
  format: NumberFormatName;
  decimalSeparator: DecimalSeparator | null;
  currencyPosition: CurrencyPosition | null;
}

/**
 * What every formatting function accepts: a bare format name (fixtures, the component gallery)
 * or the user's full style. `Ctx.numberFormat` carries the style, so every call site that already
 * passes `ctx.numberFormat` picks the overrides up with no change.
 */
export type NumberFormat = NumberFormatName | NumberStyle;

export type UiLocale = "en" | "it";

export const NULL_DISPLAY = "—";
const MINUS = "−";
const NBSP = " ";
const EURO = "€";

/** Builds the style carried by `Ctx` from the saved preferences. */
export function numberStyle(prefs: {
  numberFormat: NumberFormatName;
  decimalSeparator: DecimalSeparator | null;
  currencyPosition: CurrencyPosition | null;
}): NumberStyle {
  return {
    format: prefs.numberFormat,
    decimalSeparator: prefs.decimalSeparator,
    currencyPosition: prefs.currencyPosition,
  };
}

interface Native {
  decimal: string;
  group: string;
  position: CurrencyPosition;
  /** What the locale puts between the euro sign and the digits: nothing, or a no-break space. */
  gap: string;
}

const NATIVE = new Map<NumberFormatName, Native>();

/** What the format itself does, read from Intl once per format (fr-FR groups with U+202F). */
function nativeOf(name: NumberFormatName): Native {
  const cached = NATIVE.get(name);
  if (cached) return cached;
  const plain = new Intl.NumberFormat(name, {
    minimumFractionDigits: 2,
    useGrouping: "always",
  }).formatToParts(1234.5);
  const money = new Intl.NumberFormat(name, { style: "currency", currency: "EUR" }).formatToParts(1);
  const currencyAt = money.findIndex((part) => part.type === "currency");
  const digitsAt = money.findIndex((part) => part.type === "integer");
  const position: CurrencyPosition = currencyAt < digitsAt ? "before" : "after";
  const neighbour = money[position === "before" ? currencyAt + 1 : currencyAt - 1];
  const native: Native = {
    decimal: plain.find((part) => part.type === "decimal")?.value ?? ".",
    group: plain.find((part) => part.type === "group")?.value ?? ",",
    position,
    gap: neighbour?.type === "literal" ? neighbour.value : "",
  };
  NATIVE.set(name, native);
  return native;
}

interface Resolved extends Native {
  name: NumberFormatName;
}

/**
 * The separators and the euro placement actually used. A number can never show the same character
 * for both roles: when the chosen decimal separator is the format's own grouping character, the
 * two swap (it-IT with a decimal point groups with commas, en-US with a decimal comma groups with
 * points); fr-FR groups with a narrow space, which collides with neither and stays.
 */
function resolveStyle(format: NumberFormat): Resolved {
  const style: NumberStyle =
    typeof format === "string" ? { format, decimalSeparator: null, currencyPosition: null } : format;
  const native = nativeOf(style.format);
  const decimal = style.decimalSeparator ?? native.decimal;
  const group = native.group === decimal ? native.decimal : native.group;
  const position = style.currencyPosition ?? native.position;
  return {
    name: style.format,
    decimal,
    group,
    position,
    // Flipping the euro sign to the other side of the number always leaves a space between them:
    // "1,234.56 €" for a format that natively writes "€1,234.56" with none.
    gap: position === native.position ? native.gap : NBSP,
  };
}

/** The separators an amount is written with, for a field that reads back what it wrote (`parseAmount`). */
export function numberSeparators(format: NumberFormat): { decimal: string; group: string } {
  const { decimal, group } = resolveStyle(format);
  return { decimal, group };
}

/** The sign (a typographic minus, or an explicit plus) split from the digits, with our separators. */
function digitsOf(
  value: number | `${number}`,
  style: Resolved,
  options: Intl.NumberFormatOptions,
): { sign: string; body: string } {
  // A decimal string is formatted exactly (Intl.NumberFormat v3): no float on the way.
  const parts = new Intl.NumberFormat(style.name, { useGrouping: "always", ...options }).formatToParts(value);
  let sign = "";
  let body = "";
  for (const part of parts) {
    if (part.type === "minusSign") sign = MINUS;
    else if (part.type === "plusSign") sign = "+";
    else if (part.type === "group") body += style.group;
    else if (part.type === "decimal") body += style.decimal;
    else body += part.value;
  }
  return { sign, body };
}

export function formatMoney(
  cents: Cents | null,
  format: NumberFormat,
  options: { decimals?: boolean; signed?: boolean } = {},
): string {
  if (cents === null) return NULL_DISPLAY;
  const digits = options.decimals === false ? 0 : 2;
  const style = resolveStyle(format);
  const { sign, body } = digitsOf(centsToDecimal(cents) as `${number}`, style, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
  return style.position === "before"
    ? `${sign}${EURO}${style.gap}${body}`
    : `${sign}${body}${style.gap}${EURO}`;
}

export function formatPercent(
  fraction: number | null,
  format: NumberFormat,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  if (fraction === null) return NULL_DISPLAY;
  const digits = options.decimals ?? 1;
  const style = resolveStyle(format);
  const { sign, body } = digitsOf(fraction * 100, style, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
  return `${sign}${body}${style.name === "en-US" ? "" : NBSP}%`;
}

const MONTH_LOCALE: Record<UiLocale, string> = { en: "en-US", it: "it-IT" };

/** A month's name in the reader's language, built from the parts so no local Date is involved. */
export function monthName(date: CivilDate, locale: UiLocale, width: "short" | "long"): string {
  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(MONTH_LOCALE[locale], { month: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Civil dates are formatted from their parts, never through a local Date,
 * so the displayed day cannot drift with the server's timezone. Month names
 * come from Intl; the order of the parts is fixed to match the design.
 */
export function formatDate(
  date: CivilDate | null,
  style: "dayMonth" | "long" | "monthYear" | "monthShort" | "month",
  locale: UiLocale,
): string {
  if (date === null) return NULL_DISPLAY;
  if (!isCivilDate(date)) throw new RangeError(`Not a civil date: "${date}"`);
  const [year, , day] = date.split("-");
  switch (style) {
    case "dayMonth":
      return `${day} ${monthName(date, locale, "short")}`;
    case "long":
      return `${Number(day)} ${monthName(date, locale, "short")} ${year}`;
    case "monthYear":
      return `${monthName(date, locale, "long")} ${year}`;
    case "monthShort":
      return `${monthName(date, locale, "short")} ${year.slice(2)}`;
    case "month":
      // The month alone, for a grid that already names the year above it (the month picker).
      return monthName(date, locale, "short");
  }
}

/**
 * An amount as a person would type it back into a field, in their own format: their decimal
 * separator and no grouping ("1234,56" in Italian, "1234.56" in English), which `parseAmount`
 * reads back to the same cents. `null` is an empty field.
 */
export function formatAmountInput(cents: Cents | null, format: NumberFormat): string {
  if (cents === null) return "";
  return centsToDecimal(cents).replace(".", resolveStyle(format).decimal);
}

/** A whole percentage as the design writes it ("88 %" in Italian, "88%" in English), past 100 too. */
export function formatWholePercent(percent: number, format: NumberFormat): string {
  const style = resolveStyle(format);
  const { sign, body } = digitsOf(percent, style, { maximumFractionDigits: 0 });
  return `${sign}${body}${style.name === "en-US" ? "" : NBSP}%`;
}
