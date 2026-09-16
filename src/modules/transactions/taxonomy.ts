// modules/transactions/taxonomy.ts — the categories and labels of spec §7.2, kept apart from
// `service.ts` because they are their own use case: Settings › Data edits them by hand, while the
// Wallet sync adopts them by name (§9.1). Both entry points come through here.
import "server-only";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { EntityType } from "@/platform/integrations/rules";
import { IntegrationError, linkExternal, resolveExternal } from "@/platform/integrations/service";
import { CATEGORY_TYPES, markLocallyEdited, NAME_MAX } from "./rules";
import { categories, labels, transactionLabels, transactions } from "./schema";

export type Category = typeof categories.$inferSelect;
export type Label = typeof labels.$inferSelect;

/** A row of the Settings › Data tables: the record plus how many movements point at it. */
export interface CategoryWithUsage {
  category: Category;
  usage: number;
}

export interface LabelWithUsage {
  label: Label;
  usage: number;
}

/** Every failure a caller is expected to handle; anything else is a bug and keeps throwing. */
export type TaxonomyErrorCode = "not_found" | "duplicate" | "invalid";

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

const groupSchema = z.preprocess(blank, z.string().trim().max(NAME_MAX).nullable());

const categoryInputSchema = z.object({
  name: nameSchema,
  group: groupSchema,
  type: z.enum(CATEGORY_TYPES).default("expense"),
  color: colourSchema,
});

const labelInputSchema = z.object({ name: nameSchema, color: colourSchema });

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type LabelInput = z.input<typeof labelInputSchema>;

const idSchema = z.uuid();

/** The entity type `provider_links` files a category under (`platform/integrations/rules.ts`). */
const CATEGORY_ENTITY: EntityType = "category";

/**
 * A provider's own reference to one of its categories. Optional everywhere, because a person
 * creating a category by hand has none; when it is there, it is what §9.1 looks up first.
 */
export interface ExternalCategoryRef {
  provider: string;
  externalId: string;
}

/** A rejected input is a catalogued error, not a stack trace: only `TaxonomyError` leaves here. */
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaxonomyError("invalid");
  return result.data;
}

/** Postgres' unique-violation code, however deeply the driver error was wrapped. */
function isDuplicate(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if ((cause as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

function duplicateAware(error: unknown): never {
  if (isDuplicate(error)) throw new TaxonomyError("duplicate");
  throw error;
}

const CATEGORY_ORDER = [asc(categories.group), asc(categories.name), asc(categories.id)];
const LABEL_ORDER = [asc(labels.name), asc(labels.id)];

function categoryScope(ctx: Pick<Ctx, "userId">, includeArchived: boolean) {
  const owns = userScoped(ctx).owns(categories);
  return includeArchived ? owns : and(owns, isNull(categories.archivedAt));
}

/**
 * The categories a movement may be filed under: the archived ones are left out unless asked for,
 * so an archived name never comes back in a picker (Settings › Data asks for them to list them).
 */
export async function listCategories(
  ctx: Pick<Ctx, "userId">,
  options: { includeArchived?: boolean } = {},
): Promise<Category[]> {
  return getDb()
    .select()
    .from(categories)
    .where(categoryScope(ctx, options.includeArchived ?? false))
    .orderBy(...CATEGORY_ORDER);
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
  return rows.map((row) => ({ category: row.category, usage: Number(row.usage) }));
}

async function categoryById(ctx: Pick<Ctx, "userId">, id: string): Promise<Category | undefined> {
  const [row] = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), userScoped(ctx).owns(categories)));
  return row;
}

/**
 * The exact name §9.1 adopts on. Case-sensitive and archived-inclusive on purpose: the unique key
 * is `(user_id, name)`, so an archived namesake is the row that would collide with a new one.
 */
async function categoryByName(ctx: Pick<Ctx, "userId">, name: string): Promise<Category | undefined> {
  const [row] = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.name, name), userScoped(ctx).owns(categories)));
  return row;
}

export async function getCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<Category> {
  const row = await categoryById(ctx, parsed(idSchema, id));
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

export async function createCategory(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Category> {
  const values = parsed(categoryInputSchema, input);
  try {
    const [row] = await getDb().insert(categories).values(userScoped(ctx).stamp(values)).returning();
    return row;
  } catch (error) {
    return duplicateAware(error);
  }
}

/** Name, group, type and colour in one write: the edit dialog submits all four together. */
export async function updateCategory(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: unknown,
): Promise<Category> {
  const categoryId = parsed(idSchema, id);
  const values = parsed(categoryInputSchema, input);
  let row: Category | undefined;
  try {
    [row] = await getDb()
      .update(categories)
      .set(values)
      .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
      .returning();
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
    group: current.group,
    type: current.type,
    color: current.color,
  });
}

async function setArchived(ctx: Pick<Ctx, "userId">, id: string, archivedAt: Date | null): Promise<void> {
  const [row] = await getDb()
    .update(categories)
    .set({ archivedAt })
    .where(and(eq(categories.id, parsed(idSchema, id)), userScoped(ctx).owns(categories)))
    .returning({ id: categories.id });
  if (!row) throw new TaxonomyError("not_found");
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
 */
export async function adoptOrCreateCategory(
  ctx: Pick<Ctx, "userId">,
  name: string,
  external?: ExternalCategoryRef,
): Promise<Category> {
  if (external) {
    const linked = await resolveExternal(ctx, external.provider, CATEGORY_ENTITY, [external.externalId]);
    const entityId = linked.get(external.externalId);
    // A link whose category has since been deleted falls through to the name: `provider_links`
    // holds a plain uuid, not a foreign key (spec §4.3), so it can outlive its row.
    const category = entityId ? await categoryById(ctx, entityId) : undefined;
    if (category) return category;
  }

  // Only here does the name carry any weight: with no usable link there is nothing to adopt but
  // the name, so one the column cannot hold is a real refusal. `service.ts` leaves that movement
  // uncategorised rather than failing the pass, which is the right call for a first encounter —
  // it takes nothing away, because there was nothing there yet.
  const wanted = parsed(nameSchema, name);
  const category = (await categoryByName(ctx, wanted)) ?? (await insertAdoptedCategory(ctx, wanted));
  if (external) {
    try {
      await linkExternal(ctx, {
        provider: external.provider,
        entityType: CATEGORY_ENTITY,
        entityId: category.id,
        externalId: external.externalId,
      });
    } catch (error) {
      // Two of the provider's categories share this local name, so only the first of them owns
      // the link. The movement is still filed correctly, and the name lookup above keeps working
      // for the other one, so this is not worth failing a whole sync over.
      if (!(error instanceof IntegrationError) || error.code !== "link_conflict") throw error;
    }
  }
  return category;
}

/** The provider gives a name and nothing else, so the type falls back to the column default. */
async function insertAdoptedCategory(ctx: Pick<Ctx, "userId">, name: string): Promise<Category> {
  const [row] = await getDb()
    .insert(categories)
    .values(userScoped(ctx).stamp({ name }))
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Two syncs met on the same new name: the other one won, so take its row.
  const raced = await categoryByName(ctx, name);
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
      const key = markers.join(" ");
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
