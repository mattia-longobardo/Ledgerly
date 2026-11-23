import { nameKey } from "../../../shared/inputs";
import type { Cents } from "../../../shared/money";
import { type TransactionState, type TransactionType } from "./vocabulary";

/* Provider input */

/**
 * One movement as the transactions module receives it, whatever provider it came from. The source's
 * own shape stops at its adapter (spec §9.1): nothing below this line knows a source's
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
   * The provider's group of that category (F2.5), which becomes its parent here. The source sends it
   * as `{ id, name }`; either may be missing, and without a name there is nothing to adopt.
   */
  categoryGroupExternalId: string | null;
  categoryGroupName: string | null;
  labels: readonly string[];
  /**
   * The key a movement written here was sent to the source with, when the source gives it back
   * carrying one: the reading takes the waiting movement for it instead of writing a second row.
   */
  sentKey?: string | null;
  /**
   * What a bank wrote about the movement, untouched, when the provider reads a bank: the free
   * text, the other party and the two codes. Written once, with the movement.
   */
  raw?: {
    text: string | null;
    counterparty: string | null;
    merchantCategoryCode: string | null;
    bankTransactionCode: string | null;
  };
}

/** What the service resolved for an incoming movement before the rules decide anything. */
export interface ProviderResolution {
  accountId: string;
  categoryId: string | null;
  /** The row of the source's own category, for a source that gives one; it never decides the merge. */
  sourceCategoryId?: string | null;
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
  const key = nameKey(payee ?? "");
  return key === "" ? null : key;
}

/* Visibility */

/** The two columns that decide whether a row counts (spec §7.2). */
interface Visibility {
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
}

/**
 * Whether a row is out of every total, budget, subscription check and recurrence detection: the
 * user hid it, or the source stopped returning it inside the re-read window, which is treated exactly
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
 * The colours a group of categories is drawn with (spec §8.3, the design's category dots), and the
 * presets the colour picker offers. One family: in OKLCH the chroma is near-constant and the
 * lightness is near 0.70; blue and violet are a little darker and the income yellow a little
 * lighter, so that each reads as bright as the others. The comment after each value names the root
 * category it was chosen for.
 */
export const CATEGORY_COLORS = [
  "#ed4a49", // red — Food & Drinks
  "#df911a", // dark yellow — Housing
  "#ebc831", // yellow — Income
  "#4db956", // green — Life & Entertainment
  "#05b9cf", // cyan — Financial expenses
  "#3fa9e5", // light blue — Shopping
  "#356ddc", // blue — PC, Communication
  "#8e57d8", // violet — Vehicle
  "#e141aa", // magenta — Investment
  "#5e646c", // dark grey — System categories, Others, Unknown
  "#a8afb8", // light grey — Transportation
] as const;

/**
 * The colour of a group that has not been given one, from its own id.
 *
 * Derived rather than written: a colour nobody chose is not a decision worth storing, and deriving
 * it means the rows that existed before this rule get one too, without a migration and without a
 * read that quietly writes. The moment somebody picks a colour it is stored, and the stored one
 * wins for ever after — which is exactly what "assigned automatically, and changeable" means.
 *
 * The hash is FNV-1a over the id: small, stable across processes and versions, and with no reason
 * to be anything cleverer — the only property that matters is that the same id always lands on the
 * same colour.
 */
export function autoCategoryColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

/**
 * What colour a category is drawn in, anywhere it is drawn.
 *
 * A sub-category has no colour of its own (spec §7.2, F2.5): it is its group's, so that a legend,
 * a chart and a table all say the same thing about the same money. A group falls back to
 * {@link autoCategoryColor}, so nothing is ever colourless.
 */
export function categoryColor(
  category: { id: string; parentId: string | null; color: string | null },
  groupColor?: string | null,
): string {
  if (category.parentId !== null) return groupColor ?? autoCategoryColor(category.parentId);
  return category.color ?? autoCategoryColor(category.id);
}

/**
 * The colour a category is drawn in: its own when it is a group and somebody chose one, its
 * group's when it is a sub-category, and otherwise the one derived from the id (`categoryColor`).
 * Nothing is ever colourless, and a group and its children always agree.
 */
export function colorOfCategory(
  category: { id: string; parentId: string | null; color: string | null },
  groups: ReadonlyMap<string, { id: string; parentId: string | null; color: string | null }>,
): string {
  const group = category.parentId === null ? null : groups.get(category.parentId);
  return categoryColor(category, group ? categoryColor(group) : null);
}

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

/**
 * What a category covers (spec §7.2, F2.5; audit BUD-5): itself and, for a group, its sub-categories.
 * The budgets' spent counts it; the filter of Expenses applies the same rule in SQL (`conditions`).
 */
export function categoryFamily(
  id: string,
  tree: readonly { id: string; parentId: string | null }[],
): ReadonlySet<string> {
  return new Set([id, ...tree.filter((one) => one.parentId === id).map((one) => one.id)]);
}
