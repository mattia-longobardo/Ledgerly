import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { externalIdsOf, IntegrationError, linkExternal } from "../../../platform/integrations/service";
import { isUniqueViolation } from "../../../platform/db/errors";
import { type CategoryType, NAME_MAX } from "../rules";
import { categories } from "../schema";
import { TaxonomyError, adoptOrCreateCategory } from "../taxonomy";
import { parseId } from "./guards";

/* Categories, seen from the provider sync (spec §9.1, §7.2) */

/**
 * One local category as the two-way category sync needs it: what it is called here, what Wallet
 * called it when the two last agreed, whether the person has touched it, and the provider's own
 * ids — its own, and its group's, which is what a category created in Wallet has to hang from.
 *
 * `externalId` is `null` for a category Wallet has never seen: those are the ones the pass offers
 * to create there. `groupExternalId` is this row's link as one of the provider's **groups** (F2.5
 * files a Wallet category's group as a parent category here), which is a different link from
 * `externalId` and may sit beside it on the same row.
 */
export interface ProviderCategory {
  id: string;
  name: string;
  type: CategoryType;
  parentId: string | null;
  archived: boolean;
  locallyEdited: readonly string[];
  providerName: string | null;
  externalId: string | null;
  groupExternalId: string | null;
}

/** What `categories.name` holds here: Wallet allows eighty characters, this app sixty (spec §6). */
export const CATEGORY_NAME_MAX = NAME_MAX;

/**
 * Every category of this user, with the provider's ids attached — archived ones included, because
 * an archived category still holds its name and still answers for its link. Ordered by id so two
 * passes see the same rows in the same sequence, which is what makes a capped pass resume where
 * the last one stopped instead of re-doing its beginning.
 */
export async function listProviderCategories(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<ProviderCategory[]> {
  const rows = await getDb()
    .select()
    .from(categories)
    .where(userScoped(ctx).owns(categories))
    .orderBy(asc(categories.id));
  const ids = rows.map((row) => row.id);
  const own = await externalIdsOf(ctx, provider, "category", ids);
  // A group is linked under its own entity type (F2.5), so the two maps are read separately.
  const groups = await externalIdsOf(ctx, provider, "category_group", ids);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    archived: row.archivedAt !== null,
    locallyEdited: row.locallyEdited,
    providerName: row.providerName,
    externalId: own.get(row.id) ?? null,
    groupExternalId: groups.get(row.id) ?? null,
  }));
}

/**
 * Wallet renamed a category and nothing here disagreed, so the local row follows it (spec §9.1)
 * and the baseline moves with it — the next pass sees the two agreeing rather than a name that
 * changed on its own.
 *
 * A name already taken by a sibling answers `"duplicate"` instead of throwing: the provider is
 * allowed to have two categories our unique key cannot hold apart, and that is a case to report,
 * never a reason to fail a whole pass. The `locally_edited` marker is deliberately untouched: the
 * caller only asks for this when there is none.
 */
/**
 * A category the provider publishes that nothing here mirrors yet (spec §9.1): it is taken on as
 * soon as the list is read, rather than waiting for a movement to be filed under it. Wallet's
 * `GET /categories` publishes the whole list, so a category added there appears here at the next
 * sync even if nobody has spent anything in it — which is what makes the two lists match and what
 * lets a budget or a filter name it straight away (owner, 2026-09-20).
 *
 * The same `adoptOrCreateCategory` the movements go through, so a name that already exists here is
 * adopted and linked rather than duplicated, and the provider's group becomes the parent. Wallet
 * publishes no type on a category, so a new one starts as its group's and can be corrected here;
 * a name this app's column cannot hold is refused rather than failing the pass.
 */
export async function adoptProviderCategory(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  remote: {
    externalId: string;
    name: string;
    groupExternalId: string | null;
    groupName: string | null;
  },
): Promise<"linked" | "refused"> {
  const groupName = remote.groupName?.trim() ?? "";
  try {
    await adoptOrCreateCategory(
      ctx,
      remote.name,
      { provider, externalId: remote.externalId },
      groupName === "" ? undefined : { name: groupName, externalId: remote.groupExternalId },
    );
    return "linked";
  } catch (error) {
    if (error instanceof TaxonomyError && (error.code === "invalid" || error.code === "duplicate")) {
      return "refused";
    }
    throw error;
  }
}

export async function followProviderCategoryName(
  ctx: Pick<Ctx, "userId">,
  id: string,
  name: string,
): Promise<"renamed" | "duplicate" | "not_found"> {
  const categoryId = parseId(id);
  try {
    const rows = await getDb()
      .update(categories)
      .set({ name, providerName: name })
      .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
      .returning({ id: categories.id });
    return rows.length === 0 ? "not_found" : "renamed";
  } catch (error) {
    if (isUniqueViolation(error, "categories_user_parent_name_uq")) return "duplicate";
    throw error;
  }
}

/**
 * The provider now holds `providerName` for this category — either because it was just written
 * there, or because the two turned out to agree already. Recording it is what closes the loop:
 * the baseline stops the next pass seeing a change that has already been settled, and dropping the
 * `name` marker lets a later rename *in Wallet* come back here (spec §9.1, two-way since F6).
 */
export async function settleProviderCategoryName(
  ctx: Pick<Ctx, "userId">,
  id: string,
  providerName: string,
): Promise<void> {
  const categoryId = parseId(id);
  await getDb()
    .update(categories)
    // One statement rather than a read and a write: the marker is dropped from whatever the column
    // holds at that moment, so a rename saved in Settings › Data between the two cannot be lost.
    // Only `name` goes; `type` is not the provider's to settle.
    .set({ providerName, locallyEdited: sql`array_remove(${categories.locallyEdited}, 'name')` })
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
}

/**
 * Files the link of a category this app has just created at the provider, and records the name it
 * was created under as the baseline. `"conflict"` when that external id is already spoken for —
 * the answer arrived twice, or another category got there first — which leaves this category
 * unlinked and reported rather than stealing a link that belongs elsewhere.
 */
export async function linkProviderCategory(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  id: string,
  externalId: string,
  providerName: string,
): Promise<"linked" | "conflict"> {
  const categoryId = parseId(id);
  try {
    await linkExternal(ctx, { provider, entityType: "category", entityId: categoryId, externalId });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "link_conflict") return "conflict";
    throw error;
  }
  await getDb()
    .update(categories)
    .set({ providerName })
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
  return "linked";
}
