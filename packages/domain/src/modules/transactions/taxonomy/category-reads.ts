import { and, asc, count, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { EntityType } from "../../../platform/integrations/rules";
import { CATEGORY_TYPES, categoryColor, type CategoryType, NAME_MAX, treeOrder } from "../rules";
import { retypeMovements } from "../macro";
import { categories, labels, transactions } from "../schema";
import { HEX_COLOR } from "../../../shared/inputs";

export type Category = typeof categories.$inferSelect;
export type Label = typeof labels.$inferSelect;

/** A category as the lists hand it out (F2.5): in tree order, with how deep a list indents it. */
export type TreeCategory = Category & { depth: 0 | 1 };

/** A row of the Settings › Data tables: the record plus how many movements point at it. */
interface CategoryWithUsage {
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
type TaxonomyErrorCode = "not_found" | "duplicate" | "invalid" | "invalid_parent";

export class TaxonomyError extends Error {
  constructor(readonly code: TaxonomyErrorCode) {
    super(code);
    this.name = "TaxonomyError";
  }
}

export const nameSchema = z.string().trim().min(1).max(NAME_MAX);

/** Absent or blank means "no value" rather than a rejection: the forms submit empty inputs. */
const blank = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;

const colourSchema = z
  .preprocess(blank, z.string().trim().regex(HEX_COLOR).nullable())
  .transform((value) => value?.toLowerCase() ?? null);

/** Absent or blank is "no parent": the category is a group of its own. */
export const parentSchema = z.preprocess(blank, z.uuid().nullable());

/**
 * A whole category as the edit dialog submits it: an update replaces every field, so a parent left
 * out is "no parent", not "keep the current one" (`renameCategory` passes the current one on).
 */
export const categoryInputSchema = z.object({
  name: nameSchema,
  parentId: parentSchema,
  type: z.enum(CATEGORY_TYPES).default("expense"),
  color: colourSchema,
});

export const labelInputSchema = z.object({ name: nameSchema, color: colourSchema });

export const idSchema = z.uuid();

/** The entity type `provider_links` files a category under (`platform/integrations/rules.ts`). */
export const CATEGORY_ENTITY: EntityType = "category";
/** And a provider's category group, which is a parent category here (F2.5). */
export const GROUP_ENTITY: EntityType = "category_group";

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
export function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaxonomyError("invalid");
  return result.data;
}

/** A Postgres error code, however deeply the driver error was wrapped. */
export function hasCode(error: unknown, code: string): boolean {
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
export function duplicateAware(error: unknown): never {
  if (hasCode(error, "23505")) throw new TaxonomyError("duplicate");
  if (hasCode(error, "23503")) throw new TaxonomyError("invalid_parent");
  throw error;
}

/** Name order within each level; `treeOrder` then puts every sub-category under its group. */
export const CATEGORY_ORDER = [asc(categories.name), asc(categories.id)];
export const LABEL_ORDER = [asc(labels.name), asc(labels.id)];

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
const TYPE_EVIDENCE_MIN = 3;
/** How much of the evidence has to agree before the type is moved. */
const TYPE_EVIDENCE_SHARE = 0.8;

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
 * Moves each category created since `createdSince` to the type its own movements say it is
 * (spec §7.2). Since N3.3 the macro is the person's choice (categories-and-rules.md CR8): only a
 * category a source brought in this pass is aligned, once, at its creation.
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
export async function alignCategoryTypesToMovements(
  ctx: Pick<Ctx, "userId">,
  createdSince: Date,
): Promise<number> {
  const rows = await getDb()
    .select({
      id: categories.id,
      parentId: categories.parentId,
      type: categories.type,
      locallyEdited: categories.locallyEdited,
    })
    .from(categories)
    .where(and(userScoped(ctx).owns(categories), gte(categories.createdAt, createdSince)));
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
    await retypeMovements(tx, ctx);
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

export async function categoryById(ctx: Pick<Ctx, "userId">, id: string): Promise<Category | undefined> {
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
export async function categoryByName(
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

export async function hasChildren(ctx: Pick<Ctx, "userId">, id: string): Promise<boolean> {
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
export async function parentFor(
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
