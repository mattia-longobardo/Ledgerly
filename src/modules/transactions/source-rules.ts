/**
 * The categories of a source that gives its own (rewrite plan N3.1, 12-account-modes.md §12.3;
 * ux/n3-categories-manual.md §6.4), as pure rules: what a reading does to the row of one, which
 * of them a movement written here is sent with, and whether a category shows where it comes from.
 * No source is named here: a row says which one it is of.
 */

/** A source's category as a reading gives it. */
export interface RemoteSourceCategory {
  externalId: string;
  name: string;
  groupName: string | null;
}

/** The stored row, as the rules read it. */
export interface StoredSourceCategory {
  id: string;
  name: string;
  groupName: string | null;
  /** Where its movements count. */
  categoryId: string | null;
  /** The category that was added for it. */
  addedCategoryId: string | null;
}

/** "added": it counts under its own category. "matched": under another one the person chose. */
export type SourceCategoryChoice = "added" | "matched";

export function choiceOf(
  row: Pick<StoredSourceCategory, "categoryId" | "addedCategoryId">,
): SourceCategoryChoice {
  return row.categoryId !== null && row.categoryId !== row.addedCategoryId ? "matched" : "added";
}

export interface SourceCategoryPlan {
  /** The category the source's movements count under after this reading. */
  categoryId: string;
  /** A row to write, for a category seen for the first time: it is "added", and "New". */
  insert: boolean;
  /** The columns of the stored row that change; empty when the reading says what is stored. */
  patch: Partial<Pick<StoredSourceCategory, "name" | "groupName" | "categoryId" | "addedCategoryId">>;
  /** The category the person matched it to is gone: it counts under its own again, brought back. */
  restoreAdded: boolean;
}

/**
 * What a reading does to one category of a source. `addedId` is the category this app holds for it
 * (found by the source's id, then by its exact name, or just made).
 *
 * A category seen for the first time is "added". A known one keeps the person's match, follows the
 * source's name, and follows its own category when that one was replaced. A match whose category
 * was deleted falls back to "added": a movement is never left with no category for it.
 */
export function planSourceCategory(
  stored: StoredSourceCategory | undefined,
  remote: RemoteSourceCategory,
  addedId: string,
): SourceCategoryPlan {
  if (stored === undefined) return { categoryId: addedId, insert: true, patch: {}, restoreAdded: false };
  const patch: SourceCategoryPlan["patch"] = {};
  if (stored.name !== remote.name) patch.name = remote.name;
  // A reading that carries no group says nothing about it: the one stored stays.
  if (remote.groupName !== null && stored.groupName !== remote.groupName) patch.groupName = remote.groupName;
  if (stored.addedCategoryId !== addedId) patch.addedCategoryId = addedId;
  const follows = stored.categoryId === null || stored.categoryId === stored.addedCategoryId;
  const categoryId = follows ? addedId : (stored.categoryId as string);
  if (categoryId !== stored.categoryId) patch.categoryId = categoryId;
  return {
    categoryId,
    insert: false,
    patch,
    restoreAdded: stored.categoryId === null && stored.addedCategoryId !== null,
  };
}

/** A category of a source that counts under the category a movement was written with. */
export interface SourceCategoryCandidate {
  externalId: string;
  name: string;
  /** How many movements of the source carry it. */
  count: number;
}

/**
 * The source's category a movement written here is sent with (ux §18, point 20): among the ones
 * that count under the chosen category, the one with the same name; otherwise the most used; and
 * the same one every time when two are used as much. `null` when none counts under it: the
 * movement is sent with no category.
 */
export function pickSourceCategory(
  candidates: readonly SourceCategoryCandidate[],
  categoryName: string,
): string | null {
  if (candidates.length === 0) return null;
  const wanted = categoryName.trim().toLowerCase();
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(b.name.trim().toLowerCase() === wanted) - Number(a.name.trim().toLowerCase() === wanted) ||
      b.count - a.count ||
      (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0),
  );
  return ordered[0].externalId;
}

/**
 * The names a category shows under its own, "From {source}: …" (ux §6.4): only where they say
 * something the name does not — several categories of the source, or one called another way.
 */
export function sourceNamesShown(categoryName: string, names: readonly string[]): string[] {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return [];
  return sorted.length === 1 && sorted[0] === categoryName ? [] : sorted;
}
