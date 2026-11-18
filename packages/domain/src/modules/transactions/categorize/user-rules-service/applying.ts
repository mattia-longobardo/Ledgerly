import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import { retypeMovements } from "../../macro";
import {
  categories,
  categoryRules,
  categoryRuleUndos,
  type RuleUndoRow,
  transactionLabels,
  transactions,
} from "../../schema";
import { TransactionError } from "../../service";
import { memoryKey } from "../text";
import { addLabels, existingLabels, ruleColumns } from "./new-movements";
import { sortMovements } from "./previews";
import { RULE_COLUMNS, UNDO_DAYS, live } from "./rules";
import type { Ctx } from "../../../../platform/context";

type Who = Pick<Ctx, "userId">;

/**
 * "Apply to existing transactions" (§4.6): the rule's category, labels and note on every movement
 * it may write on, all or nothing, with one row for "Undo". Answers how many changed.
 */
export async function applyRule(ctx: Who, id: string): Promise<{ count: number; undoId: string | null }> {
  return getDb().transaction(async (tx) => {
    const [rule] = await tx
      .select(RULE_COLUMNS)
      .from(categoryRules)
      .innerJoin(categories, and(eq(categories.id, categoryRules.categoryId), isNull(categories.archivedAt)))
      .where(and(eq(categoryRules.id, id), live(ctx)));
    if (!rule) throw new TransactionError("not_found");
    const { changes } = await sortMovements(tx, ctx, rule, true);
    if (changes.length === 0) return { count: 0, undoId: null };
    const known = await existingLabels(ctx, [rule]);
    const before = new Map(
      (
        await tx
          .select({
            id: transactions.id,
            categoryConfidence: transactions.categoryConfidence,
            categoryModelVersion: transactions.categoryModelVersion,
            suggestedCategoryId: transactions.suggestedCategoryId,
            categoryReason: transactions.categoryReason,
            categoryReasonParams: transactions.categoryReasonParams,
            categoryKey: transactions.categoryKey,
          })
          .from(transactions)
          .where(
            and(
              userScoped(ctx).owns(transactions),
              inArray(
                transactions.id,
                changes.map((row) => row.id),
              ),
            ),
          )
      ).map((row) => [row.id, row]),
    );
    const undo: RuleUndoRow[] = [];
    for (const row of changes) {
      const wroteNote = row.note === null && rule.note !== null;
      await tx.update(transactions);
      const old = before.get(row.id)!;
      await tx
        .update(transactions)
        .set({
          ...ruleColumns(rule),
          // "Similar movements" and the groups of "To review" find a movement by its key.
          categoryKey: old.categoryKey ?? memoryKey(row),
          ...(wroteNote ? { note: rule.note } : {}),
        })
        .where(and(eq(transactions.id, row.id), userScoped(ctx).owns(transactions)));
      undo.push({
        appliedRuleId: rule.id,
        categoryKey: old.categoryKey,
        id: row.id,
        categoryId: row.categoryId,
        categoryOrigin: row.categoryOrigin,
        categoryRuleId: row.categoryRuleId,
        categoryConfidence: old.categoryConfidence,
        categoryModelVersion: old.categoryModelVersion,
        suggestedCategoryId: old.suggestedCategoryId,
        categoryReason: old.categoryReason,
        categoryReasonParams: old.categoryReasonParams,
        locallyEdited: row.locallyEdited,
        type: row.type,
        note: row.note,
        wroteNote,
        appliedNote: wroteNote ? rule.note : null,
        addedLabelIds: await addLabels(
          tx,
          ctx,
          row.id,
          rule.labelIds.filter((label) => known.has(label)),
        ),
      });
    }
    await tx
      .delete(categoryRuleUndos)
      .where(
        and(
          userScoped(ctx).owns(categoryRuleUndos),
          lt(categoryRuleUndos.createdAt, new Date(Date.now() - UNDO_DAYS * 86_400_000)),
        ),
      );
    const [saved] = await tx
      .insert(categoryRuleUndos)
      .values(userScoped(ctx).stamp({ rows: undo }))
      .returning({ id: categoryRuleUndos.id });
    await retypeMovements(tx, ctx);
    return { count: changes.length, undoId: saved.id };
  });
}

/**
 * "Undo" of "Apply": category, origin, reason, type, labels and note as they were — on the
 * movements that still carry what "Apply" wrote. A choice the person made since stays. Answers how
 * many movements went back.
 */
export async function undoRuleApply(ctx: Who, undoId: string): Promise<number> {
  return getDb().transaction(async (tx) => {
    const [undo] = await tx
      .delete(categoryRuleUndos)
      .where(and(eq(categoryRuleUndos.id, undoId), userScoped(ctx).owns(categoryRuleUndos)))
      .returning({ rows: categoryRuleUndos.rows });
    if (!undo) throw new TransactionError("not_found");
    let restored = 0;
    for (const {
      id,
      wroteNote,
      note,
      addedLabelIds,
      appliedRuleId,
      appliedNote,
      categoryOrigin,
      ...columns
    } of undo.rows) {
      if (wroteNote) {
        await tx
          .update(transactions)
          .set({ note })
          .where(
            and(
              eq(transactions.id, id),
              userScoped(ctx).owns(transactions),
              eq(transactions.note, appliedNote ?? ""),
            ),
          );
      }
      const back = await tx
        .update(transactions)
        .set({
          ...columns,
          categoryOrigin: categoryOrigin as (typeof transactions.$inferInsert)["categoryOrigin"],
        })
        .where(
          and(
            eq(transactions.id, id),
            userScoped(ctx).owns(transactions),
            eq(transactions.categoryOrigin, "rule"),
            eq(transactions.categoryRuleId, appliedRuleId),
          ),
        )
        .returning({ id: transactions.id });
      if (back.length === 0) continue;
      restored += 1;
      if (addedLabelIds.length > 0) {
        await tx
          .delete(transactionLabels)
          .where(
            and(
              eq(transactionLabels.transactionId, id),
              userScoped(ctx).owns(transactionLabels),
              inArray(transactionLabels.labelId, addedLabelIds),
            ),
          );
      }
    }
    await retypeMovements(tx, ctx);
    return restored;
  });
}
