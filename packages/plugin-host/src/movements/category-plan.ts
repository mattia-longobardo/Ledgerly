/**
 * The plan of the category sync of spec §9.1, both ways (F6): what one pass should do, decided
 * without touching the database or the network so that every rule can be read off a test.
 *
 * A source with the capability `categories` takes three writes through its plugin (`POST
 * /categories/write` of contract 2): a rename of a category, the creation of a subcategory under one
 * of the source's **base** categories, and — only on a person's request, never from a pass — a
 * deletion. The source's groups and its base categories are fixed, so a group made here has no
 * counterpart to create there; a category has no type at the source (the type stays this app's own,
 * spec §7.2), and a group cannot be created or renamed.
 */
import type { SourceCategory } from "./calls";
import type { ProviderCategory } from "./ports";

/** The longest name a rename or a creation at the source may carry. */
const SOURCE_CATEGORY_NAME_MAX = 80;

/**
 * Everything one pass has to say that is not a write. None of these ever deletes anything: a
 * category can carry movements, so a disappearance on either side is reported and left alone
 * (spec §7.2).
 */
type CategoryCaseKind =
  /** Renamed on both sides since they last agreed: the local name won and went to the source. */
  | "conflict"
  /** Linked here, no longer in the source's list. Never deleted here. */
  | "gone_from_source"
  /** The source files it under its built-in Transfer category and this app does not, or the reverse. */
  | "type_mismatch"
  /** The source's name does not fit this app's column, so the local name stays (as it did in F2.5). */
  | "name_too_long"
  /** The source's name is already taken by a sibling here: the unique key of §6 wins. */
  | "duplicate_name"
  /** A group renamed here. The source's groups are fixed — no call can carry this. */
  | "group_not_writable"
  /** Made here, with nothing at the source that could be its parent. */
  | "not_creatable"
  /** Over this pass's write budget; the next pass takes it. */
  | "deferred"
  /** The source refused the write, or answered something nobody could read. */
  | "write_failed";

export interface CategoryCase {
  kind: CategoryCaseKind;
  categoryId: string | null;
  externalId: string | null;
  /** What this app calls it, and what the source calls it — whichever of the two is known. */
  local: string | null;
  remote: string | null;
  detail?: string;
}

export interface CategoryPlan {
  /** The source renamed it and nothing here disagreed: the local row follows. */
  adopt: { categoryId: string; name: string }[];
  /** Renamed here: the source is told, in batches. */
  push: { categoryId: string; externalId: string; name: string }[];
  /** Already agreeing, with a baseline that has drifted: recorded, nothing written anywhere. */
  settle: { categoryId: string; providerName: string }[];
  /** Made here, under a group the source knows: created there as a subcategory. */
  create: { categoryId: string; name: string; parentExternalId: string }[];
  /** At the source and nowhere here: taken on, with its group as parent. */
  add: { externalId: string; name: string; groupExternalId: string | null; groupName: string | null }[];
  cases: CategoryCase[];
}

/** A fresh plan every time: the arrays are filled in place, so no two callers may share them. */
function emptyPlan(): CategoryPlan {
  return { adopt: [], push: [], settle: [], create: [], add: [], cases: [] };
}

/** A name of the source this app's column can hold (`nameMax`, what `categories.name` holds here). */
function fitsHere(name: string, nameMax: number): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed.length <= nameMax;
}

/**
 * The base category a new subcategory can hang from: one of the source's own (not custom, not
 * archived) inside the group the local parent is mirrored from. Deterministic, so two passes over
 * the same list pick the same parent.
 */
function baseCategoryIn(remote: readonly SourceCategory[], groupExternalId: string): SourceCategory | null {
  const candidates = remote
    .filter((row) => !row.custom && !row.archived && row.groupExternalId === groupExternalId)
    .sort((left, right) => (left.externalId < right.externalId ? -1 : 1));
  return candidates[0] ?? null;
}

/**
 * The three-way merge of §7.2, applied to a category's name.
 *
 * The baseline is `providerName`: the name the source published when the two sides last agreed.
 * With it, "only here changed", "only there changed" and "both changed" are three different facts
 * rather than one guess — which is the whole reason the column exists. Without it (a row from
 * before this pass existed) the older rule still holds: a local edit wins, otherwise the source's
 * name is adopted, and nothing is called a conflict that cannot be shown to be one.
 *
 * A local edit wins in every case, and is written to the source. That is not a contradiction of
 * "local edits are never overwritten": it is the same sentence read from the other end — the local
 * value is the one that survives, and the provider is brought to it.
 */
function mergeName(
  local: ProviderCategory,
  remote: SourceCategory,
): "agreed" | "adopt" | "push" | "conflict" {
  if (local.name === remote.name) return "agreed";
  // `locally_edited` is the person's own mark (spec §7.2); a name that has walked away from the
  // baseline says the same thing about a row whose marker was cleared by an earlier settled push.
  const changedHere =
    local.locallyEdited.includes("name") ||
    (local.providerName !== null && local.name !== local.providerName);
  if (!changedHere) return "adopt";
  const changedThere = local.providerName === null || remote.name !== local.providerName;
  return changedThere ? "conflict" : "push";
}

/** What the plan knows of this app's side while it walks the local list. */
interface Here {
  plan: CategoryPlan;
  takenNames: ReadonlySet<string>;
  nameMax: number;
}

/** A case about a category linked to `mirror`, named the same way for every kind. */
function caseOf(kind: CategoryCaseKind, category: ProviderCategory, mirror: SourceCategory): CategoryCase {
  return {
    kind,
    categoryId: category.id,
    externalId: mirror.externalId,
    local: category.name,
    remote: mirror.name,
  };
}

/** The source renamed it: the local row follows, unless the name cannot be held or is taken here. */
function planAdoption(here: Here, category: ProviderCategory, mirror: SourceCategory): void {
  if (!fitsHere(mirror.name, here.nameMax)) {
    here.plan.cases.push(caseOf("name_too_long", category, mirror));
  } else if (here.takenNames.has(`${category.parentId ?? ""}\u0000${mirror.name.trim()}`)) {
    here.plan.cases.push(caseOf("duplicate_name", category, mirror));
  } else {
    here.plan.adopt.push({ categoryId: category.id, name: mirror.name.trim() });
  }
}

/** Renamed here: the source is told, unless no call can carry the name. */
function planPush(plan: CategoryPlan, category: ProviderCategory, mirror: SourceCategory): void {
  if (category.parentId === null) {
    // A group here is one of the source's groups, and no call renames one.
    plan.cases.push(caseOf("group_not_writable", category, mirror));
  } else if (category.name.length > SOURCE_CATEGORY_NAME_MAX) {
    plan.cases.push({
      ...caseOf("write_failed", category, mirror),
      detail: `longer than the ${SOURCE_CATEGORY_NAME_MAX} characters the source accepts`,
    });
  } else {
    plan.push.push({ categoryId: category.id, externalId: mirror.externalId, name: category.name });
  }
}

/** One local category the source also publishes (`mirror`). */
function planMirrored(here: Here, category: ProviderCategory, mirror: SourceCategory): void {
  const plan = here.plan;
  // The type is never moved by a sync, in either direction: the source publishes none on a
  // category, and the one thing it does say — that this is its built-in Transfer category — is a
  // fact this app reads off the movements (spec §7.2). A disagreement is reported and the local
  // type kept.
  const sourceSaysTransfer = mirror.transfer;
  if (sourceSaysTransfer !== (category.type === "transfer")) {
    plan.cases.push({
      ...caseOf("type_mismatch", category, mirror),
      local: category.type,
      remote: sourceSaysTransfer ? "transfer" : "not transfer",
    });
  }
  const verdict = mergeName(category, mirror);
  if (verdict === "conflict") plan.cases.push(caseOf("conflict", category, mirror));
  if (verdict === "agreed") {
    if (category.providerName !== mirror.name) {
      plan.settle.push({ categoryId: category.id, providerName: mirror.name });
    }
  } else if (verdict === "adopt") planAdoption(here, category, mirror);
  // A conflict is a push that was worth saying out loud: the local name won either way.
  else planPush(plan, category, mirror);
}

/*
  The other direction of the same list: a category the source publishes that nothing here mirrors.
  Until now one reached this app only when a movement was filed under it, so a category added at
  the source and not yet spent in was invisible here (owner, 2026-09-20).

  "Mirrored" covers both links: a category of the source's carries `externalId` here, and one that
  became a *group* here — the provider's group is the local parent (F2.5) — carries
  `groupExternalId`. Missing either would add a second copy of it every hour.

  An archived category is left alone: the source keeps it for its old records, and taking it on
  would fill this list with names nobody files anything under any more.
*/
function planAdditions(
  here: Here,
  local: readonly ProviderCategory[],
  remote: readonly SourceCategory[],
): void {
  const mirrored = new Set(
    local.flatMap((category) => [category.externalId, category.groupExternalId].filter((id) => id !== null)),
  );
  for (const category of remote) {
    if (category.archived || mirrored.has(category.externalId)) continue;
    if (!fitsHere(category.name, here.nameMax)) {
      here.plan.cases.push({
        kind: "name_too_long",
        categoryId: null,
        externalId: category.externalId,
        local: null,
        remote: category.name,
      });
      continue;
    }
    here.plan.add.push({
      externalId: category.externalId,
      name: category.name.trim(),
      groupExternalId: category.groupExternalId,
      groupName: category.groupName,
    });
  }
}

/**
 * What one pass should do, decided without touching the database or the network so that every rule
 * above can be read off a test. `nameMax` is what `categories.name` holds here.
 *
 * An empty `remote` list returns an empty plan: the source answering with no categories at all is
 * not a user who deleted ninety-one of them, and reading it that way would report every category
 * here as gone. The plugin already refuses a page that may be truncated, so this is the last guard
 * rather than the only one.
 */
export function planCategorySync(
  local: readonly ProviderCategory[],
  remote: readonly SourceCategory[],
  nameMax: number,
): CategoryPlan {
  if (remote.length === 0) return emptyPlan();
  const here: Here = {
    plan: emptyPlan(),
    takenNames: new Set(local.map((row) => `${row.parentId ?? ""}\u0000${row.name}`)),
    nameMax,
  };
  const byExternalId = new Map(remote.map((row) => [row.externalId, row]));
  const byId = new Map(local.map((row) => [row.id, row]));

  for (const category of local) {
    if (category.externalId === null) {
      const creation = planCreation(category, byId, remote);
      if (creation === null) continue;
      if ("kind" in creation) here.plan.cases.push(creation);
      else here.plan.create.push(creation);
      continue;
    }
    const mirror = byExternalId.get(category.externalId);
    if (mirror === undefined) {
      here.plan.cases.push({
        kind: "gone_from_source",
        categoryId: category.id,
        externalId: category.externalId,
        local: category.name,
        remote: null,
      });
      continue;
    }
    planMirrored(here, category, mirror);
  }
  planAdditions(here, local, remote);
  return here.plan;
}

/**
 * A category this app has and the source has never seen. Only a **sub**-category can be created
 * there, under a base category of the group its parent is mirrored from; everything else is
 * reported once and left alone. A group of this app's own is not reported at all: there is nothing
 * to decide about it every hour, for ever, and no call that could ever take it.
 */
function planCreation(
  category: ProviderCategory,
  byId: ReadonlyMap<string, ProviderCategory>,
  remote: readonly SourceCategory[],
): CategoryCase | { categoryId: string; name: string; parentExternalId: string } | null {
  if (category.archived) return null;
  if (category.parentId === null) return null;
  const refuse = (detail: string): CategoryCase => ({
    kind: "not_creatable",
    categoryId: category.id,
    externalId: null,
    local: category.name,
    remote: null,
    detail,
  });
  // Only the parent's `category_group` link names a group of the source. A parent's own *category*
  // link is a category id, which the creation would refuse — or, worse, accept as some other
  // category's parent.
  const parent = byId.get(category.parentId);
  if (parent === undefined) return refuse("its group is not one this user holds");
  if (parent.groupExternalId === null) return refuse("its group is not one of the source's");
  const base = baseCategoryIn(remote, parent.groupExternalId);
  if (base === null) return refuse("the source's group holds no base category to create it under");
  if (category.name.length > SOURCE_CATEGORY_NAME_MAX) {
    return refuse(`longer than the ${SOURCE_CATEGORY_NAME_MAX} characters the source accepts`);
  }
  return { categoryId: category.id, name: category.name, parentExternalId: base.externalId };
}
