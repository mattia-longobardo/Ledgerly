// The pure rules of the registry of instruments and of their daily prices (rewrite plan R5d).
import { addDays, type CivilDate, dayOfWeek, daysBetween } from "../../shared/dates";

/** The classes of an instrument: those of an investment asset that a market lists. */
export const INSTRUMENT_CLASSES = ["stock", "etf", "fund", "bond", "other"] as const;
export type InstrumentClass = (typeof INSTRUMENT_CLASSES)[number];

/** A price older than this many working days makes an asset «to update» (investments.md §6). */
export const STALE_AFTER_WORKING_DAYS = 5;
/** The days every run reads again: a source corrects a recent close, a run may have been missed. */
export const REREAD_DAYS = 10;
/** The farthest back a market with no price is read: the history a P&L may need. */
export const MAX_BACKFILL_DAYS = 730;
/** The source calls a day for the whole instance, by default (`PRICES_DAILY_CALLS`). */
export const DEFAULT_DAILY_CALLS = 200;

/**
 * The order the form proposes a market in (decision S3): Borsa Italiana, Xetra, Euronext, then the
 * US, then every other one by MIC. Xetra is the fallback when the market of the order has no price.
 */
const MARKET_ORDER = ["XMIL", "MTAA", "ETFP", "XETR", "XPAR", "XAMS", "XBRU", "XLIS", "XNYS", "XNAS", "ARCX"];
export const FALLBACK_MIC = "XETR";

export function orderListings<T extends { mic: string }>(listings: readonly T[]): T[] {
  const rank = (mic: string) => {
    const index = MARKET_ORDER.indexOf(mic);
    return index === -1 ? MARKET_ORDER.length : index;
  };
  return [...listings].sort(
    (left, right) => rank(left.mic) - rank(right.mic) || left.mic.localeCompare(right.mic),
  );
}

/** The weekdays after `from` up to `to` included: 0 when `to` is not after `from`. */
export function workingDaysBetween(from: CivilDate, to: CivilDate): number {
  const days = daysBetween(from, to);
  if (days <= 0) return 0;
  const weeks = Math.floor(days / 7);
  let count = weeks * 5;
  for (let day = weeks * 7 + 1; day <= days; day += 1) {
    const weekday = dayOfWeek(addDays(from, day));
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/** «To update»: no price yet, or the last one older than 5 working days. */
export function isStale(lastOn: CivilDate | null, today: CivilDate): boolean {
  return lastOn === null || workingDaysBetween(lastOn, today) > STALE_AFTER_WORKING_DAYS;
}

/**
 * The days to read for a market: the last ones again, from its last price at the latest; for a
 * market with no price, from the day its oldest asset needs (at most two years back).
 */
export function rangeToRead(
  lastOn: CivilDate | null,
  neededFrom: CivilDate,
  today: CivilDate,
): { from: CivilDate; to: CivilDate } {
  const reread = addDays(today, -REREAD_DAYS);
  const oldest = addDays(today, -MAX_BACKFILL_DAYS);
  const from =
    lastOn === null ? (neededFrom > oldest ? neededFrom : oldest) : lastOn < reread ? lastOn : reread;
  return { from: from < today ? from : today, to: today };
}

/** The markets a run reads within its cap: the oldest price first, a market with none before all. */
export function pickDue<T extends { lastOn: CivilDate | null }>(markets: readonly T[], cap: number): T[] {
  const age = (one: T) => one.lastOn ?? "";
  return [...markets].sort((left, right) => age(left).localeCompare(age(right))).slice(0, Math.max(0, cap));
}

/** The class by the first letters of a CFI code (ISO 10962): the longest prefix wins. */
const CFI_CLASSES: [string, InstrumentClass][] = [
  ["CE", "etf"],
  ["C", "fund"],
  ["E", "stock"],
  ["D", "bond"],
];
/** The class by a word of the source's security type, in this order. */
const TYPE_CLASSES: [RegExp, InstrumentClass][] = [
  [/etf|etp/, "etf"],
  [/fund/, "fund"],
  [/common stock|share|adr/, "stock"],
  [/bond|note/, "bond"],
];

/** The class of an instrument from its CFI code, or from the source's security type. */
export function classOf(cfi: string | null, securityType: string | null): InstrumentClass {
  const byCfi = CFI_CLASSES.find(([prefix]) => cfi?.startsWith(prefix));
  if (byCfi) return byCfi[1];
  const type = (securityType ?? "").toLowerCase();
  return TYPE_CLASSES.find(([pattern]) => pattern.test(type))?.[1] ?? "other";
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Whether a text is an ISIN with a right check digit (ISO 6166, Luhn on the letters as numbers). */
export function isIsin(text: string): boolean {
  if (!ISIN.test(text)) return false;
  const digits = [...text].map((char) => (/\d/.test(char) ? char : String(char.charCodeAt(0) - 55))).join("");
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
