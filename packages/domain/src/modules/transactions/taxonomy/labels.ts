import { and, count, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { markLocallyEdited } from "../rules";
import { labels, transactionLabels, transactions } from "../schema";
import {
  LABEL_ORDER,
  TaxonomyError,
  duplicateAware,
  idSchema,
  labelInputSchema,
  parsed,
  type Label,
  type LabelWithUsage,
} from "./category-reads";

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

export async function labelByName(ctx: Pick<Ctx, "userId">, name: string): Promise<Label | undefined> {
  const [row] = await getDb()
    .select()
    .from(labels)
    .where(and(eq(labels.name, name), userScoped(ctx).owns(labels)));
  return row;
}

async function getLabel(ctx: Pick<Ctx, "userId">, id: string): Promise<Label> {
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
