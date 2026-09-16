/**
 * Budget Makers Wallet's wire shapes and the pure conversions around them (spec §9.1): the account
 * type table, amounts, and the date windows the transaction reader pages with.
 *
 * Everything here is a pure function or a schema: no HTTP, no database, no clock. `client.ts` is
 * the only file that speaks to the network, and it is the public entry point — it re-exports the
 * types below so a consumer never has to know which of the two files declared them.
 */

import { z } from "zod";
import { type AccountType } from "@/modules/accounts/rules";
import {
  addDays,
  addMonths,
  type CivilDate,
  isCivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@/platform/dates";
import { type Cents, centsFromNumber, parseCents } from "@/platform/money";

/**
 * A money field as it reaches a schema. Wallet sends money as a JSON number; `client.ts` parses
 * every response keeping each number's own source text, so in practice the string arm is what
 * matches. The number arm is the fallback for a runtime without source-text access — see
 * {@link walletAmountToCents}.
 */
const wireAmount = z.union([z.string(), z.number()]);

/** An account as `/accounts` returns it. Field names are Wallet's, and live only in this file. */
export const walletAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  currencyCode: z.string(),
  archived: z.boolean().default(false),
  accountType: z.string().nullish(),
  isInvestmentAccount: z.boolean().nullish(),
  updatedAt: z.string().nullish(),
  balance: z.object({ currentBalance: wireAmount }),
});
export type WalletAccountPayload = z.infer<typeof walletAccountSchema>;

/** A movement as `/records` returns it. */
export const walletRecordSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  amount: wireAmount,
  currencyCode: z.string(),
  recordDate: z.string(),
  categoryId: z.string().nullish(),
  labels: z.array(z.string()).default([]),
  recordType: z.string().nullish(),
  recordState: z.string().nullish(),
  note: z.string().nullish(),
  partyName: z.string().nullish(),
  transferCounterRecordId: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
export type WalletRecordPayload = z.infer<typeof walletRecordSchema>;

/** A category as `/categories` returns it: a movement carries only the id, never the name. */
export const walletCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  group: z.string().nullish(),
  isIncome: z.boolean().nullish(),
});
export type WalletCategoryPayload = z.infer<typeof walletCategorySchema>;

/**
 * Reads come wrapped (`{ accounts: [...] }`, `{ records: [...] }`), the shape the previous
 * version's client used against the live API. A bare array is accepted as well: no token is
 * available to verify the envelope on every endpoint, and an envelope-only schema would turn a
 * naming difference into a sync that can never run. Anything else is a loud payload error.
 */
export const walletAccountsPayloadSchema = z.union([
  z.object({ accounts: z.array(walletAccountSchema) }).transform((body) => body.accounts),
  z.array(walletAccountSchema),
]);

export const walletRecordsPayloadSchema = z.union([
  z.object({ records: z.array(walletRecordSchema) }).transform((body) => body.records),
  z.array(walletRecordSchema),
]);

export const walletCategoriesPayloadSchema = z.union([
  z.object({ categories: z.array(walletCategorySchema) }).transform((body) => body.categories),
  z.array(walletCategorySchema),
]);

/** A Wallet account, in this app's vocabulary. */
export interface WalletAccount {
  externalId: string;
  name: string;
  type: AccountType;
  currency: string;
  archived: boolean;
  updatedAt: Date | null;
}

/**
 * The balance Wallet publishes for an account. There is no date: Wallet returns a current balance
 * with no date of its own, and §9.1 stamps it with the reading's civil date in the *user's*
 * timezone — which this client does not know. The caller supplies it.
 */
export interface WalletBalance {
  accountExternalId: string;
  cents: Cents;
  /** Wallet publishes no separate available figure: unknown is `null`, never the current balance. */
  availableCents: Cents | null;
  currency: string;
  updatedAt: Date | null;
}

/** A Wallet movement, carrying what §7.2 needs: identity, the transfer reference, money and taxonomy. */
export interface WalletTransaction {
  externalId: string;
  accountExternalId: string;
  /**
   * The external id of the opposite leg of a transfer, `null` for anything else. §7.2 pairs
   * transfers by this reference alone — never by amount and date — so it is carried verbatim.
   */
  transferCounterExternalId: string | null;
  /** The day Wallet stamped on the movement, as Wallet's own text (see {@link walletRecordDate}). */
  occurredOn: CivilDate;
  /** The instant, when Wallet sent a time as well; `null` when `recordDate` is a bare day. */
  occurredAt: Date | null;
  /** Signed: negative is money out. */
  amountCents: Cents;
  currency: string;
  payee: string | null;
  note: string | null;
  categoryExternalId: string | null;
  /** Provider label *names*: §9.1 adopts labels by name, so there is no external id to keep. */
  labels: string[];
  /** Wallet's own `recordType`/`recordState`, lower-cased, `null` when absent. Mapping them onto
   * this app's enums is the sync's decision, not this file's. */
  providerType: string | null;
  providerState: string | null;
  updatedAt: Date | null;
}

/**
 * A Wallet category. §9.1 adopts a category by its exact name when no link exists yet, so the name
 * has to come from somewhere: a movement carries only `categoryId`, which is why the client reads
 * `/categories` as well. `isIncome` is Wallet's own flag and unknown is `null` — deciding this
 * app's category type from it is the taxonomy's call, not this file's.
 */
export interface WalletCategory {
  externalId: string;
  name: string;
  groupName: string | null;
  isIncome: boolean | null;
}

/**
 * Wallet's own type vocabulary (spec §9.1), lower-cased so a casing change upstream is not a
 * silent demotion to `other`. Both `saving` and `savings` are listed because both occur.
 */
const TYPE_BY_WALLET_TYPE: Record<string, AccountType> = {
  cash: "cash",
  general: "checking",
  checking: "checking",
  current: "checking",
  saving: "savings",
  savings: "savings",
  investment: "investment",
  "credit card": "credit",
  crypto: "crypto",
};

/**
 * A named type always wins; the investment flag only decides what an otherwise unrecognised
 * account becomes, so a "Cash" account that happens to carry the flag stays cash (spec §9.1).
 */
export function walletAccountType(raw: {
  accountType?: string | null;
  isInvestmentAccount?: boolean | null;
}): AccountType {
  const named = TYPE_BY_WALLET_TYPE[(raw.accountType ?? "").trim().toLowerCase()];
  if (named) return named;
  return raw.isInvestmentAccount === true ? "investment" : "other";
}

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

/**
 * The day of a `recordDate`, taken from the first ten characters of Wallet's own text. Never
 * derived from a `Date`: a civil date read out of an instant shifts by a day around midnight,
 * which §4.3 forbids. A caller that wants the user's civil date of a timestamped movement uses
 * `civilDateIn(occurredAt, timezone)` on {@link WalletTransaction.occurredAt}.
 */
export function walletRecordDate(recordDate: string): CivilDate {
  const day = recordDate.trim().slice(0, 10);
  if (!isCivilDate(day)) throw new RangeError(`Not a Wallet record date: "${recordDate}"`);
  return day;
}

/** An instant Wallet sent as text, or `null` when it is absent or unparseable. */
function instant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A `recordDate` that carries a time as well: only then is there an instant to keep. */
function recordInstant(recordDate: string): Date | null {
  return recordDate.trim().length > 10 ? instant(recordDate) : null;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function mapWalletAccount(raw: WalletAccountPayload): WalletAccount {
  return {
    externalId: raw.id,
    name: raw.name.trim(),
    type: walletAccountType(raw),
    currency: raw.currencyCode.trim().toUpperCase(),
    archived: raw.archived,
    updatedAt: instant(raw.updatedAt),
  };
}

export function mapWalletBalance(raw: WalletAccountPayload): WalletBalance {
  return {
    accountExternalId: raw.id,
    cents: walletAmountToCents(raw.balance.currentBalance),
    availableCents: null,
    currency: raw.currencyCode.trim().toUpperCase(),
    updatedAt: instant(raw.updatedAt),
  };
}

export function mapWalletRecord(raw: WalletRecordPayload): WalletTransaction {
  return {
    externalId: raw.id,
    accountExternalId: raw.accountId,
    transferCounterExternalId: optionalText(raw.transferCounterRecordId),
    occurredOn: walletRecordDate(raw.recordDate),
    occurredAt: recordInstant(raw.recordDate),
    amountCents: walletAmountToCents(raw.amount),
    currency: raw.currencyCode.trim().toUpperCase(),
    payee: optionalText(raw.partyName),
    note: optionalText(raw.note),
    categoryExternalId: optionalText(raw.categoryId),
    labels: [...new Set(raw.labels.map((label) => label.trim()).filter((label) => label !== ""))],
    providerType: optionalText(raw.recordType)?.toLowerCase() ?? null,
    providerState: optionalText(raw.recordState)?.toLowerCase() ?? null,
    updatedAt: instant(raw.updatedAt),
  };
}

export function mapWalletCategory(raw: WalletCategoryPayload): WalletCategory {
  return {
    externalId: raw.id,
    name: raw.name.trim(),
    groupName: optionalText(raw.group),
    isIncome: raw.isIncome ?? null,
  };
}

/** A closed civil-date window, both ends included: the unit `/records` is read by. */
export interface DateWindow {
  from: CivilDate;
  to: CivilDate;
}

/** The first link fetches twelve months (spec §9.1). */
export const FIRST_LINK_MONTHS = 12;
/** The hourly pass re-reads the last seven days (spec §9.1); the schedule itself is the job's. */
export const REREAD_DAYS = 7;
/**
 * The widest window this file will measure or split. It bounds the loop in {@link windowDays} and
 * the recursion depth of the splitter, and it is comfortably above the year the first link asks
 * for, month by month.
 */
export const MAX_WINDOW_DAYS = 400;

/**
 * The span of a window in days: 0 for a single day, 30 for a January. Counted with `addDays` so
 * every civil-date step stays inside `platform/dates.ts` rather than becoming local `Date` maths.
 */
export function windowDays(window: DateWindow): number {
  if (!isCivilDate(window.from) || !isCivilDate(window.to)) {
    throw new RangeError(`Not a civil-date window: "${window.from}".."${window.to}"`);
  }
  if (window.to < window.from)
    throw new RangeError(`Window ends before it starts: "${window.from}".."${window.to}"`);
  for (let days = 0; days <= MAX_WINDOW_DAYS; days += 1) {
    if (addDays(window.from, days) === window.to) return days;
  }
  throw new RangeError(`Window wider than ${MAX_WINDOW_DAYS} days: "${window.from}".."${window.to}"`);
}

/**
 * The two halves of a window, or `null` when it is a single day and cannot be split further. This
 * is what a full page of records does instead of failing (spec §9.1); the halves are disjoint and
 * together cover exactly the original window.
 */
export function splitWindow(window: DateWindow): [DateWindow, DateWindow] | null {
  const days = windowDays(window);
  if (days === 0) return null;
  const middle = addDays(window.from, Math.floor(days / 2));
  return [
    { from: window.from, to: middle },
    { from: addDays(middle, 1), to: window.to },
  ];
}

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
