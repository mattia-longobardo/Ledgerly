import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../../platform/context";
import { addDays, type CivilDate, civilDateIn, startOfDayIn } from "../../../../platform/dates";
import { getDb } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import { categories, type CategoryUndoRow, categoryUndos, transactions } from "../../schema";
import { retypeMovements } from "../../macro";
import { chosenBy, TransactionError } from "../../service";
import { type Review, reviewGroups, type ReviewRow } from "../review-rules";
import { shownText } from "../text";
import { AUTOMATIC_CATEGORY_ORIGINS } from "../../rules";

type Who = Pick<Ctx, "userId">;

const idsSchema = z.array(z.uuid()).min(1).max(5000);
/** How long the state before an action is kept for "Undo". */
const UNDO_DAYS = 7;

/** A movement waits for a category when it has none and the cascade has read it. */
const WAITING = and(
  isNull(transactions.categoryId),
  isNotNull(transactions.categoryKey),
  inArray(transactions.type, ["income", "expense"]),
  isNull(transactions.hiddenAt),
  isNull(transactions.removedUpstreamAt),
);

interface ReviewFilters {
  from?: CivilDate;
  to?: CivilDate;
  accountIds?: readonly string[];
}

function inRange(ctx: Pick<Ctx, "timeZone">, filters: ReviewFilters) {
  return and(
    filters.from === undefined
      ? undefined
      : gte(transactions.occurredAt, startOfDayIn(filters.from, ctx.timeZone)),
    filters.to === undefined
      ? undefined
      : lt(transactions.occurredAt, startOfDayIn(addDays(filters.to, 1), ctx.timeZone)),
    filters.accountIds === undefined || filters.accountIds.length === 0
      ? undefined
      : inArray(transactions.accountId, [...filters.accountIds]),
  );
}

/** The movements that wait for a category in a range, grouped as "To review" shows them. */
export async function reviewOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: ReviewFilters = {},
): Promise<Review> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      key: transactions.categoryKey,
      payee: transactions.payee,
      counterparty: transactions.counterpartyName,
      rawText: transactions.rawText,
      note: transactions.note,
      occurredAt: transactions.occurredAt,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      suggestedCategoryId: transactions.suggestedCategoryId,
      reason: transactions.categoryReason,
      params: transactions.categoryReasonParams,
    })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), WAITING, inRange(ctx, filters)))
    .orderBy(desc(transactions.occurredAt), transactions.id);
  return reviewGroups(
    rows.map((row): ReviewRow => ({
      id: row.id,
      key: row.key ?? "",
      text: shownText(row),
      on: civilDateIn(row.occurredAt, ctx.timeZone),
      accountId: row.accountId,
      amountCents: row.amountCents,
      suggestedCategoryId: row.suggestedCategoryId,
      // A suggestion's reason only: what is left of a replaced category is not one.
      reason: row.suggestedCategoryId === null ? null : row.reason,
      params: row.suggestedCategoryId === null ? null : row.params,
    })),
  );
}

/** How the movements of some accounts stand: with a category, with a suggestion, with neither. */
export async function categoryCounts(
  ctx: Who,
  accountIds: readonly string[],
): Promise<{ categorised: number; suggested: number; open: number }> {
  if (accountIds.length === 0) return { categorised: 0, suggested: 0, open: 0 };
  const [row] = await getDb()
    .select({
      categorised: sql<number>`count(*) filter (where ${transactions.categoryId} is not null)::int`,
      suggested: sql<number>`count(*) filter (where ${transactions.categoryId} is null and ${transactions.suggestedCategoryId} is not null)::int`,
      open: sql<number>`count(*) filter (where ${transactions.categoryId} is null and ${transactions.suggestedCategoryId} is null)::int`,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        inArray(transactions.type, ["income", "expense"]),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
      ),
    );
  return row ?? { categorised: 0, suggested: 0, open: 0 };
}

/* Actions on several movements */

type Change = { kind: "confirm" } | { kind: "set"; categoryId: string | null };

const UNDO_COLUMNS = {
  id: transactions.id,
  categoryId: transactions.categoryId,
  categoryOrigin: transactions.categoryOrigin,
  categoryConfidence: transactions.categoryConfidence,
  categoryModelVersion: transactions.categoryModelVersion,
  suggestedCategoryId: transactions.suggestedCategoryId,
  categoryReason: transactions.categoryReason,
  categoryReasonParams: transactions.categoryReasonParams,
  categoryRuleId: transactions.categoryRuleId,
  locallyEdited: transactions.locallyEdited,
};

export async function requireCategory(ctx: Who, categoryId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.id, categoryId), userScoped(ctx).owns(categories), isNull(categories.archivedAt)),
    );
  if (!row) throw new TransactionError("invalid_reference");
}

/**
 * Confirms or sets the category of several movements, all of them or none, and keeps what they
 * were for "Undo". Only a movement the cascade reads is touched: one with a category a person or
 * a source chose is left as it is, so the count is the number really changed.
 *
 * `confirm` makes the person's own an automatic category or a suggestion; `set` gives the category
 * chosen. Either way the movement becomes a confirmed label, which the classifier learns from.
 */
export async function changeCategories(
  ctx: Who,
  ids: readonly string[],
  change: Change,
): Promise<{ count: number; undoId: string | null }> {
  const wanted = [...new Set(idsSchema.parse(ids))];
  if (change.kind === "set" && change.categoryId !== null) await requireCategory(ctx, change.categoryId);
  return getDb().transaction(async (tx) => {
    const before: CategoryUndoRow[] = await tx
      .select(UNDO_COLUMNS)
      .from(transactions)
      .where(
        and(
          userScoped(ctx).owns(transactions),
          inArray(transactions.id, wanted),
          isNotNull(transactions.categoryKey),
          // Not a choice a person or a source already made.
          or(
            isNull(transactions.categoryOrigin),
            inArray(transactions.categoryOrigin, [...AUTOMATIC_CATEGORY_ORIGINS]),
          ),
          change.kind === "confirm"
            ? or(isNotNull(transactions.categoryId), isNotNull(transactions.suggestedCategoryId))
            : undefined,
        ),
      )
      .orderBy(transactions.id)
      .for("update");
    if (before.length === 0) return { count: 0, undoId: null };
    for (const row of before) {
      const categoryId =
        change.kind === "set" ? change.categoryId : (row.categoryId ?? row.suggestedCategoryId);
      await tx
        .update(transactions)
        .set({
          ...chosenBy("user"),
          categoryId,
          // An automatic category replaced by another one is a correction the threshold counts.
          categoryReason:
            row.categoryId !== null &&
            row.categoryId !== categoryId &&
            row.categoryOrigin !== null &&
            // A rule is the person's own: replacing its category says nothing about the model.
            row.categoryOrigin !== "rule"
              ? "corrected"
              : null,
        })
        .where(and(eq(transactions.id, row.id), userScoped(ctx).owns(transactions)));
    }
    await tx
      .delete(categoryUndos)
      .where(
        and(
          userScoped(ctx).owns(categoryUndos),
          lt(categoryUndos.createdAt, new Date(Date.now() - UNDO_DAYS * 86_400_000)),
        ),
      );
    const [undo] = await tx
      .insert(categoryUndos)
      .values(
        userScoped(ctx).stamp({
          rows: before.map((row) => ({
            ...row,
            appliedCategoryId:
              change.kind === "set" ? change.categoryId : (row.categoryId ?? row.suggestedCategoryId),
          })),
        }),
      )
      .returning({ id: categoryUndos.id });
    await retypeMovements(tx, ctx);
    return { count: before.length, undoId: undo.id };
  });
}

/**
 * Puts back what an action changed: category, state and reason of every movement, as they were —
 * on the movements that still carry what the action wrote (the person's choice of that category).
 * A choice the person made since stays, as in "Undo" of a rule's "Apply". A movement back to
 * automatic or to a suggestion is no longer a confirmed label. Once only. Answers how many went back.
 */
export async function undoChange(ctx: Who, undoId: string): Promise<number> {
  if (!z.uuid().safeParse(undoId).success) throw new TransactionError("invalid");
  return getDb().transaction(async (tx) => {
    const [undo] = await tx
      .delete(categoryUndos)
      .where(and(eq(categoryUndos.id, undoId), userScoped(ctx).owns(categoryUndos)))
      .returning({ rows: categoryUndos.rows });
    if (!undo) throw new TransactionError("not_found");
    let restored = 0;
    for (const { id, appliedCategoryId, ...values } of undo.rows) {
      const back = await tx
        .update(transactions)
        .set({
          ...values,
          categoryOrigin: values.categoryOrigin as (typeof AUTOMATIC_CATEGORY_ORIGINS)[number] | null,
        })
        .where(
          and(
            eq(transactions.id, id),
            userScoped(ctx).owns(transactions),
            eq(transactions.categoryOrigin, "user"),
            // A row written before this guard has no category to compare: the origin alone decides.
            appliedCategoryId === undefined
              ? undefined
              : appliedCategoryId === null
                ? isNull(transactions.categoryId)
                : eq(transactions.categoryId, appliedCategoryId),
          ),
        )
        .returning({ id: transactions.id });
      restored += back.length;
    }
    await retypeMovements(tx, ctx);
    return restored;
  });
}
