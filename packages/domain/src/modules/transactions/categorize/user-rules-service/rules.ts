import { and, asc, count, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Ctx } from "../../../../platform/context";
import { getDb, type Tx } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import { categories, categoryRules, labels, transactions } from "../../schema";
import { TransactionError } from "../../service";
import { RULE_LIMIT, type RuleCondition, type RuleInput, ruleInputSchema } from "../user-rules";

type Who = Pick<Ctx, "userId">;

/** How long "Undo" of a deletion and of an "Apply" can be asked for. */
export const UNDO_DAYS = 7;
/** The movements "See" lists under the preview (§4.6). */
export const PREVIEW_ROWS = 50;
/** The reason of a movement whose rule was deleted (§4.5). */
const RULE_DELETED = "rule_deleted";

export interface Rule {
  id: string;
  name: string;
  position: number;
  active: boolean;
  conditions: RuleCondition[];
  categoryId: string;
  labelIds: string[];
  note: string | null;
}

interface RuleRow extends Rule {
  /** The movements that carry the rule's category today (§4.2). */
  count: number;
  /** The rule's category is archived: the rule is off by itself (§4.5). */
  categoryArchived: boolean;
}

export const RULE_COLUMNS = {
  id: categoryRules.id,
  name: categoryRules.name,
  position: categoryRules.position,
  active: categoryRules.active,
  conditions: categoryRules.conditions,
  categoryId: categoryRules.categoryId,
  labelIds: categoryRules.labelIds,
  note: categoryRules.note,
};

export const live = (ctx: Who) => and(userScoped(ctx).owns(categoryRules), isNull(categoryRules.deletedAt));

/** The person's rules, in their order, each with its count and whether its category is archived. */
export async function listRules(ctx: Who): Promise<RuleRow[]> {
  const [rows, counts] = await Promise.all([
    getDb()
      .select({ ...RULE_COLUMNS, archivedAt: categories.archivedAt })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(live(ctx))
      .orderBy(asc(categoryRules.position), asc(categoryRules.id)),
    getDb()
      .select({ ruleId: transactions.categoryRuleId, n: count() })
      .from(transactions)
      .where(
        and(
          userScoped(ctx).owns(transactions),
          eq(transactions.categoryOrigin, "rule"),
          isNotNull(transactions.categoryRuleId),
        ),
      )
      .groupBy(transactions.categoryRuleId)
      .orderBy(transactions.categoryRuleId),
  ]);
  const countOf = new Map(counts.map((row) => [row.ruleId, row.n]));
  return rows.map(({ archivedAt, ...rule }) => ({
    ...rule,
    count: countOf.get(rule.id) ?? 0,
    categoryArchived: archivedAt !== null,
  }));
}

/** The rules whose category is `categoryId`, for the card of the category's page (§5.4). */
export async function rulesForCategory(
  ctx: Who,
  categoryId: string,
): Promise<Pick<Rule, "id" | "name" | "active">[]> {
  return getDb()
    .select({ id: categoryRules.id, name: categoryRules.name, active: categoryRules.active })
    .from(categoryRules)
    .where(and(live(ctx), eq(categoryRules.categoryId, categoryId)))
    .orderBy(asc(categoryRules.position), asc(categoryRules.id));
}

async function requireOwned(tx: Tx, ctx: Who, input: RuleInput): Promise<void> {
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, input.categoryId),
        userScoped(ctx).owns(categories),
        isNull(categories.archivedAt),
      ),
    );
  if (!category) throw new TransactionError("invalid");
  if (input.labelIds.length > 0) {
    const own = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(inArray(labels.id, input.labelIds), userScoped(ctx).owns(labels)));
    if (own.length !== new Set(input.labelIds).size) throw new TransactionError("invalid");
  }
}

/** Drops the rules deleted long enough ago that no "Undo" can ask for them. */
async function forgetDeleted(tx: Tx, ctx: Who): Promise<void> {
  await tx
    .delete(categoryRules)
    .where(
      and(
        userScoped(ctx).owns(categoryRules),
        lt(categoryRules.deletedAt, new Date(Date.now() - UNDO_DAYS * 86_400_000)),
      ),
    );
}

/** One rule more, at the bottom of the list. Throws `limit` past 200 rules (§4.8). */
export async function createRule(ctx: Who, input: unknown): Promise<Rule> {
  const rule = ruleInputSchema.parse(input);
  return getDb().transaction(async (tx) => {
    // One writer at a time per person: the count and the next position are read under the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('category_rules'), hashtext(${ctx.userId}))`);
    await requireOwned(tx, ctx, rule);
    await forgetDeleted(tx, ctx);
    const [{ n, last }] = await tx
      .select({ n: count(), last: sql<number | null>`max(${categoryRules.position})` })
      .from(categoryRules)
      .where(live(ctx));
    if (n >= RULE_LIMIT) throw new TransactionError("limit");
    const [row] = await tx
      .insert(categoryRules)
      .values(userScoped(ctx).stamp({ ...rule, position: (last ?? 0) + 1 }))
      .returning(RULE_COLUMNS);
    return row;
  });
}

/** A change of a rule: the movements it already gave a category keep theirs (§4.5). */
export async function updateRule(ctx: Who, id: string, input: unknown): Promise<Rule> {
  const rule = ruleInputSchema.parse(input);
  return getDb().transaction(async (tx) => {
    await requireOwned(tx, ctx, rule);
    const [row] = await tx
      .update(categoryRules)
      .set(rule)
      .where(and(eq(categoryRules.id, id), live(ctx)))
      .returning(RULE_COLUMNS);
    if (!row) throw new TransactionError("not_found");
    // The reason on the movements names the rule as it is called now.
    await tx
      .update(transactions)
      .set({
        categoryReasonParams: sql`jsonb_set(${transactions.categoryReasonParams}, '{name}', to_jsonb(${row.name}::text))`,
      })
      .where(
        and(
          userScoped(ctx).owns(transactions),
          eq(transactions.categoryRuleId, id),
          eq(transactions.categoryReason, "rule"),
        ),
      );
    return row;
  });
}

export async function setRuleActive(ctx: Who, id: string, active: boolean): Promise<void> {
  const done = await getDb()
    .update(categoryRules)
    .set({ active })
    .where(and(eq(categoryRules.id, id), live(ctx)))
    .returning({ id: categoryRules.id });
  if (done.length === 0) throw new TransactionError("not_found");
}

/**
 * "Delete": the rule leaves the list and the cascade at once; the movements keep their category,
 * and their reason reads "Deleted rule". The row stays a while for "Undo" (`restoreRule`).
 */
export async function deleteRule(ctx: Who, id: string): Promise<void> {
  await markDeleted(ctx, id, true);
}

export async function restoreRule(ctx: Who, id: string): Promise<void> {
  await markDeleted(ctx, id, false);
}

/** A deletion, or its "Undo": the rule's row and the reason of its movements ("Deleted rule"). */
async function markDeleted(ctx: Who, id: string, deleted: boolean): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (!deleted) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('category_rules'), hashtext(${ctx.userId}))`,
      );
      const [{ n }] = await tx.select({ n: count() }).from(categoryRules).where(live(ctx));
      if (n >= RULE_LIMIT) throw new TransactionError("limit");
    }
    const done = await tx
      .update(categoryRules)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(
        and(
          eq(categoryRules.id, id),
          userScoped(ctx).owns(categoryRules),
          deleted ? isNull(categoryRules.deletedAt) : isNotNull(categoryRules.deletedAt),
        ),
      )
      .returning({ id: categoryRules.id });
    if (done.length === 0) throw new TransactionError("not_found");
    await tx
      .update(transactions)
      .set({ categoryReason: deleted ? RULE_DELETED : "rule" })
      .where(
        and(
          userScoped(ctx).owns(transactions),
          eq(transactions.categoryRuleId, id),
          eq(transactions.categoryReason, deleted ? "rule" : RULE_DELETED),
        ),
      );
  });
}

/** The whole order, as the list shows it after a drag or "Move up/down": every live rule, once. */
export async function reorderRules(ctx: Who, ids: readonly string[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    const own = await tx.select({ id: categoryRules.id }).from(categoryRules).where(live(ctx)).for("update");
    const wanted = new Set(ids);
    if (wanted.size !== ids.length || own.length !== ids.length || own.some((row) => !wanted.has(row.id))) {
      throw new TransactionError("invalid");
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(categoryRules)
        .set({ position: index + 1 })
        .where(and(eq(categoryRules.id, id), userScoped(ctx).owns(categoryRules)));
    }
  });
}
