/**
 * The rules of "To review" (rewrite plan N3; ux/n3-categories-manual.md §4, §6): how the movements
 * with no category are grouped, and which categories look like the same one. Pure.
 */
import type { CivilDate } from "../../../shared/dates";
import { DEFAULT_CATEGORIES } from "./tables";
import { normalise } from "./text";

/** A movement that waits for a category, as the review shows it. */
export interface ReviewRow {
  id: string;
  /** The key of its text (`memoryKey`); empty for a movement with no text. */
  key: string;
  /** The text a person reads it by. */
  text: string;
  on: CivilDate;
  accountId: string;
  amountCents: bigint;
  suggestedCategoryId: string | null;
  reason: string | null;
  params: Record<string, string> | null;
}

/** Movements with the same text and the same suggestion: one decision for all of them. */
export interface ReviewGroup {
  /** Stable for the same movements: the key of the text and the suggestion. */
  id: string;
  /** The text of the most recent movement. */
  text: string;
  count: number;
  totalCents: bigint;
  suggestedCategoryId: string | null;
  reason: string | null;
  params: Record<string, string> | null;
  /** The newest first. */
  rows: ReviewRow[];
}

export interface Review {
  suggested: ReviewGroup[];
  unsuggested: ReviewGroup[];
  /** The movements with no similar one in the view, the newest first. */
  singles: ReviewRow[];
}

const newestFirst = (a: ReviewRow, b: ReviewRow) =>
  a.on < b.on ? 1 : a.on > b.on ? -1 : a.id < b.id ? -1 : 1;

/**
 * The view of "To review": groups of at least two movements with the same text and the same
 * suggestion, the largest first and, between two of one size, the most recent first; then the
 * movements that are alone. A movement with no text is always alone.
 */
export function reviewGroups(rows: readonly ReviewRow[]): Review {
  const byGroup = new Map<string, ReviewRow[]>();
  const singles: ReviewRow[] = [];
  for (const row of rows) {
    if (row.key === "") {
      singles.push(row);
      continue;
    }
    const id = `${row.key}|${row.suggestedCategoryId ?? ""}`;
    const list = byGroup.get(id) ?? [];
    list.push(row);
    byGroup.set(id, list);
  }
  const groups: ReviewGroup[] = [];
  for (const [id, list] of byGroup) {
    if (list.length < 2) {
      singles.push(...list);
      continue;
    }
    const sorted = [...list].sort(newestFirst);
    groups.push({
      id,
      text: sorted[0].text,
      count: sorted.length,
      totalCents: sorted.reduce((sum, row) => sum + row.amountCents, 0n),
      suggestedCategoryId: sorted[0].suggestedCategoryId,
      reason: sorted[0].reason,
      params: sorted[0].params,
      rows: sorted,
    });
  }
  groups.sort((a, b) => b.count - a.count || newestFirst(a.rows[0], b.rows[0]));
  return {
    suggested: groups.filter((group) => group.suggestedCategoryId !== null),
    unsuggested: groups.filter((group) => group.suggestedCategoryId === null),
    singles: singles.sort(newestFirst),
  };
}

/** A category as the merge proposals read it. */
export interface MergeCategory {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  /** Whether a source gives this category: such a one is associated, never merged (decision H34). */
  fromSource: boolean;
}

/** The key of a pair, whichever way it is said. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Words that say nothing about what a category holds. */
const FILLER = new Set([
  "e",
  "ed",
  "and",
  "the",
  "di",
  "del",
  "della",
  "dei",
  "il",
  "la",
  "le",
  "of",
  "per",
  "for",
  "altro",
  "other",
]);

/** The names of the default tree, in both languages: the tree is one design, never a duplicate of itself. */
const DEFAULT_NAMES = new Set(DEFAULT_CATEGORIES.flatMap((one) => [normalise(one.en), normalise(one.it)]));

function words(name: string): string[] {
  return normalise(name)
    .split(" ")
    .filter((word) => word.length > 1 && !FILLER.has(word));
}

/** A pair that is two things whatever its names: two kinds, a group and its own sub-category, two of the default tree, or said so by the person. */
function neverMerged(
  one: { category: MergeCategory; isDefault: boolean },
  other: { category: MergeCategory; isDefault: boolean },
  dismissed: ReadonlySet<string>,
): boolean {
  return (
    one.category.type !== other.category.type ||
    one.category.parentId === other.category.id ||
    other.category.parentId === one.category.id ||
    (one.isDefault && other.isDefault) ||
    dismissed.has(pairKey(one.category.id, other.category.id))
  );
}

/**
 * The pairs of categories that look like the same one (decision S2b): two categories of one kind
 * whose names are the same words, or where every word of one is among the words of the other —
 * "Tobacco" and "Alcohol, tobacco". Never a group with its own sub-category, never a category a
 * source gives, never two categories of the default tree ("Postal services" and "Services"), never a
 * pair the person already said is two things.
 */
export function mergeProposals(
  categories: readonly MergeCategory[],
  dismissed: ReadonlySet<string>,
): [MergeCategory, MergeCategory][] {
  const pairs: [MergeCategory, MergeCategory][] = [];
  const named = categories
    .filter((category) => !category.fromSource)
    .map((category) => ({
      category,
      words: words(category.name),
      isDefault: DEFAULT_NAMES.has(normalise(category.name)),
    }));
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const a = named[i];
      const b = named[j];
      if (neverMerged(a, b, dismissed)) continue;
      const [few, many] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words];
      // A name of one short word inside a longer name is too little to go by.
      if (few.length === 0 || (few.length < many.length && few.every((word) => word.length < 4))) continue;
      if (few.every((word) => many.includes(word))) pairs.push([a.category, b.category]);
    }
  }
  return pairs;
}
