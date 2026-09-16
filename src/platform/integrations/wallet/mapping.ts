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

/**
 * The money of a movement. Wallet nests the figure together with its own currency, and a record
 * carries no currency of its own: `amount.currencyCode` is the movement's currency, full stop.
 *
 * `client.ts` keeps every number of a response as its source text, at any depth, so `value`
 * arrives here as the digits Wallet sent even though it is nested one object down — the place
 * §4.3's guard is easiest to lose.
 */
export const walletRecordAmountSchema = z.object({
  value: wireAmount,
  currencyCode: z.string(),
});

/**
 * The category Wallet embeds in a movement. The *name* travels with the record, so the name §9.1
 * adopts by does not have to be looked up in the `/categories` list any more.
 */
export const walletRecordCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  group: z.string().nullish(),
  color: z.string().nullish(),
});

/**
 * Wallet's transfer block: `null` for an ordinary movement.
 *
 * The two ids are not interchangeable, and only one of them is a counterpart:
 * - `mirrorRecord` is the **other record's** id — the reference §7.2 pairs transfers on, and the
 *   one `transferPairKey` builds an ordered pair of two record ids out of;
 * - `transferId` looks like a **group** id shared by both legs. It is not a record id, so using it
 *   as a counterpart would build a pair key out of a group id and never match anything, or match
 *   the wrong thing. It is deliberately not read — see {@link mapWalletRecord}.
 *
 * Both are optional because both were observed absent: a transfer block carrying only
 * `{ type, transferId }` leaves §7.2 with no counterpart, which is a missing pairing rule and not
 * something this file may invent.
 */
export const walletTransferSchema = z.object({
  type: z.string().nullish(),
  transferId: z.string().nullish(),
  mirrorRecord: z.string().nullish(),
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
export type WalletRecordPayload = z.infer<typeof walletRecordSchema>;

/**
 * A category as `/categories` returns it. Wallet publishes no income flag of its own on this
 * endpoint — 91 categories came back with `id`, `name`, `group` and `color` and nothing else — so
 * there is none to carry: deciding this app's category type is the taxonomy's call anyway.
 */
/**
 * A category as `/categories` really answers (measured at the collaudo of 2026-09-17, 91 rows):
 * `group` is an **object** `{ id, name }`, not a string. Expecting a string here is what made the
 * whole union fail with `(root): Invalid input` — a union's message names neither the field nor
 * the reason, so it hid the cause. `/categories` is read before `/records`, so this alone stopped
 * every transactions pass.
 */
export const walletCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  group: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  color: z.string().nullish(),
});
export type WalletCategoryPayload = z.infer<typeof walletCategorySchema>;

/**
 * `/accounts` and `/categories` come wrapped (`{ accounts: [...] }`, `{ categories, limit, offset }`).
 * A bare array is accepted as well, the tolerance the client was written with while no token was
 * available to verify either envelope; anything else is a loud payload error.
 */
export const walletAccountsPayloadSchema = z.union([
  z.object({ accounts: z.array(walletAccountSchema) }).transform((body) => body.accounts),
  z.array(walletAccountSchema),
]);

export const walletCategoriesPayloadSchema = z.union([
  z.object({ categories: z.array(walletCategorySchema) }).transform((body) => body.categories),
  z.array(walletCategorySchema),
]);

/**
 * A page of `/records`, envelope and all: `{ records, limit, offset, nextOffset,
 * appliedRecordDateFilters }`, measured against the live API on 2026-09-16.
 *
 * No bare-array arm here, unlike the two lists above. That tolerance was there because nobody had
 * seen the envelope; now it has been seen, and accepting an answer without one would mean
 * accepting an answer that cannot declare which window it covers — the single fact this endpoint
 * has to be believed about (§7.2 reads a movement's absence from a window as its removal).
 *
 * `appliedRecordDateFilters` is required for the same reason: it is what turns "the window was
 * applied" from an inference into a fact. `limit`, `offset` and `nextOffset` are part of the
 * answer and are not declared — nothing reads them yet, and a JSON number reaches a schema here as
 * its own source text (see `parseJsonPreservingNumbers`), so whoever adopts the real pagination
 * has to coerce them rather than expect `z.number()` to match.
 */
export const walletRecordsPayloadSchema = z.object({
  records: z.array(walletRecordSchema),
  appliedRecordDateFilters: z.array(z.string()),
});
export type WalletRecordsPage = z.infer<typeof walletRecordsPayloadSchema>;

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
   *
   * It is `transfer.mirrorRecord` and only that. `transfer.transferId`, which a transfer block may
   * carry instead, is a group id rather than a record id: pairing on it is a different rule, and
   * until that rule exists a leg without a mirror has no counterpart here (see
   * {@link mapWalletRecord}).
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
  /**
   * The category's own name, as Wallet spells it. A movement carries its whole category — id,
   * name, group and colour — so the name §9.1 adopts by arrives with the movement instead of
   * having to be found in the `/categories` list.
   */
  categoryName: string | null;
  /** Provider label *names*: §9.1 adopts labels by name, so there is no external id to keep. */
  labels: string[];
  /** Wallet's own `recordType`/`recordState`, lower-cased, `null` when absent. Mapping them onto
   * this app's enums is the sync's decision, not this file's. */
  providerType: string | null;
  providerState: string | null;
  updatedAt: Date | null;
}

/**
 * A Wallet category, as the `/categories` list publishes it. §9.1 links a provider category,
 * adopts one by its exact name, or creates it, and that needs Wallet's whole list — including the
 * categories no movement of the window happens to use. Wallet publishes no income flag here, so
 * there is none to carry.
 */
export interface WalletCategory {
  externalId: string;
  name: string;
  groupName: string | null;
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

/**
 * The name of one label, or `null` when this file cannot tell.
 *
 * **Not verified.** `labels` was an array in all 40 records sampled with a real token and empty in
 * every one of them, so no element has ever been seen. Both arms below are therefore guesses, and
 * they are written to cost nothing if they are wrong: a bare string is the shape §9.1 implies
 * ("etichette per nome"), and an object with a `name` is the shape every other nested block of a
 * record uses (`amount`, `category`, `transfer`). Anything else yields `null` and is dropped
 * rather than failing the page — a label is a user-owned hint, and a whole window of movements is
 * not worth losing over one. The first non-empty page of labels from a real token settles it.
 */
function labelName(label: unknown): string | null {
  if (typeof label === "string") return label;
  if (typeof label !== "object" || label === null) return null;
  const name = (label as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/** Label names, trimmed, de-duplicated and in the order Wallet listed them. */
export function walletLabelNames(labels: readonly unknown[]): string[] {
  const names = new Set<string>();
  for (const label of labels) {
    const name = optionalText(labelName(label));
    if (name !== null) names.add(name);
  }
  return [...names];
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

/**
 * A movement in this app's vocabulary.
 *
 * The currency comes from `amount.currencyCode`, because a record has no currency of its own, and
 * `amount.value` is handed to {@link walletAmountToCents} as the source text `client.ts` preserved
 * — nesting the figure inside an object changes nothing about §4.3, and that is worth a test.
 *
 * The counterpart is `transfer.mirrorRecord` and nothing else. §7.2 pairs transfers on the id of
 * the *opposite record* (`transferPairKey` sorts two record ids into one key), which is what
 * `mirrorRecord` is; `transfer.transferId` is a group id shared by both legs, so putting it here
 * would key a pair on something that is not a record and pair nothing — or worse, pair by
 * coincidence. A leg whose block carries only `{ type, transferId }` therefore gets `null`: that
 * is a rule §7.2 does not have yet (group by a shared `transferId`), not a field this file may
 * substitute.
 */
export function mapWalletRecord(raw: WalletRecordPayload): WalletTransaction {
  return {
    externalId: raw.id,
    accountExternalId: raw.accountId,
    transferCounterExternalId: optionalText(raw.transfer?.mirrorRecord),
    occurredOn: walletRecordDate(raw.recordDate),
    occurredAt: recordInstant(raw.recordDate),
    amountCents: walletAmountToCents(raw.amount.value),
    currency: raw.amount.currencyCode.trim().toUpperCase(),
    payee: optionalText(raw.counterParty),
    note: optionalText(raw.note),
    categoryExternalId: optionalText(raw.category?.id),
    categoryName: optionalText(raw.category?.name),
    labels: walletLabelNames(raw.labels),
    providerType: optionalText(raw.recordType)?.toLowerCase() ?? null,
    providerState: optionalText(raw.recordState)?.toLowerCase() ?? null,
    updatedAt: instant(raw.updatedAt),
  };
}

export function mapWalletCategory(raw: WalletCategoryPayload): WalletCategory {
  return {
    externalId: raw.id,
    name: raw.name.trim(),
    groupName: optionalText(raw.group?.name),
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
