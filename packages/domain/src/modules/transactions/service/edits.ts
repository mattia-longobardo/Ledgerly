import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { unlinkEntities } from "../../../platform/integrations/service";
import {
  type MergeableField,
  PROVIDER_OWNED_FIELDS,
  type TransactionPatch,
  type UserEdit,
  planUserEdit,
} from "../rules";
import { retypeMovements } from "../macro";
import type { TransactionsProvider } from "../ports";
import { type Transaction, transactionsByIds } from "../queries";
import { transactions } from "../schema";
import {
  TRANSACTION_ENTITY,
  TransactionError,
  applyPatch,
  parseId,
  parseIds,
  requireOwnCategory,
  requireOwnLabels,
  requireTransaction,
} from "./guards";

/* Local edits */

/**
 * A local edit (spec §7.2). Only category, labels and note may be written: payee, amount and date
 * belong to the provider, and a patch that claims one of them is refused rather than quietly
 * dropped. `planUserEdit` decides what really changed and appends those fields to
 * `locally_edited`, which is what stops the next sync writing them again.
 */
export async function updateTransaction(
  ctx: Pick<Ctx, "userId">,
  id: string,
  patch: TransactionPatch,
): Promise<Transaction> {
  const transactionId = parseId(id);
  if (PROVIDER_OWNED_FIELDS.some((field) => patch[field] !== undefined)) {
    throw new TransactionError("provider_owned");
  }
  const current = await requireTransaction(ctx, transactionId);

  const edit: UserEdit = {};
  if (patch.categoryId !== undefined) edit.categoryId = patch.categoryId;
  if (patch.note !== undefined) edit.note = patch.note;
  if (patch.labelIds !== undefined) edit.labelIds = patch.labelIds.map(parseId);

  if (edit.categoryId !== undefined) await requireOwnCategory(ctx, edit.categoryId);
  // A giroconto has no category: it stops being one first (`chooseTransferSide`, "none").
  if (edit.categoryId != null && current.type === "transfer") throw new TransactionError("invalid");
  if (edit.labelIds !== undefined) await requireOwnLabels(ctx, edit.labelIds);

  const plan = planUserEdit(current, edit);
  if (!plan.changed) return current;

  await getDb().transaction(async (tx) => {
    await applyPatch(tx, ctx, transactionId, plan.patch, plan.locallyEdited);
    await retypeMovements(tx, ctx);
  });
  return requireTransaction(ctx, transactionId);
}

/**
 * Hands fields back to the provider (owner, 2026-09-24): called after a person's edit has been
 * written **to the provider** and accepted there, so the two sides agree again and the field goes on
 * following the provider — a marker left behind would freeze it at this value for good. The only place
 * a `locally_edited` marker is ever removed, and only for fields the provider now holds.
 */
export async function releaseLocalEdits(
  ctx: Pick<Ctx, "userId">,
  id: string,
  fields: readonly MergeableField[],
): Promise<void> {
  const current = await requireTransaction(ctx, parseId(id));
  const kept = current.locallyEdited.filter((field) => !fields.includes(field as MergeableField));
  if (kept.length === current.locallyEdited.length) return;
  await getDb()
    .update(transactions)
    .set({ locallyEdited: kept })
    .where(and(eq(transactions.id, current.id), userScoped(ctx).owns(transactions)));
  await retypeMovements(getDb(), ctx);
}

/**
 * The multiple action of §7.2, "set category", on as many rows as are selected. Each row keeps its
 * own `locally_edited`, so the category is claimed only on the rows it actually changes; the
 * answer is how many of them that was.
 */
export async function setCategory(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  categoryId: string | null,
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const chosen = categoryId === null ? null : parseId(categoryId);
  await requireOwnCategory(ctx, chosen);

  const rows = await transactionsByIds(ctx, wanted);
  const plans = [...rows.values()]
    // A giroconto in the selection keeps no category: it is left as it is.
    .filter((row) => chosen === null || row.type !== "transfer")
    .map((row) => ({ id: row.id, plan: planUserEdit(row, { categoryId: chosen }) }))
    .filter((one) => one.plan.changed);
  if (plans.length === 0) return 0;

  await getDb().transaction(async (tx) => {
    for (const { id, plan } of plans) await applyPatch(tx, ctx, id, plan.patch, plan.locallyEdited);
    await retypeMovements(tx, ctx);
  });
  return plans.length;
}

/* Visibility */

/** Hides one movement (spec §7.2, D10). Never a deletion: the row stays and can be restored. */
export async function hideTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const transactionId = parseId(id);
  await requireTransaction(ctx, transactionId);
  await hideTransactions(ctx, [transactionId]);
}

/** "Hide" over a selection; already hidden rows keep the moment they were hidden. */
export async function hideTransactions(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ hiddenAt: now })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNull(transactions.hiddenAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/**
 * "Restore" from the "Show hidden" filter. Only `hidden_at` is cleared: a movement the provider has
 * stopped returning is not something a person can un-disappear, and the next sync that sees it
 * again is what clears `removed_upstream_at`.
 */
export async function restoreTransactions(ctx: Pick<Ctx, "userId">, ids: readonly string[]): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ hiddenAt: null })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNotNull(transactions.hiddenAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/**
 * Deletes rows for good, and unpairs the other leg of any transfer they were half of. The rows'
 * labels go with them; a subscription charge or a fund deposit that pointed at one keeps its data
 * and loses the link (`on delete set null`).
 */
async function deleteRows(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
  condition: ReturnType<typeof isNotNull>,
) {
  if (ids.length === 0) return [];
  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(transactions)
      .where(and(inArray(transactions.id, [...ids]), condition, userScoped(ctx).owns(transactions)))
      .returning({ id: transactions.id, transferGroupId: transactions.transferGroupId });
    const groups = [...new Set(deleted.flatMap((row) => (row.transferGroupId ? [row.transferGroupId] : [])))];
    if (groups.length > 0) {
      await tx
        .update(transactions)
        .set({ transferGroupId: null })
        .where(and(inArray(transactions.transferGroupId, groups), userScoped(ctx).owns(transactions)));
    }
    return deleted.map((row) => row.id);
  });
}

/**
 * "Delete" on a hidden movement: it is removed for good. A provider's movement keeps its link,
 * which tells the next sync not to bring it back (`upsertFromProvider`); only hidden rows can be
 * deleted, so nothing leaves the totals without having been hidden first.
 */
export async function deleteHiddenTransactions(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<number> {
  const wanted = parseIds(ids);
  return (await deleteRows(ctx, wanted, isNotNull(transactions.hiddenAt))).length;
}

/**
 * The movements the provider no longer returns are deleted, with their links: if the provider
 * ever sends one again it comes back as new, since it exists again. The rows go first, so a
 * failure in between leaves a link with no row — a movement skipped — rather than a row the next
 * sync would import a second time.
 */
export async function purgeRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  source: Pick<TransactionsProvider, "provider">,
): Promise<number> {
  const gone = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(isNotNull(transactions.removedUpstreamAt), userScoped(ctx).owns(transactions)))
    .orderBy(asc(transactions.id));
  const deleted = await deleteRows(
    ctx,
    gone.map((row) => row.id),
    isNotNull(transactions.removedUpstreamAt),
  );
  if (deleted.length > 0) await unlinkEntities(ctx, source.provider, TRANSACTION_ENTITY, deleted);
  return deleted.length;
}

/**
 * Stamps the movements the provider stopped returning (spec §7.2): what `planUpstreamRemovals`
 * names on the pass that noticed. A row already stamped keeps its original moment, so calling this again
 * with the same ids writes nothing.
 */
export async function markRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  ids: string[],
  now: Date = new Date(),
): Promise<void> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return;
  await getDb()
    .update(transactions)
    .set({ removedUpstreamAt: now })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNull(transactions.removedUpstreamAt),
        userScoped(ctx).owns(transactions),
      ),
    );
}

/** The other half: the provider is sending these again, so they count once more. */
export async function clearRemovedUpstream(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<number> {
  const wanted = parseIds(ids);
  if (wanted.length === 0) return 0;
  const rows = await getDb()
    .update(transactions)
    .set({ removedUpstreamAt: null })
    .where(
      and(
        inArray(transactions.id, wanted),
        isNotNull(transactions.removedUpstreamAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}
