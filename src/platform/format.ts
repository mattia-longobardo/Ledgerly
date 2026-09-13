import { type CivilDate, isCivilDate } from "./dates";
import { type Cents, centsToDecimal } from "./money";

export type NumberFormat = "it-IT" | "en-US" | "fr-FR";
export type UiLocale = "en" | "it";

export const NULL_DISPLAY = "—";
const MINUS = "−";
const NBSP = " ";

function withTrueMinus(text: string): string {
  return text.replace(/-/g, MINUS);
}

export function formatMoney(
  cents: Cents | null,
  format: NumberFormat,
  options: { decimals?: boolean; signed?: boolean } = {},
): string {
  if (cents === null) return NULL_DISPLAY;
  const digits = options.decimals === false ? 0 : 2;
  const formatter = new Intl.NumberFormat(format, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: "always",
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
  // A decimal string is formatted exactly (Intl.NumberFormat v3): no float on the way.
  return withTrueMinus(formatter.format(centsToDecimal(cents) as `${number}`));
}

export function formatPercent(
  fraction: number | null,
  format: NumberFormat,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  if (fraction === null) return NULL_DISPLAY;
  const digits = options.decimals ?? 1;
  const number = new Intl.NumberFormat(format, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: "always",
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(fraction * 100);
  return format === "en-US" ? `${withTrueMinus(number)}%` : `${withTrueMinus(number)}${NBSP}%`;
}

const MONTH_LOCALE: Record<UiLocale, string> = { en: "en-US", it: "it-IT" };

function monthName(date: CivilDate, locale: UiLocale, width: "short" | "long"): string {
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
  style: "dayMonth" | "long" | "monthYear" | "monthShort",
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
  }
}
