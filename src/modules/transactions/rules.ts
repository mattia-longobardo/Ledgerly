/**
 * Pure rules of the transactions module (spec §7.2). No database, no clock of its own: every
 * function takes data and returns a decision the service applies, the same shape as
 * `modules/accounts/rules.ts`. The constants below are the vocabulary `schema.ts` builds its
 * columns and checks on.
 */

import { addDays, type CivilDate, civilDateIn, isCivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export const TRANSACTION_STATES = ["cleared", "pending"] as const;
export const CATEGORY_TYPES = ["income", "expense", "transfer"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionState = (typeof TRANSACTION_STATES)[number];
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/**
 * The longest a category or label name may be — the bound `categories_name_ck` and
 * `labels_name_ck` enforce in `schema.ts`. Lives here, not in `taxonomy.ts`, because the client
 * forms need it too and `taxonomy.ts` is `server-only`.
 */
export const NAME_MAX = 60;

/** The fields a user can own locally; everything else belongs to the provider (spec §7.2). */
export const EDITABLE_FIELDS = ["categoryId", "note", "labels"] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Recurrence interval bands, in days (spec §7.2). */
export const RECURRENCE_BANDS = [
  { cadence: "weekly", min: 5, max: 9 },
  { cadence: "biweekly", min: 12, max: 16 },
  { cadence: "monthly", min: 26, max: 34 },
  { cadence: "quarterly", min: 80, max: 100 },
  { cadence: "yearly", min: 350, max: 380 },
] as const;

export type Cadence = (typeof RECURRENCE_BANDS)[number]["cadence"];

/** At least this many occurrences before a payee counts as recurring (spec §7.2). */
export const RECURRENCE_MIN_OCCURRENCES = 3;

/** How far each amount may sit from the median and still belong to the pattern (spec §7.2). */
export const RECURRENCE_AMOUNT_TOLERANCE = 0.1;

/**
 * The fields a provider owns: the sync writes them, the interface never offers them (spec §7.2).
 * Everything a person may change is in `EDITABLE_FIELDS`; visibility is user-owned too but has no
 * marker, because the sync never writes `hidden_at` at all.
 */
export const PROVIDER_OWNED_FIELDS = [
  "accountId",
  "occurredAt",
  "amountCents",
  "currency",
  "type",
  "state",
  "payee",
] as const;

export type ProviderOwnedField = (typeof PROVIDER_OWNED_FIELDS)[number];

/** A field name as it appears in `locally_edited`. */
export type MergeableField = ProviderOwnedField | EditableField;

const DAY_MS = 86_400_000;

/* Provider input */

/**
 * One movement as the transactions module receives it, whatever provider it came from. The Wallet
 * client's own shape stops at its adapter (spec §9.1): nothing below this line knows a Wallet
 * field name.
 *
 * `counterpartExternalId` is the other leg of a transfer as the provider names it — the only thing
 * transfers are ever paired on. Unknown is `null`, never an empty string and never a zero: a
 * category the provider did not give is `null`, and `labels` is empty only when the provider sent
 * no label.
 */
export interface IncomingTransaction {
  externalId: string;
  counterpartExternalId: string | null;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  state: TransactionState;
  payee: string | null;
  note: string | null;
  categoryExternalId: string | null;
  categoryName: string | null;
  /**
   * The provider's group of that category (F2.5), which becomes its parent here. Wallet sends it
   * as `{ id, name }`; either may be missing, and without a name there is nothing to adopt.
   */
  categoryGroupExternalId: string | null;
  categoryGroupName: string | null;
  labels: readonly string[];
}

/** What the service resolved for an incoming movement before the rules decide anything. */
export interface ProviderResolution {
  accountId: string;
  categoryId: string | null;
  labelIds: readonly string[];
}

/** The stored row the rules reason about: `transactions` plus the label ids of the join table. */
export interface StoredTransaction {
  id: string;
  accountId: string;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  state: TransactionState;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  labelIds: readonly string[];
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
  locallyEdited: readonly string[];
  /** Set once the row is a leg of a giroconto, whichever rule paired it. */
  transferGroupId?: string | null;
}

/** The columns a row is created with; the id, the user and the timestamps are the database's. */
export interface NewTransaction {
  accountId: string;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  state: TransactionState;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  labelIds: readonly string[];
}

/** A change to apply to one row. Only the keys present are written. */
export interface TransactionPatch {
  accountId?: string;
  occurredAt?: Date;
  amountCents?: Cents;
  currency?: string;
  type?: TransactionType;
  state?: TransactionState;
  categoryId?: string | null;
  payee?: string | null;
  note?: string | null;
  labelIds?: readonly string[];
}

/* Payee */

/** The payee as it is stored and shown: trimmed, and `null` rather than blank (spec §4.3). */
export function displayPayee(payee: string | null): string | null {
  const trimmed = (payee ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The grouping key of a payee: no whitespace and no case (spec §7.2), so "Net Flix" and "netflix"
 * are one series. A payee that normalises to nothing is no payee at all and returns `null` — the
 * same answer as a missing one, which is what keeps it out of recurrence detection.
 */
export function payeeKeyOf(payee: string | null): string | null {
  const key = (payee ?? "").replace(/\s+/g, "").toLocaleLowerCase();
  return key === "" ? null : key;
}

/* Visibility */

/** The two columns that decide whether a row counts (spec §7.2). */
export interface Visibility {
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
}

/**
 * Whether a row is out of every total, budget, subscription check and recurrence detection: the
 * user hid it, or Wallet stopped returning it inside the re-read window, which is treated exactly
 * like hidden (spec §7.2). Never a deletion — the row stays, and "Show hidden" brings it back.
 */
export function isHidden(row: Visibility): boolean {
  return row.hiddenAt !== null || row.removedUpstreamAt !== null;
}

/** The rows that count, in the order they came in. The one filter every aggregate starts from. */
export function excludeHidden<T extends Visibility>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isHidden(row));
}

/* Categories */

/**
 * Categories in the order of their tree (spec §7.2, F2.5): each group followed by its
 * sub-categories, with the depth a list indents them by. The order *within* each level is the one
 * the rows arrive in — the query's deterministic `ORDER BY` — so this only moves children under
 * their parent and never sorts on its own.
 *
 * A sub-category whose group is not in the list (an active child of an archived group, when the
 * archived ones are left out) is shown at the top level where it stands rather than dropped.
 */
export function treeOrder<T extends { id: string; parentId: string | null }>(
  rows: readonly T[],
): (T & { depth: 0 | 1 })[] {
  const present = new Set(rows.map((one) => one.id));
  const children = new Map<string, T[]>();
  for (const one of rows) {
    if (one.parentId === null || !present.has(one.parentId)) continue;
    const siblings = children.get(one.parentId) ?? [];
    siblings.push(one);
    children.set(one.parentId, siblings);
  }
  const ordered: (T & { depth: 0 | 1 })[] = [];
  for (const one of rows) {
    if (one.parentId !== null && present.has(one.parentId)) continue;
    ordered.push({ ...one, depth: 0 });
    for (const child of children.get(one.id) ?? []) ordered.push({ ...child, depth: 1 });
  }
  return ordered;
}

/* Transfers */

/** One side of a possible transfer: a stored row, or one this sync is about to write. */
export interface TransferLeg {
  id: string;
  externalId: string;
  counterpartExternalId: string | null;
  transferGroupId: string | null;
}

export interface TransferAssignment {
  id: string;
  transferGroupId: string;
}

/**
 * The identity of a transfer: the pair of external ids, ordered, so both legs compute the same key
 * whichever one is looked at and whichever sync each arrived in (spec §7.2).
 */
export function transferPairKey(externalId: string, counterpartExternalId: string): string {
  return JSON.stringify([externalId, counterpartExternalId].sort());
}

/**
 * Pairs transfer legs, and only ever on the counterpart reference the provider gave — never on a
 * matching amount and date, which is a coincidence and not a fact (spec §7.2). The group id is the
 * smallest local id of the pair: an id that already exists (the column is a self foreign key) and
 * that does not depend on the order the legs arrived in, so re-running a sync decides the same
 * group again.
 *
 * Pass every leg that could take part, not only this run's: a stored leg whose twin arrives weeks
 * later pairs the moment both are in the list, which is how pairing works across syncs. A leg
 * whose twin has not been seen yet pairs nothing and stays a single movement; a reference held by
 * one side only is enough, because the pair key is built from both external ids either way.
 * Returns only the legs whose group id actually changes.
 */
export function pairTransfers(legs: readonly TransferLeg[]): TransferAssignment[] {
  const byExternalId = new Map<string, TransferLeg>();
  for (const leg of legs) {
    if (!byExternalId.has(leg.externalId)) byExternalId.set(leg.externalId, leg);
  }

  const groups = new Map<string, TransferLeg[]>();
  for (const leg of legs) {
    const counterpartExternalId = leg.counterpartExternalId;
    if (counterpartExternalId === null || counterpartExternalId === leg.externalId) continue;
    const counterpart = byExternalId.get(counterpartExternalId);
    if (!counterpart) continue;
    const key = transferPairKey(leg.externalId, counterpartExternalId);
    const members = groups.get(key) ?? [];
    for (const member of [leg, counterpart]) {
      if (!members.some((known) => known.id === member.id)) members.push(member);
    }
    groups.set(key, members);
  }

  const assignments: TransferAssignment[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const transferGroupId = members.map((member) => member.id).sort()[0];
    for (const member of members) {
      if (member.transferGroupId === transferGroupId) continue;
      assignments.push({ id: member.id, transferGroupId });
    }
  }
  return assignments.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* Giroconti by IBAN */

/** The longest gap between the two legs of a giroconto found by IBAN: a bank transfer's clearing. */
export const IBAN_TRANSFER_MAX_DAYS = 5;

/** Spaces and dashes out, upper case: the form an IBAN is compared in. */
function compact(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * An account's "IBAN or reference" as an IBAN, or `null` when it is not one: the shape and the
 * ISO 13616 mod-97 check both have to hold, so a free-text reference never matches a note.
 */
export function normalizeIban(reference: string | null): string | null {
  if (reference === null) return null;
  const iban = compact(reference);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1 ? iban : null;
}

/** One of the user's accounts that has an IBAN. */
export interface OwnIban {
  accountId: string;
  iban: string;
}

/** A stored movement as the IBAN rule reads it. */
export interface IbanRuleRow {
  id: string;
  accountId: string;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  transferGroupId: string | null;
  payee: string | null;
  note: string | null;
}

/**
 * Giroconti the provider sent as a plain expense and a plain income (F2.5, 2026-09-18). A bank
 * transfer between two of the user's own accounts names the other account's IBAN in its details;
 * Wallet does not pair such legs, so both used to count, once as spending and once as income.
 *
 * A movement whose payee or note holds the IBAN of *another* of the user's accounts is a leg of a
 * giroconto. Its other leg is looked for in the account that IBAN names: the opposite amount, in
 * the same currency, at most {@link IBAN_TRANSFER_MAX_DAYS} days apart, not in a pair already —
 * preferring one that names this account's IBAN back, then the nearest in time. The IBAN is what
 * makes this a fact rather than a coincidence of amount and date, which on its own pairs nothing.
 * The pair's group id is the smaller local id, as for the provider's pairs; a leg whose twin is
 * not there (the other side is not synced, or not yet) is a group of its own, so it leaves the
 * totals all the same, and pairs later when the twin arrives.
 *
 * Only rows not in a pair are considered, so a pair found once — by this rule or by the provider's
 * reference — is never taken apart. Returns only the rows whose type or group changes.
 */
export function planIbanTransfers(
  own: readonly OwnIban[],
  rows: readonly IbanRuleRow[],
  maxDays = IBAN_TRANSFER_MAX_DAYS,
): TransferAssignment[] {
  if (own.length === 0) return [];
  const members = new Map<string, number>();
  for (const row of rows) {
    if (row.transferGroupId !== null) {
      members.set(row.transferGroupId, (members.get(row.transferGroupId) ?? 0) + 1);
    }
  }
  /** Not in a pair: no group, or a group of its own that nobody else has joined. */
  const single = (row: IbanRuleRow) =>
    row.transferGroupId === null || (row.transferGroupId === row.id && members.get(row.id) === 1);
  const ibanOf = new Map(own.map((one) => [one.accountId, one.iban]));
  const named = (row: IbanRuleRow): string | null => {
    const text = compact(`${row.payee ?? ""} ${row.note ?? ""}`);
    const hit = own.find((one) => one.accountId !== row.accountId && text.includes(one.iban));
    return hit ? hit.accountId : null;
  };

  const ordered = [...rows].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const decided = new Map<string, string>();
  for (const leg of ordered) {
    if (decided.has(leg.id) || !single(leg)) continue;
    const target = named(leg);
    if (target === null) continue;
    const back = ibanOf.get(leg.accountId);
    const twin = ordered
      .filter(
        (other) =>
          other.accountId === target &&
          !decided.has(other.id) &&
          single(other) &&
          other.currency === leg.currency &&
          other.amountCents === -leg.amountCents &&
          Math.abs(other.occurredAt.getTime() - leg.occurredAt.getTime()) <= maxDays * DAY_MS,
      )
      .sort((a, b) => {
        const namesBack = (row: IbanRuleRow) =>
          back !== undefined && compact(`${row.payee ?? ""} ${row.note ?? ""}`).includes(back) ? 0 : 1;
        return (
          namesBack(a) - namesBack(b) ||
          Math.abs(a.occurredAt.getTime() - leg.occurredAt.getTime()) -
            Math.abs(b.occurredAt.getTime() - leg.occurredAt.getTime()) ||
          (a.id < b.id ? -1 : 1)
        );
      })[0];
    if (twin) {
      const group = leg.id < twin.id ? leg.id : twin.id;
      decided.set(leg.id, group);
      decided.set(twin.id, group);
    } else {
      decided.set(leg.id, leg.id);
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...decided]
    .filter(([id, group]) => {
      const row = byId.get(id) as IbanRuleRow;
      return row.type !== "transfer" || row.transferGroupId !== group;
    })
    .map(([id, transferGroupId]) => ({ id, transferGroupId }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* Merge */

/**
 * The type a row gets. The provider's own word is kept unless the sign contradicts it, because the
 * table checks that an expense is never positive and an income never negative; a movement with a
 * counterpart is a transfer, the one type both signs are allowed under. A documented zero keeps
 * whatever the provider called it — zero is a value, not a missing amount (spec §4.3).
 */
export function resolveType(
  incoming: Pick<IncomingTransaction, "type" | "amountCents" | "counterpartExternalId">,
): TransactionType {
  if (incoming.type === "transfer" || incoming.counterpartExternalId !== null) return "transfer";
  if (incoming.amountCents < 0n) return "expense";
  if (incoming.amountCents > 0n) return "income";
  return incoming.type;
}

/** The row an incoming movement is created as. Category and labels seed the user-owned fields. */
export function toNewTransaction(
  incoming: IncomingTransaction,
  resolution: ProviderResolution,
): NewTransaction {
  return {
    accountId: resolution.accountId,
    occurredAt: incoming.occurredAt,
    amountCents: incoming.amountCents,
    currency: incoming.currency,
    type: resolveType(incoming),
    state: incoming.state,
    categoryId: resolution.categoryId,
    payee: displayPayee(incoming.payee),
    note: incoming.note,
    labelIds: resolution.labelIds,
  };
}

export function isLocallyEdited(locallyEdited: readonly string[], field: MergeableField): boolean {
  return locallyEdited.includes(field);
}

function sameLabels(current: readonly string[], incoming: readonly string[]): boolean {
  if (current.length !== incoming.length) return false;
  const mine = new Set(current);
  return incoming.every((id) => mine.has(id));
}

export interface ProviderMergePlan {
  /** Only the fields that change, and only those the user has not claimed. */
  patch: TransactionPatch;
  changed: boolean;
  /** The fields left alone because they are in `locally_edited`, for the sync's own report. */
  protectedFields: MergeableField[];
}

/**
 * What a sync may write over a row it has seen before (spec §7.2).
 *
 * A field named in `locally_edited` is never written again, whatever it is: payee, amount and date
 * belong to the provider and category, labels and note to the user, but the marker outranks both,
 * so a field a person has touched stays theirs for good. Category, labels and note still follow
 * the provider while they carry no marker — until the first local edit they are simply the
 * provider's values. Visibility is absent on purpose: `hidden_at` is the user's alone and no sync
 * writes it.
 *
 * Fields already equal are not in the patch, so an unchanged movement produces no write at all and
 * re-reading the same window stays idempotent.
 */
export function planProviderMerge(
  current: StoredTransaction,
  incoming: IncomingTransaction,
  resolution: ProviderResolution,
): ProviderMergePlan {
  const patch: TransactionPatch = {};
  const protectedFields: MergeableField[] = [];

  const take = <K extends keyof TransactionPatch>(
    field: MergeableField,
    key: K,
    value: TransactionPatch[K],
    equal: boolean,
  ): void => {
    if (isLocallyEdited(current.locallyEdited, field)) {
      protectedFields.push(field);
      return;
    }
    if (equal) return;
    patch[key] = value;
  };

  take("accountId", "accountId", resolution.accountId, current.accountId === resolution.accountId);
  take(
    "occurredAt",
    "occurredAt",
    incoming.occurredAt,
    current.occurredAt.getTime() === incoming.occurredAt.getTime(),
  );
  take("amountCents", "amountCents", incoming.amountCents, current.amountCents === incoming.amountCents);
  take("currency", "currency", incoming.currency, current.currency === incoming.currency);
  // A leg already paired as a giroconto stays one: the IBAN rule may have found what the provider
  // sent as a plain expense or income to be money moved between two of the user's accounts.
  const type =
    current.type === "transfer" && (current.transferGroupId ?? null) !== null
      ? "transfer"
      : resolveType(incoming);
  take("type", "type", type, current.type === type);
  take("state", "state", incoming.state, current.state === incoming.state);
  const payee = displayPayee(incoming.payee);
  take("payee", "payee", payee, current.payee === payee);
  take("categoryId", "categoryId", resolution.categoryId, current.categoryId === resolution.categoryId);
  take("note", "note", incoming.note, current.note === incoming.note);
  take("labels", "labelIds", resolution.labelIds, sameLabels(current.labelIds, resolution.labelIds));

  return { patch, changed: Object.keys(patch).length > 0, protectedFields };
}

/** The fields a person may change, as the interface submits them. Absent means "leave alone". */
export interface UserEdit {
  categoryId?: string | null;
  note?: string | null;
  labelIds?: readonly string[];
}

export interface UserEditPlan {
  patch: TransactionPatch;
  changed: boolean;
  /** The new `locally_edited`: the markers already there plus the fields this edit changes. */
  locallyEdited: string[];
}

/**
 * A local edit, and the marker it leaves behind (spec §7.2): every field it actually changes joins
 * `locally_edited` and is never overwritten by a sync again. Only a real change marks a field — a
 * form resubmitted with the provider's own values claims nothing, so the movement keeps following
 * the provider until the person really disagrees with it. Markers are never removed and the list
 * is kept sorted, so the column does not churn between equal states.
 */
export function planUserEdit(current: StoredTransaction, edit: UserEdit): UserEditPlan {
  const patch: TransactionPatch = {};
  const edited: EditableField[] = [];

  if (edit.categoryId !== undefined && edit.categoryId !== current.categoryId) {
    patch.categoryId = edit.categoryId;
    edited.push("categoryId");
  }
  if (edit.note !== undefined && edit.note !== current.note) {
    patch.note = edit.note;
    edited.push("note");
  }
  if (edit.labelIds !== undefined && !sameLabels(current.labelIds, edit.labelIds)) {
    patch.labelIds = edit.labelIds;
    edited.push("labels");
  }

  return {
    patch,
    changed: edited.length > 0,
    locallyEdited: markLocallyEdited(current.locallyEdited, edited),
  };
}

/** `locally_edited` with `edited` added: a set, sorted, and never losing a marker. */
export function markLocallyEdited(
  locallyEdited: readonly string[],
  edited: readonly EditableField[],
): string[] {
  return [...new Set([...locallyEdited, ...edited])].sort();
}

/* Disappeared upstream */

/**
 * A stored row as the removal check sees it. `key` is only ever tested for membership in the set
 * of keys the answer returned, so it may be the provider's external id or the local id — whichever
 * the caller can produce — as long as one call uses the same kind on both sides. The provider's id
 * lives in `provider_links`, not in `transactions` (spec §4.3), so a caller inside this module
 * usually has only the local one.
 */
export interface WindowRow {
  id: string;
  key: string;
  occurredAt: Date;
  removedUpstreamAt: Date | null;
}

export interface UpstreamRemovalPlan {
  /** Rows to stamp with `removed_upstream_at`: inside the window, and no longer returned. */
  removed: string[];
  /** Rows to clear it on: the provider is sending them again. */
  restored: string[];
}

/**
 * What the re-read window says about rows the provider did not return (spec §7.2, §9.1).
 *
 * The window is the whole argument: Wallet is read back over a few days, not listed in full, so a
 * row outside it is simply not covered by this answer and is never touched — the only rows that
 * can be declared gone are those the provider was asked about and did not send. A row that comes
 * back has the stamp cleared and counts again. Nothing is ever deleted, and a row already stamped
 * and still missing produces no second write.
 */
export function planUpstreamRemovals(
  stored: readonly WindowRow[],
  returnedKeys: readonly string[],
  window: { from: CivilDate; to: CivilDate },
  timeZone: string,
): UpstreamRemovalPlan {
  const returned = new Set(returnedKeys);
  const plan: UpstreamRemovalPlan = { removed: [], restored: [] };
  for (const row of stored) {
    const on = civilDateIn(row.occurredAt, timeZone);
    if (on < window.from || on > window.to) continue;
    if (returned.has(row.key)) {
      if (row.removedUpstreamAt !== null) plan.restored.push(row.id);
    } else if (row.removedUpstreamAt === null) {
      plan.removed.push(row.id);
    }
  }
  return plan;
}

/* Recurrences */

/** A stored movement as recurrence detection sees it. */
export interface RecurrenceInput {
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  payee: string | null;
  type: TransactionType;
  transferGroupId: string | null;
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
}

/** One detected pattern, in the shape `recurring_patterns` stores (spec §7.2). */
export interface DetectedRecurrence {
  payeeKey: string;
  /** The payee as last written by the provider, for display; `payeeKey` is the identity. */
  payee: string;
  currency: string;
  sign: 1 | -1;
  cadence: Cadence;
  intervalDays: number;
  /** The median of the group, signed like its movements. */
  medianCents: Cents;
  occurrences: number;
  lastSeenOn: CivilDate;
  nextExpectedOn: CivilDate;
}

const TOLERANCE_SCALE = 1_000_000n;
const TOLERANCE_SCALED = BigInt(Math.round(RECURRENCE_AMOUNT_TOLERANCE * Number(TOLERANCE_SCALE)));

/** Days since the epoch of a civil date: exact, and the only arithmetic the bands need. */
function dayNumber(date: CivilDate): number {
  if (!isCivilDate(date)) throw new RangeError(`Not a civil date: "${date}"`);
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function abs(value: Cents): Cents {
  return value < 0n ? -value : value;
}

/** The median of ascending positive amounts; an even count takes the two middles, rounded up. */
function median(sorted: readonly Cents[]): Cents {
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle] + 1n) / 2n;
}

function cadenceFor(gaps: readonly number[]): Cadence | null {
  const band = RECURRENCE_BANDS.find((one) => gaps.every((gap) => gap >= one.min && gap <= one.max));
  return band ? band.cadence : null;
}

/** The mean gap in whole days, rounded half-up: the column is an integer number of days. */
function meanIntervalDays(gaps: readonly number[]): number {
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return Math.floor((2 * total + gaps.length) / (2 * gaps.length));
}

interface Occurrence {
  on: CivilDate;
  amountCents: Cents;
  payee: string;
}

interface Group {
  payeeKey: string;
  currency: string;
  sign: 1 | -1;
  occurrences: Occurrence[];
}

/**
 * The recurring payees of a user, from their own movements (spec §7.2).
 *
 * Transfers and movements with no payee are out, and so is anything hidden or gone from the
 * provider. What is left is grouped by normalised payee, currency and sign — a salary and a direct
 * debit under one name stay two patterns, and so does a payee billing in two currencies. A group
 * is a pattern when it has at least three occurrences, every gap between consecutive dates lands
 * in one single band, and every amount is within 10% of the group's median; amounts are compared
 * in integer cents, so the band cannot drift on a rounding. The next date expected is the last one
 * plus the mean interval.
 *
 * Dates are the user's own civil dates (`timeZone`), never a UTC day: a charge at half past
 * midnight in Rome belongs to the day the person saw it, and that is the day the gaps are measured
 * on. Two movements on the same day leave a gap of zero, which fits no band, so a payee billing
 * twice in one day is not a pattern.
 */
export function detectRecurrences(rows: readonly RecurrenceInput[], timeZone: string): DetectedRecurrence[] {
  const groups = new Map<string, Group>();
  for (const row of excludeHidden(rows)) {
    if (row.type === "transfer" || row.transferGroupId !== null) continue;
    if (row.amountCents === 0n) continue;
    const payeeKey = payeeKeyOf(row.payee);
    const payee = displayPayee(row.payee);
    if (payeeKey === null || payee === null) continue;
    const sign: 1 | -1 = row.amountCents < 0n ? -1 : 1;
    const key = JSON.stringify([payeeKey, row.currency, sign]);
    const group = groups.get(key) ?? { payeeKey, currency: row.currency, sign, occurrences: [] };
    group.occurrences.push({
      on: civilDateIn(row.occurredAt, timeZone),
      amountCents: row.amountCents,
      payee,
    });
    groups.set(key, group);
  }

  const detected: DetectedRecurrence[] = [];
  for (const group of groups.values()) {
    if (group.occurrences.length < RECURRENCE_MIN_OCCURRENCES) continue;
    const sorted = [...group.occurrences].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(dayNumber(sorted[i].on) - dayNumber(sorted[i - 1].on));
    }
    const cadence = cadenceFor(gaps);
    if (cadence === null) continue;

    const amounts = sorted.map((one) => abs(one.amountCents)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const middle = median(amounts);
    const withinBand = amounts.every(
      (amount) => abs(amount - middle) * TOLERANCE_SCALE <= middle * TOLERANCE_SCALED,
    );
    if (!withinBand) continue;

    const last = sorted[sorted.length - 1];
    const intervalDays = meanIntervalDays(gaps);
    detected.push({
      payeeKey: group.payeeKey,
      payee: last.payee,
      currency: group.currency,
      sign: group.sign,
      cadence,
      intervalDays,
      medianCents: group.sign === -1 ? -middle : middle,
      occurrences: sorted.length,
      lastSeenOn: last.on,
      nextExpectedOn: addDays(last.on, intervalDays),
    });
  }

  return detected.sort(
    (a, b) => a.payeeKey.localeCompare(b.payeeKey) || a.currency.localeCompare(b.currency) || a.sign - b.sign,
  );
}
