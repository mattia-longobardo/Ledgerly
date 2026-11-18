import { and, eq, isNull } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { EntityType } from "../../../platform/integrations/rules";
import { IntegrationError, linkExternal, resolveExternal } from "../../../platform/integrations/service";
import { NAME_MAX } from "../rules";
import { categories, labels } from "../schema";
import {
  CATEGORY_ENTITY,
  GROUP_ENTITY,
  TaxonomyError,
  categoryById,
  categoryByName,
  hasChildren,
  hasCode,
  nameSchema,
  parsed,
  type Category,
  type ExternalCategoryRef,
  type Label,
  type ProviderGroupRef,
} from "./category-reads";
import { labelByName } from "./labels";

/**
 * Spec §9.1, in this order: the provider's own link, then a local category with that **exact**
 * name, then a new one. Steps 2 and 3 file the link, so the next sync stops at step 1 and follows
 * the category through a later rename.
 *
 * The order is the whole point, so the link is read before the name is so much as validated. A
 * name the column cannot hold (over `NAME_MAX`, which is this application's limit and not the
 * provider's) must never undo an adoption that already happened: validating first turned a rename
 * in the provider into `categoryId: null` on movements that were already filed and already linked,
 * once an hour, across the whole re-read window, with no error and nothing to reconcile against.
 *
 * An archived namesake is adopted as it stands and stays archived: the name is already taken, and
 * resurrecting a category somebody deliberately put away is not the sync's decision to make.
 *
 * **The provider's group (F2.5)** becomes the category's parent, found by the same ladder — its
 * `category_group` link, then a group with that exact name — and created only once the category is
 * known, so a group made for it takes *its* type: a category somebody marked as income must not
 * land under a group made up as spending. The name is then looked for under that group first and
 * among the groups second, which is where F2 left every category it adopted. A category found
 * without a parent is filed under the group when the two share a type and it has no children of its
 * own (`attachToGroup`); one that already has a parent is never moved. A group name the column
 * cannot hold is no group: the category is still adopted, where it would have been before F2.5.
 */
export async function adoptOrCreateCategory(
  ctx: Pick<Ctx, "userId">,
  name: string,
  external?: ExternalCategoryRef,
  group?: ProviderGroupRef,
): Promise<Category> {
  let linked: Category | undefined;
  if (external) {
    const found = await resolveExternal(ctx, external.provider, CATEGORY_ENTITY, [external.externalId]);
    const entityId = found.get(external.externalId);
    // A link whose category has since been deleted falls through to the name: `provider_links`
    // holds a plain uuid, not a foreign key (spec §4.3), so it can outlive its row.
    linked = entityId ? await categoryById(ctx, entityId) : undefined;
  }

  const groupName = group ? validName(group.name) : null;
  const groupRef = group && groupName !== null ? { name: groupName, externalId: group.externalId } : null;
  let parent = groupRef ? await findGroup(ctx, groupRef, external?.provider) : undefined;

  if (linked) {
    if (!groupRef) return linked;
    parent ??= await createGroup(ctx, groupRef, linked.type, external?.provider);
    return attachToGroup(ctx, linked, parent);
  }

  // Only here does the name carry any weight: with no usable link there is nothing to adopt but
  // the name, so one the column cannot hold is a real refusal. `service.ts` leaves that movement
  // uncategorised rather than failing the pass, which is the right call for a first encounter —
  // it takes nothing away, because there was nothing there yet.
  const wanted = parsed(nameSchema, name);
  let category = parent ? await categoryByName(ctx, wanted, parent.id) : undefined;
  category ??= await categoryByName(ctx, wanted, null);
  if (groupRef) {
    parent ??= await createGroup(ctx, groupRef, category?.type, external?.provider);
    if (category) category = await attachToGroup(ctx, category, parent);
    // A category named like its own group ("Others" in "Others") is the group itself, not a twin
    // underneath it.
    else if (parent.name === wanted) category = parent;
    else category = await insertAdoptedCategory(ctx, wanted, parent);
  } else {
    category ??= await insertAdoptedCategory(ctx, wanted, null);
  }

  if (external) await linkQuietly(ctx, external.provider, CATEGORY_ENTITY, category.id, external.externalId);
  return category;
}

/** A provider name as the column can hold it, or `null` when it cannot. */
function validName(name: string): string | null {
  const result = nameSchema.safeParse(name);
  return result.success ? result.data : null;
}

/**
 * Files a provider link, keeping going when another external id already owns this row: two of the
 * provider's categories (or groups) sharing one local name means only the first owns the link, and
 * the name lookup keeps working for the other, so it is not worth failing a whole sync over.
 */
async function linkQuietly(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: EntityType,
  entityId: string,
  externalId: string,
): Promise<void> {
  try {
    await linkExternal(ctx, { provider, entityType, entityId, externalId });
  } catch (error) {
    if (!(error instanceof IntegrationError) || error.code !== "link_conflict") throw error;
  }
}

/**
 * The group a provider group already is here: its link, while it still points at a group, then a
 * group with that exact name — which gets the link, so a rename on either side is followed next
 * time. `undefined` when there is none yet; creating it waits for the category's type.
 */
async function findGroup(
  ctx: Pick<Ctx, "userId">,
  group: ProviderGroupRef,
  provider: string | undefined,
): Promise<Category | undefined> {
  if (provider && group.externalId !== null) {
    const found = await resolveExternal(ctx, provider, GROUP_ENTITY, [group.externalId]);
    const entityId = found.get(group.externalId);
    const linked = entityId ? await categoryById(ctx, entityId) : undefined;
    if (linked && linked.parentId === null) return linked;
  }
  const named = await categoryByName(ctx, group.name, null);
  if (named && provider && group.externalId !== null) {
    await linkQuietly(ctx, provider, GROUP_ENTITY, named.id, group.externalId);
  }
  return named;
}

/** A new group for a provider group, of the type of the category it is being made for. */
async function createGroup(
  ctx: Pick<Ctx, "userId">,
  group: ProviderGroupRef,
  type: Category["type"] | undefined,
  provider: string | undefined,
): Promise<Category> {
  const [row] = await getDb()
    .insert(categories)
    .values(userScoped(ctx).stamp({ name: group.name, providerName: group.name, ...(type ? { type } : {}) }))
    .onConflictDoNothing()
    .returning();
  // Two syncs met on the same new group: the other one won, so take its row.
  const created = row ?? (await categoryByName(ctx, group.name, null));
  if (!created) throw new TaxonomyError("duplicate");
  if (provider && group.externalId !== null) {
    await linkQuietly(ctx, provider, GROUP_ENTITY, created.id, group.externalId);
  }
  return created;
}

/**
 * A category without a parent filed under the provider's group — when that is possible without
 * breaking a rule of §7.2: not the group itself, not a group with children of its own (a third
 * level), not one of another type (a child has its parent's type, and changing a type a person
 * may have set is not the sync's call), and never one whose group a person chose by hand — taking
 * a category out of its group is a local edit, and local edits win. Anything else leaves the
 * category where it is.
 */
async function attachToGroup(
  ctx: Pick<Ctx, "userId">,
  category: Category,
  group: Category,
): Promise<Category> {
  if (
    category.id === group.id ||
    category.parentSetLocally ||
    category.parentId !== null ||
    group.parentId !== null ||
    category.type !== group.type ||
    (await hasChildren(ctx, category.id))
  ) {
    return category;
  }
  try {
    const [row] = await getDb()
      .update(categories)
      .set({ parentId: group.id })
      .where(
        and(eq(categories.id, category.id), isNull(categories.parentId), userScoped(ctx).owns(categories)),
      )
      .returning();
    return row ?? category;
  } catch (error) {
    // A child was given to this category between the check and the write: it stays a group.
    if (hasCode(error, "23503")) return category;
    throw error;
  }
}

/**
 * The provider gives a name and nothing else, so the type is the parent's, or the column default
 * for a category with no parent.
 */
async function insertAdoptedCategory(
  ctx: Pick<Ctx, "userId">,
  name: string,
  parent: Category | null,
): Promise<Category> {
  const [row] = await getDb()
    .insert(categories)
    // `providerName` starts life equal to the name, because that is exactly what it means: the
    // name the provider published when the two sides last agreed. Without it a category created
    // by the sync would look, on the very next pass, like one whose baseline is unknown.
    .values(
      userScoped(ctx).stamp({
        name,
        providerName: name,
        ...(parent ? { parentId: parent.id, type: parent.type } : {}),
      }),
    )
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Two syncs met on the same new name: the other one won, so take its row.
  const raced = await categoryByName(ctx, name, parent?.id ?? null);
  if (!raced) throw new TaxonomyError("duplicate");
  return raced;
}

/**
 * The first `NAME_MAX` characters of a name. Characters, not code units: the column's CHECK is
 * `length(btrim(name)) between 1 and 60` and Postgres counts characters, so the budget is spent
 * exactly as the column measures it — and a surrogate pair is never cut in half.
 */
function clipped(name: string): string {
  const trimmed = name.trim();
  const characters = [...trimmed];
  return characters.length <= NAME_MAX ? trimmed : characters.slice(0, NAME_MAX).join("");
}

/**
 * Labels are matched by name alone (spec §9.1): `provider_links` has no `label` entity type, so
 * there is no link step to take first — the name is the only identity a provider label has in
 * here, and an over-long one is therefore **clipped** rather than refused.
 *
 * Refusing it made this function answer "no label", and `service.ts` then took the label off every
 * movement that carried it: a silent, hourly removal caused by a column width, with no link to
 * recover the tag from afterwards. Clipping keeps the tag on the movement and turns the case into
 * the ordinary provider rename it actually is; it is deterministic, so the next pass lands on the
 * same row. The price is that two provider labels sharing a 60-character prefix collapse into one
 * local label, which merges two tags instead of losing both — the smaller harm, and a visible one.
 *
 * A name that is blank once trimmed is still a refusal: there is nothing there to adopt.
 *
 * A name somebody deleted can therefore be created again by the next pass, and `service.ts`
 * resolves every movement's label names before it consults any marker, so the row can reappear in
 * Settings › Data. It reappears carrying nothing: `deleteLabel` marks the movements that had it,
 * so the merge cannot put the tag back on any of them (review B12).
 */
export async function adoptOrCreateLabel(ctx: Pick<Ctx, "userId">, name: string): Promise<Label> {
  const wanted = parsed(nameSchema, clipped(name));
  const existing = await labelByName(ctx, wanted);
  if (existing) return existing;
  const [row] = await getDb()
    .insert(labels)
    .values(userScoped(ctx).stamp({ name: wanted }))
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const raced = await labelByName(ctx, wanted);
  if (!raced) throw new TaxonomyError("duplicate");
  return raced;
}
