import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import { retypeMovements } from "../../macro";
import { categories, categoryRules, labels, transactionLabels, transactions } from "../../schema";
import { ruleAccountFacts } from "../../service";
import { memoryKey } from "../text";
import { firstMatch, type RuleMovement, ruleReason } from "../user-rules";
import { RULE_COLUMNS, live, type Rule } from "./rules";
import type { Ctx } from "../../../../platform/context";

type Who = Pick<Ctx, "userId">;

/** The rules the cascade checks, in their order: active, live, on a category not archived. */
async function workingRules(ctx: Who): Promise<Rule[]> {
  return getDb()
    .select(RULE_COLUMNS)
    .from(categoryRules)
    .innerJoin(categories, and(eq(categories.id, categoryRules.categoryId), isNull(categories.archivedAt)))
    .where(and(live(ctx), eq(categoryRules.active, true)))
    .orderBy(asc(categoryRules.position), asc(categoryRules.id));
}

/** What a rule reads of a movement, from its columns. */
export function ruleMovementOf(
  row: {
    payee: string | null;
    note: string | null;
    rawText: string | null;
    counterparty: string | null;
    amountCents: bigint;
    currency: string;
    accountId: string;
    origin: string;
  },
  manualAccounts: ReadonlySet<string>,
): RuleMovement {
  return { ...row, manual: row.origin === "manual" || manualAccounts.has(row.accountId) };
}

/** The columns a rule writes on a movement it gives its category to. */
export function ruleColumns(rule: Rule) {
  return {
    categoryId: rule.categoryId,
    categoryOrigin: "rule" as const,
    categoryRuleId: rule.id,
    categoryConfidence: null,
    categoryModelVersion: null,
    suggestedCategoryId: null,
    ...ruleReason(rule),
  };
}

export async function addLabels(
  tx: Tx,
  ctx: Who,
  transactionId: string,
  labelIds: readonly string[],
): Promise<string[]> {
  if (labelIds.length === 0) return [];
  const added = await tx
    .insert(transactionLabels)
    .values(labelIds.map((labelId) => userScoped(ctx).stamp({ transactionId, labelId })))
    .onConflictDoNothing()
    .returning({ labelId: transactionLabels.labelId });
  return added.map((row) => row.labelId);
}

/** The labels of the rules that still exist: one deleted after the rule was saved is skipped. */
export async function existingLabels(ctx: Who, rules: readonly Rule[]): Promise<Set<string>> {
  const wanted = [...new Set(rules.flatMap((rule) => rule.labelIds))];
  if (wanted.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: labels.id })
    .from(labels)
    .where(and(inArray(labels.id, wanted), userScoped(ctx).owns(labels)));
  return new Set(rows.map((row) => row.id));
}

/** A movement the cascade is about to read: no category, no origin, on an account it may write. */
interface NewMovement {
  id: string;
  payee: string | null;
  note: string | null;
  rawText: string | null;
  counterparty: string | null;
  amountCents: bigint;
  currency: string;
  accountId: string;
  origin: string;
  transferGroupId: string | null;
}

/**
 * The first level of the cascade (§4.5, K1): each movement a rule matches gets the rule's
 * category, labels and note, in one transaction, and the type the section says (CR3). Answers the
 * ids it wrote: the cascade leaves those alone. Only a movement still with no category and no
 * origin is written — a choice a person made meanwhile stays.
 */
export async function applyRulesToNew(ctx: Who, rows: readonly NewMovement[]): Promise<Set<string>> {
  const written = new Set<string>();
  if (rows.length === 0) return written;
  const rules = await workingRules(ctx);
  if (rules.length === 0) return written;
  const [facts, known] = await Promise.all([ruleAccountFacts(ctx), existingLabels(ctx, rules)]);
  const manual = new Set(facts.manualAccountIds);
  const decided = rows.flatMap((row) => {
    if (row.transferGroupId !== null) return [];
    const rule = firstMatch(rules, ruleMovementOf(row, manual), facts);
    return rule === null ? [] : [{ row, rule }];
  });
  if (decided.length === 0) return written;
  await getDb().transaction(async (tx) => {
    for (const { row, rule } of decided) {
      const done = await tx
        .update(transactions)
        .set({
          ...ruleColumns(rule),
          categoryKey: memoryKey(row),
          // Only on a movement with no note now: one a person wrote meanwhile stays.
          ...(rule.note !== null ? { note: sql`coalesce(${transactions.note}, ${rule.note})` } : {}),
        })
        .where(
          and(
            eq(transactions.id, row.id),
            userScoped(ctx).owns(transactions),
            isNull(transactions.categoryId),
            isNull(transactions.categoryOrigin),
          ),
        )
        .returning({ id: transactions.id });
      if (done.length === 0) continue;
      written.add(row.id);
      await addLabels(
        tx,
        ctx,
        row.id,
        rule.labelIds.filter((id) => known.has(id)),
      );
    }
    await retypeMovements(tx, ctx);
  });
  return written;
}
