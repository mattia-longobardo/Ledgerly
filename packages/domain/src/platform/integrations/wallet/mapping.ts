/**
 * What is left of Wallet's wire shapes in the core (spec §9.1): the record and its amount, for the
 * interest posting of `client.ts`, and the date windows a pass reads (the engine's decision). The
 * rest is the plugin's own since rewrite plan R5c: accounts, categories and movements reach the
 * engine in the words of contract 2.
 *
 * Everything here is a pure function or a schema: no HTTP, no database, no clock.
 */

import { z } from "zod";
import {
  addDays,
  addMonths,
  type CivilDate,
  isCivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "../../../shared/dates";
import { type Cents, centsFromNumber, parseCents } from "../../../shared/money";
import { FIRST_LINK_MONTHS } from "./depth";

/**
 * A money field as it reaches a schema. Wallet sends money as a JSON number; `client.ts` parses
 * every response keeping each number's own source text, so in practice the string arm is what
 * matches. The number arm is the fallback for a runtime without source-text access — see
 * {@link walletAmountToCents}.
 */
const wireAmount = z.union([z.string(), z.number()]);

/**
 * The money of a movement. Wallet nests the figure together with its own currency, and a record
 * carries no currency of its own: `amount.currencyCode` is the movement's currency, full stop.
 *
 * `client.ts` keeps every number of a response as its source text, at any depth, so `value`
 * arrives here as the digits Wallet sent even though it is nested one object down — the place
 * §4.3's guard is easiest to lose.
 */
const walletRecordAmountSchema = z.object({
  value: wireAmount,
  currencyCode: z.string(),
});

/**
 * The category Wallet embeds in a movement. The *name* travels with the record, so the name §9.1
 * adopts by does not have to be looked up in the `/categories` list any more.
 */
const walletRecordCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  // An object `{ id, name }`, the same shape `/categories` publishes — not a string.
  group: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  color: z.string().nullish(),
  // Wallet's own identity for its built-in categories, the same in every language:
  // `system_categories__transfer` is how Wallet itself tells a giroconto (see WALLET_TRANSFER_CATEGORY).
  systemId: z.string().nullish(),
});

/**
 * Wallet's transfer block: `null` for an ordinary movement.
 *
 * The two ids are not interchangeable, and only one of them is a counterpart:
 * - `mirrorRecord` is the **other record itself**, and `mirrorRecord.id` is the reference §7.2
 *   pairs transfers on — the one `transferPairKey` builds an ordered pair of two record ids from;
 * - `transferId` looks like a **group** id shared by both legs. It is not a record id, so using it
 *   as a counterpart would build a pair key out of a group id and never match anything, or match
 *   the wrong thing. It is deliberately not read — see {@link mapWalletRecord}.
 *
 * Both stay optional because a transfer block carrying only `{ type, transferId }` was observed:
 * that leg has no counterpart to pair on, and inventing one from the group id is not this file's
 * call.
 */
const walletTransferSchema = z.object({
  type: z.string().nullish(),
  transferId: z.string().nullish(),
  /**
   * The **whole other record**, not its id: `{ id, accountId, amount, note }` (measured on the
   * live API). `mirrorRecord.id` is therefore the counterpart reference §7.2 pairs on, and its
   * presence means the ordered pair of two record ids is expressible — no group rule is needed.
   */
  mirrorRecord: z.object({ id: z.string().min(1), accountId: z.string().nullish() }).nullish(),
});

/**
 * A movement as `/records` returns it, measured against the live API on 2026-09-16. The fields
 * this app has no use for (`accountName`, `accountIsBankSync`, `source`, `createdAt`) are part of
 * the answer and are dropped here rather than carried unused.
 *
 * `labels` is an array — the one thing that is certain about it. It came back empty in every one of
 * the 40 records sampled, so **the element's own shape is not verified**: it is read as `unknown`
 * and turned into names as tolerantly as {@link walletLabelNames} can manage, instead of asserting
 * a shape nobody has seen and failing a whole page over it.
 */
export const walletRecordSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  amount: walletRecordAmountSchema,
  recordDate: z.string(),
  category: walletRecordCategorySchema.nullish(),
  labels: z.array(z.unknown()).default([]),
  recordType: z.string().nullish(),
  recordState: z.string().nullish(),
  note: z.string().nullish(),
  counterParty: z.string().nullish(),
  transfer: walletTransferSchema.nullish(),
  updatedAt: z.string().nullish(),
});
const PLAIN_DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * A Wallet amount as cents.
 *
 * Wallet sends money as a JSON number, which is exactly where precision is lost — so `client.ts`
 * parses every response with a reviver that keeps each number's *source text*
 * (`JSON.parse`'s `context.source`, Node 22+). "2615.39" therefore reaches this function as the
 * seven characters Wallet actually sent, and `parseCents` turns them into cents with no float ever
 * existing (spec §4.3, half-up at the third decimal).
 *
 * Two inputs take the lossy route, and both are documented rather than hidden:
 * - a genuine `number`, i.e. a runtime that does not expose source text: the value has already
 *   been through a double, so it is converted through its fixed decimal representation
 *   (`centsFromNumber`), which yields the closest decimal to that double — `0.1 + 0.2` becomes 30
 *   cents rather than the 30.000000000000004 a naive multiplication would produce;
 * - source text in exponent notation ("1e3"), which is legal JSON and which `parseCents`
 *   deliberately rejects; it goes through the same fixed-decimal conversion.
 */
export function walletAmountToCents(value: string | number): Cents {
  if (typeof value === "number") return centsFromNumber(value);
  const text = value.trim();
  if (PLAIN_DECIMAL.test(text)) return parseCents(text);
  const asNumber = Number(text);
  if (text === "" || Number.isNaN(asNumber)) throw new RangeError(`Not a Wallet amount: "${value}"`);
  return centsFromNumber(asNumber);
}

/** A closed civil-date window, both ends included: the unit `/records` is read by. */
export interface DateWindow {
  from: CivilDate;
  to: CivilDate;
}

/** The first link fetches twelve months (spec §9.1); the constant lives in `depth.ts` since F2.5. */
export { FIRST_LINK_MONTHS };
/** The hourly pass re-reads the last seven days (spec §9.1); the schedule itself is the job's. */
const REREAD_DAYS = 7;
/** A whole calendar month as a window. */
export function monthWindow(month: MonthKey): DateWindow {
  return { from: monthKey(month), to: lastDayOfMonth(month) };
}

/**
 * The monthly windows of a first link: `months` whole months ending with the month `today` falls
 * in, oldest first (spec §9.1: twelve of them). The last window runs to the end of the current
 * month rather than to today, so a movement Wallet dates a few days ahead is not missed.
 */
export function firstLinkWindows(today: CivilDate, months: number = FIRST_LINK_MONTHS): DateWindow[] {
  if (!Number.isInteger(months) || months < 1) throw new RangeError(`Not a month count: ${months}`);
  const current = monthKey(today);
  return Array.from({ length: months }, (_, index) => monthWindow(addMonths(current, index - (months - 1))));
}

/** The re-read window: exactly `days` civil days ending today (spec §9.1: the last seven). */
export function recentWindow(today: CivilDate, days: number = REREAD_DAYS): DateWindow {
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`Not a day count: ${days}`);
  if (!isCivilDate(today)) throw new RangeError(`Not a civil date: "${today}"`);
  return { from: addDays(today, -(days - 1)), to: today };
}
