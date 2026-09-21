// modules/transactions/taxonomy.ts — the categories and labels of spec §7.2, kept apart from
// `service.ts` because they are their own use case: Settings › Data edits them by hand, while the
// Wallet sync adopts them by name (§9.1). Both entry points come through here.
import "server-only";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { EntityType } from "@/platform/integrations/rules";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import {
  externalIdsOf,
  IntegrationError,
  linkExternal,
  resolveExternal,
  unlinkEntities,
} from "@/platform/integrations/service";
import {
  CATEGORY_TYPES,
  categoryColor,
  type CategoryType,
  markCategoryEdited,
  markLocallyEdited,
  NAME_MAX,
  treeOrder,
} from "./rules";
import { categories, labels, transactionLabels, transactions } from "./schema";

export type Category = typeof categories.$inferSelect;
export type Label = typeof labels.$inferSelect;

/** A category as the lists hand it out (F2.5): in tree order, with how deep a list indents it. */
export type TreeCategory = Category & { depth: 0 | 1 };

/** A row of the Settings › Data tables: the record plus how many movements point at it. */
export interface CategoryWithUsage {
  category: Category;
  usage: number;
  depth: 0 | 1;
}

export interface LabelWithUsage {
  label: Label;
  usage: number;
}

/**
 * Every failure a caller is expected to handle; anything else is a bug and keeps throwing.
 * `invalid_parent` (F2.5): a parent that is missing, archived, somebody else's, itself a
 * sub-category or the category itself — or a parent for a group that has sub-categories.
 */
export type TaxonomyErrorCode = "not_found" | "duplicate" | "invalid" | "invalid_parent";

export class TaxonomyError extends Error {
  constructor(readonly code: TaxonomyErrorCode) {
    super(code);
    this.name = "TaxonomyError";
  }
}

export { NAME_MAX };

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const nameSchema = z.string().trim().min(1).max(NAME_MAX);

/** Absent or blank means "no value" rather than a rejection: the forms submit empty inputs. */
const blank = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;

const colourSchema = z
  .preprocess(blank, z.string().trim().regex(HEX_COLOUR).nullable())
  .transform((value) => value?.toLowerCase() ?? null);

/** Absent or blank is "no parent": the category is a group of its own. */
const parentSchema = z.preprocess(blank, z.uuid().nullable());

/**
 * A whole category as the edit dialog submits it: an update replaces every field, so a parent left
 * out is "no parent", not "keep the current one" (`renameCategory` passes the current one on).
 */
const categoryInputSchema = z.object({
  name: nameSchema,
  parentId: parentSchema,
  type: z.enum(CATEGORY_TYPES).default("expense"),
  color: colourSchema,
});

const labelInputSchema = z.object({ name: nameSchema, color: colourSchema });

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type LabelInput = z.input<typeof labelInputSchema>;

const idSchema = z.uuid();

/** The entity type `provider_links` files a category under (`platform/integrations/rules.ts`). */
const CATEGORY_ENTITY: EntityType = "category";
/** And a provider's category group, which is a parent category here (F2.5). */
const GROUP_ENTITY: EntityType = "category_group";

/**
 * A provider's own reference to one of its categories. Optional everywhere, because a person
 * creating a category by hand has none; when it is there, it is what §9.1 looks up first.
 */
export interface ExternalCategoryRef {
  provider: string;
  externalId: string;
}

/** The provider's group of a category (F2.5): its name, and its own id when it sent one. */
export interface ProviderGroupRef {
  name: string;
  externalId: string | null;
}

/** A rejected input is a catalogued error, not a stack trace: only `TaxonomyError` leaves here. */
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaxonomyError("invalid");
  return result.data;
}

/** A Postgres error code, however deeply the driver error was wrapped. */
function hasCode(error: unknown, code: string): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if ((cause as { code?: unknown }).code === code) return true;
  }
  return false;
}

/**
 * The two refusals the database has the last word on. A unique violation is a taken name among
 * siblings; a foreign-key violation on `categories_parent_fk` is a third level that a concurrent
 * write made possible after the service had checked (F2.5).
 */
function duplicateAware(error: unknown): never {
  if (hasCode(error, "23505")) throw new TaxonomyError("duplicate");
  if (hasCode(error, "23503")) throw new TaxonomyError("invalid_parent");
  throw error;
}

/** Name order within each level; `treeOrder` then puts every sub-category under its group. */
const CATEGORY_ORDER = [asc(categories.name), asc(categories.id)];
const LABEL_ORDER = [asc(labels.name), asc(labels.id)];

function categoryScope(ctx: Pick<Ctx, "userId">, includeArchived: boolean) {
  const owns = userScoped(ctx).owns(categories);
  return includeArchived ? owns : and(owns, isNull(categories.archivedAt));
}

/**
 * The categories a movement may be filed under, each group followed by its sub-categories: the
 * archived ones are left out unless asked for, so an archived name never comes back in a picker
 * (Settings › Data asks for them to list them).
 */
export async function listCategories(
  ctx: Pick<Ctx, "userId">,
  options: { includeArchived?: boolean } = {},
): Promise<TreeCategory[]> {
  const rows = await getDb()
    .select()
    .from(categories)
    .where(categoryScope(ctx, options.includeArchived ?? false))
    .orderBy(...CATEGORY_ORDER);
  return treeOrder(rows);
}

/**
 * The colour a category is drawn in: its own when it is a group and somebody chose one, its
 * group's when it is a sub-category, and otherwise the one derived from the id (`categoryColor`).
 * Nothing is ever colourless, and a group and its children always agree.
 */
export function colorOfCategory(
  category: Pick<Category, "id" | "parentId" | "color">,
  groups: ReadonlyMap<string, Pick<Category, "id" | "parentId" | "color">>,
): string {
  const group = category.parentId === null ? null : groups.get(category.parentId);
  return categoryColor(category, group ? categoryColor(group) : null);
}

/**
 * The open categories of one type as a picker offers them (F3): tree order, a sub-category in its
 * group's colour (spec §7.2, F2.5).
 */
export async function categoryOptions(
  ctx: Pick<Ctx, "userId">,
  type: CategoryType,
): Promise<{ id: string; name: string; color: string; depth: 0 | 1 }[]> {
  const tree = (await listCategories(ctx)).filter((category) => category.type === type);
  const groups = new Map(tree.filter((one) => one.parentId === null).map((one) => [one.id, one]));
  return tree.map((category) => ({
    id: category.id,
    name: category.name,
    color: colorOfCategory(category, groups),
    depth: category.depth,
  }));
}

/* What a category is for, learned from what is filed under it (owner, 2026-09-20) */

/** A category with fewer than this many movements has not said anything yet. */
export const TYPE_EVIDENCE_MIN = 3;
/** How much of the evidence has to agree before the type is moved. */
export const TYPE_EVIDENCE_SHARE = 0.8;

/**
 * The verdict of the movements filed under one category: the type that carries enough of them, or
 * `null` when they are too few or too divided to say. Pure, so the threshold is testable on its
 * own.
 *
 * Not "all of them": Wallet lets a refund be filed under an income category, and one stray
 * movement out of seventy-eight is noise, not a disagreement. Four out of ten is a disagreement,
 * and then nothing is decided.
 */
export function typeFromMovements(counts: Readonly<Record<CategoryType, number>>): CategoryType | null {
  const total = CATEGORY_TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
  if (total < TYPE_EVIDENCE_MIN) return null;
  for (const type of CATEGORY_TYPES) {
    if ((counts[type] ?? 0) / total >= TYPE_EVIDENCE_SHARE) return type;
  }
  return null;
}

/**
 * Moves each category to the type its own movements say it is (spec §7.2).
 *
 * Wallet publishes no type on a category — the OpenAPI has none — so every category adopted from
 * it was born an expense, salary and interest included. The movements know better: they carry
 * their own type, and a category under which thirty-two income movements are filed is an income
 * category. Until this ran, the owner's "Interest, dividends" was an expense and so could not be
 * offered as the category an interest payout is filed under (owner, 2026-09-20).
 *
 * What it will not do:
 * - override a type set by hand here — that is what the `type` marker in `locally_edited` is for;
 * - decide on thin or divided evidence ({@link typeFromMovements});
 * - move a sub-category whose own movements disagree with its group: it keeps its own evidence.
 *
 * A group that moves takes with it the children that have no evidence of their own, because a
 * category in a group is of the group's type (F2.5) and those children have nothing else to say.
 */
export async function alignCategoryTypesToMovements(ctx: Pick<Ctx, "userId">): Promise<number> {
  const rows = await getDb()
    .select({
      id: categories.id,
      parentId: categories.parentId,
      type: categories.type,
      locallyEdited: categories.locallyEdited,
    })
    .from(categories)
    .where(userScoped(ctx).owns(categories));
  if (rows.length === 0) return 0;

  const tally = await getDb()
    .select({
      categoryId: transactions.categoryId,
      type: transactions.type,
      count: count(),
    })
    .from(transactions)
    .where(userScoped(ctx).owns(transactions))
    .groupBy(transactions.categoryId, transactions.type);

  const evidence = new Map<string, Record<CategoryType, number>>();
  for (const row of tally) {
    if (row.categoryId === null) continue;
    const own = evidence.get(row.categoryId) ?? { income: 0, expense: 0, transfer: 0 };
    // A movement's type and a category's type share their three names (spec §7.2).
    if (row.type === "income" || row.type === "expense" || row.type === "transfer") {
      own[row.type] += Number(row.count);
    }
    evidence.set(row.categoryId, own);
  }

  const settled = (id: string, type: CategoryType) =>
    rows.find((row) => row.id === id)?.locallyEdited.includes("type") === true ||
    rows.find((row) => row.id === id)?.type === type;

  const moves = new Map<string, CategoryType>();
  for (const row of rows) {
    const verdict = typeFromMovements(evidence.get(row.id) ?? { income: 0, expense: 0, transfer: 0 });
    if (verdict === null || settled(row.id, verdict)) continue;
    moves.set(row.id, verdict);
  }
  // The silent children of a group that moved.
  for (const [id, type] of [...moves]) {
    if (rows.find((row) => row.id === id)?.parentId !== null) continue;
    for (const child of rows) {
      if (child.parentId !== id || evidence.has(child.id) || settled(child.id, type)) continue;
      moves.set(child.id, type);
    }
  }
  if (moves.size === 0) return 0;

  await getDb().transaction(async (tx) => {
    for (const [id, type] of moves) {
      await tx
        .update(categories)
        .set({ type })
        .where(and(eq(categories.id, id), userScoped(ctx).owns(categories)));
    }
  });
  return moves.size;
}

/**
 * The Settings › Data table. The join carries the user's scope too: a movement of another user
 * could only reach this category through a forged reference, and it would not be counted here.
 */
export async function listCategoriesWithUsage(
  ctx: Pick<Ctx, "userId">,
  options: { includeArchived?: boolean } = {},
): Promise<CategoryWithUsage[]> {
  const rows = await getDb()
    .select({ category: categories, usage: count(transactions.id) })
    .from(categories)
    .leftJoin(
      transactions,
      and(eq(transactions.categoryId, categories.id), userScoped(ctx).owns(transactions)),
    )
    .where(categoryScope(ctx, options.includeArchived ?? false))
    .groupBy(categories.id)
    .orderBy(...CATEGORY_ORDER);
  const ordered = treeOrder(
    rows.map((row) => ({ id: row.category.id, parentId: row.category.parentId, row })),
  );
  return ordered.map(({ row, depth }) => ({ category: row.category, usage: Number(row.usage), depth }));
}

async function categoryById(ctx: Pick<Ctx, "userId">, id: string): Promise<Category | undefined> {
  const [row] = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), userScoped(ctx).owns(categories)));
  return row;
}

/**
 * The exact name §9.1 adopts on, among the siblings under `parentId` (`null`: among the groups).
 * Case-sensitive and archived-inclusive on purpose: the unique key is `(user_id, parent_id, name)`,
 * so an archived namesake is the row that would collide with a new one.
 */
async function categoryByName(
  ctx: Pick<Ctx, "userId">,
  name: string,
  parentId: string | null,
): Promise<Category | undefined> {
  const [row] = await getDb()
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.name, name),
        parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        userScoped(ctx).owns(categories),
      ),
    );
  return row;
}

async function hasChildren(ctx: Pick<Ctx, "userId">, id: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, id), userScoped(ctx).owns(categories)))
    .limit(1);
  return row !== undefined;
}

/**
 * The parent a category asks for, checked (F2.5): it has to be this user's, active, a group, and
 * not the category itself. `null` asks for no parent at all.
 */
async function parentFor(
  ctx: Pick<Ctx, "userId">,
  parentId: string | null,
  selfId: string | null,
): Promise<Category | null> {
  if (parentId === null) return null;
  const parent = await categoryById(ctx, parentId);
  if (!parent || parent.id === selfId || parent.parentId !== null || parent.archivedAt !== null) {
    throw new TaxonomyError("invalid_parent");
  }
  return parent;
}

export async function getCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<Category> {
  const row = await categoryById(ctx, parsed(idSchema, id));
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

/** A sub-category always has its group's type (spec §7.2, F2.5), whatever the input said. */
export async function createCategory(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Category> {
  const values = parsed(categoryInputSchema, input);
  const parent = await parentFor(ctx, values.parentId, null);
  try {
    const [row] = await getDb()
      .insert(categories)
      .values(userScoped(ctx).stamp({ ...values, type: parent?.type ?? values.type }))
      .returning();
    return row;
  } catch (error) {
    return duplicateAware(error);
  }
}

/**
 * Name, parent, type and colour in one write: the edit dialog submits all four together. Moving a
 * category under a group gives it the group's type; changing a group's type takes its
 * sub-categories along, in the same transaction, so a child and its parent never disagree.
 */
export async function updateCategory(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: unknown,
): Promise<Category> {
  const categoryId = parsed(idSchema, id);
  const values = parsed(categoryInputSchema, input);
  const current = await categoryById(ctx, categoryId);
  if (!current) throw new TaxonomyError("not_found");
  const parent = await parentFor(ctx, values.parentId, categoryId);
  // A group with sub-categories cannot go inside another one: that would be a third level. The
  // foreign key refuses it too; asking first gives the person a reason rather than an error.
  if (parent && (await hasChildren(ctx, categoryId))) throw new TaxonomyError("invalid_parent");
  const type = parent?.type ?? values.type;
  // Choosing the group by hand — into one, out of one, or into another — is a local edit the sync
  // must not undo (spec §7.2); a rename that leaves the group alone is not that choice.
  const parentSetLocally = current.parentSetLocally || current.parentId !== values.parentId;
  // A name or a type changed *here* is marked the way §7.2 marks a movement's fields. For the name
  // that is not only "never overwrite it": the next Wallet pass writes it to Wallet and clears the
  // marker (`platform/integrations/wallet/categories.ts`), which is what makes the two-way sync
  // settle instead of swinging between the two names. The baseline is deliberately left alone:
  // it still holds the name Wallet last published, which is how the pass tells a rename that only
  // happened here from one that happened on both sides.
  const edited = [
    ...(values.name === current.name ? [] : (["name"] as const)),
    ...(type === current.type ? [] : (["type"] as const)),
  ];
  const locallyEdited = markCategoryEdited(current.locallyEdited, edited);
  let row: Category | undefined;
  try {
    row = await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(categories)
        .set({ ...values, type, parentSetLocally, locallyEdited })
        .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
        .returning();
      if (updated?.parentId === null) {
        await tx
          .update(categories)
          // The children's type follows their group by rule (F2.5), so it is not a choice made on
          // each of them: only the group carries the `type` marker.
          .set({ type })
          .where(
            and(
              eq(categories.parentId, updated.id),
              ne(categories.type, type),
              userScoped(ctx).owns(categories),
            ),
          );
      }
      return updated;
    });
  } catch (error) {
    return duplicateAware(error);
  }
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

export async function renameCategory(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<Category> {
  const current = await getCategory(ctx, id);
  return updateCategory(ctx, current.id, {
    name,
    parentId: current.parentId,
    type: current.type,
    color: current.color,
  });
}

/**
 * Archiving a group archives its active sub-categories with the same moment (F2.5): a group put
 * away should not leave its children offered in every picker. Restoring brings the group alone
 * back, because which of its children are still wanted is not something this can know.
 */
async function setArchived(ctx: Pick<Ctx, "userId">, id: string, archivedAt: Date | null): Promise<void> {
  const categoryId = parsed(idSchema, id);
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ archivedAt })
      .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
      .returning({ id: categories.id, parentId: categories.parentId });
    if (!row) throw new TaxonomyError("not_found");
    if (archivedAt !== null && row.parentId === null) {
      await tx
        .update(categories)
        .set({ archivedAt })
        .where(
          and(
            eq(categories.parentId, row.id),
            isNull(categories.archivedAt),
            userScoped(ctx).owns(categories),
          ),
        );
    }
  });
}

/**
 * A category is archived, never deleted (spec §7.2): the movements filed under it keep their
 * history, and the name stays taken so the next sync adopts this row instead of making a twin.
 */
export async function archiveCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await setArchived(ctx, id, new Date());
}

export async function restoreCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await setArchived(ctx, id, null);
}

/** What a deletion took with it, so the screen can say it rather than guess. */
export interface CategoryDeletion {
  /** The category asked for, and its sub-categories: all of them go together. */
  removed: { id: string; name: string; parentId: string | null }[];
  /** The provider's own ids for those categories, for whoever propagates the deletion. */
  externalIds: string[];
  /** Movements that were filed under one of them and are now uncategorised. */
  uncategorised: number;
}

/**
 * Deletes a category for good, with its sub-categories (owner, 2026-09-21).
 *
 * This is deliberately **not** what spec §7.2 wrote — a category was archived and never deleted —
 * and the owner asked for the other thing, twice and in as many words. What archiving bought was
 * that history kept its labels; what it cost was a list that only ever grew. So both exist: the
 * screen offers archiving as the reversible move and this as the irreversible one, and says which
 * is which.
 *
 * What goes with it is decided by the foreign keys that were already there: a movement and a
 * subscription lose their category (`set null`), a budget on it is deleted (`cascade`), an interest
 * rule stops publishing under it (`set null`). The sub-categories go first because the self key
 * carries a generated column and so can have no `ON DELETE` action of its own.
 *
 * The provider's ids are read **before** the rows go and handed back rather than used: the network
 * call that would spend them has no business inside this transaction (spec §4.3), and the caller
 * is the one that knows whether the person asked for it.
 */
export async function deleteCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<CategoryDeletion> {
  const categoryId = parsed(idSchema, id);
  const category = await categoryById(ctx, categoryId);
  if (!category) throw new TaxonomyError("not_found");
  const children = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), userScoped(ctx).owns(categories)))
    .orderBy(...CATEGORY_ORDER);
  const doomed = [category, ...children];
  const ids = doomed.map((one) => one.id);

  const [links, groupLinks, [counted]] = await Promise.all([
    externalIdsOf(ctx, WALLET_PROVIDER, CATEGORY_ENTITY, ids),
    externalIdsOf(ctx, WALLET_PROVIDER, GROUP_ENTITY, ids),
    getDb()
      .select({ n: count() })
      .from(transactions)
      .where(and(inArray(transactions.categoryId, ids), userScoped(ctx).owns(transactions))),
  ]);

  await getDb().transaction(async (tx) => {
    if (children.length > 0) {
      await tx.delete(categories).where(
        and(
          inArray(
            categories.id,
            children.map((one) => one.id),
          ),
          userScoped(ctx).owns(categories),
        ),
      );
    }
    await tx.delete(categories).where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
  });

  // The links outlive their rows — `provider_links` points at an id, with no key to cascade — so
  // they are cleared here. A link left behind would make the next pass adopt a category that is
  // gone and file movements under nothing.
  for (const entity of [CATEGORY_ENTITY, GROUP_ENTITY]) {
    await unlinkEntities(ctx, WALLET_PROVIDER, entity, ids);
  }

  return {
    removed: doomed.map((one) => ({ id: one.id, name: one.name, parentId: one.parentId })),
    externalIds: [...new Set([...links.values(), ...groupLinks.values()])],
    uncategorised: Number(counted?.n ?? 0),
  };
}

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

export async function listLabels(ctx: Pick<Ctx, "userId">): Promise<Label[]> {
  return getDb()
    .select()
    .from(labels)
    .where(userScoped(ctx).owns(labels))
    .orderBy(...LABEL_ORDER);
}

export async function listLabelsWithUsage(ctx: Pick<Ctx, "userId">): Promise<LabelWithUsage[]> {
  const rows = await getDb()
    .select({ label: labels, usage: count(transactionLabels.transactionId) })
    .from(labels)
    .leftJoin(
      transactionLabels,
      and(eq(transactionLabels.labelId, labels.id), userScoped(ctx).owns(transactionLabels)),
    )
    .where(userScoped(ctx).owns(labels))
    .groupBy(labels.id)
    .orderBy(...LABEL_ORDER);
  return rows.map((row) => ({ label: row.label, usage: Number(row.usage) }));
}

async function labelByName(ctx: Pick<Ctx, "userId">, name: string): Promise<Label | undefined> {
  const [row] = await getDb()
    .select()
    .from(labels)
    .where(and(eq(labels.name, name), userScoped(ctx).owns(labels)));
  return row;
}

export async function getLabel(ctx: Pick<Ctx, "userId">, id: string): Promise<Label> {
  const [row] = await getDb()
    .select()
    .from(labels)
    .where(and(eq(labels.id, parsed(idSchema, id)), userScoped(ctx).owns(labels)));
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

export async function createLabel(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Label> {
  const values = parsed(labelInputSchema, input);
  try {
    const [row] = await getDb().insert(labels).values(userScoped(ctx).stamp(values)).returning();
    return row;
  } catch (error) {
    return duplicateAware(error);
  }
}

export async function updateLabel(ctx: Pick<Ctx, "userId">, id: string, input: unknown): Promise<Label> {
  const labelId = parsed(idSchema, id);
  const values = parsed(labelInputSchema, input);
  let row: Label | undefined;
  try {
    [row] = await getDb()
      .update(labels)
      .set(values)
      .where(and(eq(labels.id, labelId), userScoped(ctx).owns(labels)))
      .returning();
  } catch (error) {
    return duplicateAware(error);
  }
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

export async function renameLabel(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<Label> {
  const current = await getLabel(ctx, id);
  return updateLabel(ctx, current.id, { name, color: current.color });
}

/**
 * A label really is deleted: the row goes, `transaction_labels` cascades, and the movements stop
 * carrying it. The count shown in the confirmation is `listLabelsWithUsage`.
 *
 * **Deleting it is a local edit of the movements that carried it** (review B12). Taking a tag off
 * a movement is exactly what `updateTransaction` does through `planUserEdit`, and §7.2 is one
 * rule for both: every field a person changes in here enters `locally_edited` and the sync never
 * writes it again. Without the marker the deletion did not survive the hour — labels have no
 * `provider_links` entry, so §9.1 matches them by name alone, and the next pass recreated this
 * name through `adoptOrCreateLabel` and the merge re-attached it with a **new** id: usage counts
 * restarted, the movements outside the re-read window were left without it, and the person had to
 * delete it again, and again. Marking the movements settles the clash between §7.2 and §9.1 where
 * §7.2 says it is settled — on the movement, where the person expressed a choice — and leaves
 * adoption by name intact for movements they never touched.
 *
 * `markLocallyEdited` comes from `rules.ts` so the marker is written with the one semantics the
 * column has (a sorted set, never losing a marker) instead of a second version of it (§4.3). The
 * marker and the delete share one transaction: a half-applied deletion would leave movements
 * refusing a label they still carry.
 */
export async function deleteLabel(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const labelId = parsed(idSchema, id);
  await getDb().transaction(async (tx) => {
    const carrying = await tx
      .select({ id: transactions.id, locallyEdited: transactions.locallyEdited })
      .from(transactionLabels)
      .innerJoin(transactions, eq(transactions.id, transactionLabels.transactionId))
      .where(
        and(
          eq(transactionLabels.labelId, labelId),
          userScoped(ctx).owns(transactionLabels),
          userScoped(ctx).owns(transactions),
        ),
      );

    // One update per distinct resulting marker set, not one per movement: `locally_edited` holds
    // at most the three fields of `EDITABLE_FIELDS`, so a label on a thousand movements is still
    // a handful of statements.
    const byMarkers = new Map<string, { markers: string[]; ids: string[] }>();
    for (const row of carrying) {
      const markers = markLocallyEdited(row.locallyEdited, ["labels"]);
      const key = markers.join("\u0000");
      const group = byMarkers.get(key);
      if (group) group.ids.push(row.id);
      else byMarkers.set(key, { markers, ids: [row.id] });
    }
    for (const { markers, ids } of byMarkers.values()) {
      await tx
        .update(transactions)
        .set({ locallyEdited: markers })
        .where(and(inArray(transactions.id, ids), userScoped(ctx).owns(transactions)));
    }

    const [row] = await tx
      .delete(labels)
      .where(and(eq(labels.id, labelId), userScoped(ctx).owns(labels)))
      .returning({ id: labels.id });
    if (!row) throw new TaxonomyError("not_found");
  });
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
