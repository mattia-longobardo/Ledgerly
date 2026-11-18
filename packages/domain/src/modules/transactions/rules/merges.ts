import { type CivilDate, civilDateIn } from "../../../platform/dates";
import {
  displayPayee,
  type IncomingTransaction,
  type NewTransaction,
  type ProviderResolution,
  type StoredTransaction,
  type TransactionPatch,
} from "./records";
import { type EditableField, type MergeableField, type TransactionType } from "./vocabulary";

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

interface ProviderMergePlan {
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
  const type = resolveType(incoming);
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

interface UserEditPlan {
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

/* Categories: the same marker, on the fields a person can change here */

/**
 * What `categories.locally_edited` may hold. `name` is the one the two-way sync acts on — it makes
 * the local name win and be written to Wallet — and it is dropped again once Wallet has been told,
 * because from then on the two agree. `type` is never dropped: Wallet has no income/expense/
 * transfer of its own to disagree with, so a type chosen here is local for good (spec §9.1).
 */
type CategoryEditableField = "name" | "type";

/** `locally_edited` for a category, with `edited` added: a set, sorted, never losing a marker. */
export function markCategoryEdited(
  locallyEdited: readonly string[],
  edited: readonly CategoryEditableField[],
): string[] {
  return [...new Set([...locallyEdited, ...edited])].sort();
}

/**
 * A settled push takes the `name` marker off again — the local value did not lose, it arrived —
 * and that happens in one SQL statement in `service.ts` (`array_remove`), never as a read and a
 * write around it: a rename saved in between would be the one thing lost.
 */

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

interface UpstreamRemovalPlan {
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
