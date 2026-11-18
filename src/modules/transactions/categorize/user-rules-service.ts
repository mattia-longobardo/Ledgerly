// modules/transactions/categorize/user-rules-service.ts — the rules of a person as a use case
// (categories-and-rules.md §4): keep them, check them on the movements, apply one to the movements
// already here and undo that. Every decision is in `user-rules.ts`; this file reads and writes.
//
// A rule never writes on a choice of a person (`user`), on a movement of a source that gives its
// own categories, or on a leg of a pair (QC4). Its category is automatic (`rule`): it counts at
// once and is never learnt from (`CONFIRMED` in `service.ts` reads `user` and `provider` only).
import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { retypeMovements } from "../macro";
import { typeByMacro } from "../rules";
import {
  categories,
  categoryRules,
  categoryRuleUndos,
  labels,
  type RuleUndoRow,
  transactionLabels,
  transactions,
} from "../schema";
import { ruleAccountFacts, TransactionError } from "../service";
import { memoryKey } from "./text";
import {
  firstMatch,
  RULE_LIMIT,
  type RuleCondition,
  type RuleFacts,
  type RuleInput,
  ruleInputSchema,
  ruleMatches,
  type RuleMovement,
  ruleReason,
} from "./user-rules";

type Who = Pick<Ctx, "userId">;

/** How long "Undo" of a deletion and of an "Apply" can be asked for. */
const UNDO_DAYS = 7;
/** The movements "See" lists under the preview (§4.6). */
const PREVIEW_ROWS = 50;
const AUTOMATIC = ["memory", "model", "table", "rule"] as const;
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

export interface RuleRow extends Rule {
  /** The movements that carry the rule's category today (§4.2). */
  count: number;
  /** The rule's category is archived: the rule is off by itself (§4.5). */
  categoryArchived: boolean;
}

const RULE_COLUMNS = {
  id: categoryRules.id,
  name: categoryRules.name,
  position: categoryRules.position,
  active: categoryRules.active,
  conditions: categoryRules.conditions,
  categoryId: categoryRules.categoryId,
  labelIds: categoryRules.labelIds,
  note: categoryRules.note,
};

const live = (ctx: Who) => and(userScoped(ctx).owns(categoryRules), isNull(categoryRules.deletedAt));

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
function ruleColumns(rule: Rule) {
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

async function addLabels(
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
async function existingLabels(ctx: Who, rules: readonly Rule[]): Promise<Set<string>> {
  const wanted = [...new Set(rules.flatMap((rule) => rule.labelIds))];
  if (wanted.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: labels.id })
    .from(labels)
    .where(and(inArray(labels.id, wanted), userScoped(ctx).owns(labels)));
  return new Set(rows.map((row) => row.id));
}

/** A movement the cascade is about to read: no category, no origin, on an account it may write. */
export interface NewMovement {
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

/** What a rule finds among the movements already here (§4.6). */
export interface RulePreview {
  /** Every movement the conditions match. */
  matched: number;
  /** Of those, the ones no rule may write on: a person's choice, a source's category, a pair. */
  kept: number;
  /** The ones "Apply" would change. */
  changes: number;
  /** The first of `changes`, newest first, for "See". */
  rows: { id: string; on: Date; payee: string | null; amountCents: bigint; categoryId: string | null }[];
  /** The ones that would leave or join Transfers: they stop or start counting (§3.5). */
  retyped: { count: number; sumCents: bigint; since: Date | null; fromType: "income" | "expense" | null };
}

const MOVEMENT_COLUMNS = {
  id: transactions.id,
  occurredAt: transactions.occurredAt,
  payee: transactions.payee,
  note: transactions.note,
  rawText: transactions.rawText,
  counterparty: transactions.counterpartyName,
  amountCents: transactions.amountCents,
  currency: transactions.currency,
  accountId: transactions.accountId,
  origin: transactions.origin,
  type: transactions.type,
  transferGroupId: transactions.transferGroupId,
  categoryId: transactions.categoryId,
  categoryOrigin: transactions.categoryOrigin,
  categoryRuleId: transactions.categoryRuleId,
  locallyEdited: transactions.locallyEdited,
};
type MovementRow = Pick<
  typeof transactions.$inferSelect,
  | "id"
  | "occurredAt"
  | "payee"
  | "note"
  | "rawText"
  | "amountCents"
  | "currency"
  | "accountId"
  | "origin"
  | "type"
  | "transferGroupId"
  | "categoryId"
  | "categoryOrigin"
  | "categoryRuleId"
  | "locallyEdited"
> & { counterparty: string | null };

/** Whether a rule may write on the movement (§4.6): never a choice, a source's category or a pair. */
function writable(row: MovementRow, categorisable: ReadonlySet<string>): boolean {
  if (!categorisable.has(row.accountId) || row.transferGroupId !== null) return false;
  const automatic =
    row.categoryOrigin !== null && (AUTOMATIC as readonly string[]).includes(row.categoryOrigin);
  if (automatic) return true;
  return row.categoryId === null && row.categoryOrigin === null && row.type !== "transfer";
}

function sameAsRule(row: MovementRow, rule: Pick<Rule, "id" | "categoryId">): boolean {
  return (
    row.categoryId === rule.categoryId && row.categoryOrigin === "rule" && row.categoryRuleId === rule.id
  );
}

interface Sorted {
  matched: MovementRow[];
  kept: number;
  changes: MovementRow[];
}

async function sortMovements(
  executor: Pick<Tx, "select">,
  ctx: Who,
  rule: Pick<Rule, "id" | "categoryId" | "conditions">,
  forUpdate: boolean,
): Promise<Sorted & { facts: RuleFacts }> {
  const facts = await ruleAccountFacts(ctx);
  const query = executor
    .select(MOVEMENT_COLUMNS)
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), isNull(transactions.removedUpstreamAt)))
    .orderBy(sql`${transactions.occurredAt} desc`, asc(transactions.id));
  const all = forUpdate ? await query.for("update") : await query;
  const manual = new Set(facts.manualAccountIds);
  const categorisable = new Set(facts.categorisable);
  const matched = all.filter((row) => ruleMatches(rule, ruleMovementOf(row, manual), facts));
  const open = matched.filter((row) => writable(row, categorisable));
  return {
    facts,
    matched,
    kept: matched.length - open.length,
    changes: open.filter((row) => !sameAsRule(row, rule)),
  };
}

async function categoryTypeOf(ctx: Who, categoryId: string): Promise<"income" | "expense" | "transfer"> {
  const [row] = await getDb()
    .select({ type: categories.type })
    .from(categories)
    .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
  if (!row) throw new TransactionError("invalid");
  return row.type;
}

/** The type a movement would take with the rule's category (CR3), against the one it has. */
function retypedOf(changes: readonly MovementRow[], categoryType: "income" | "expense" | "transfer") {
  const moved = changes.filter(
    (row) =>
      typeByMacro({ ...row, categoryType }) !== row.type &&
      (row.type === "transfer" || categoryType === "transfer"),
  );
  const fromType = moved.find((row) => row.type !== "transfer")?.type ?? null;
  return {
    count: moved.length,
    sumCents: moved.reduce(
      (sum, row) => sum + (row.amountCents < 0n ? -row.amountCents : row.amountCents),
      0n,
    ),
    since: moved.reduce<Date | null>(
      (first, row) => (first === null || row.occurredAt < first ? row.occurredAt : first),
      null,
    ),
    fromType: fromType === "income" || fromType === "expense" ? fromType : null,
  };
}

/**
 * What a rule — saved or still in the editor — finds today. A read: nothing is written. An input
 * that is not a valid rule throws, and the editor shows no preview.
 */
export async function previewRule(
  ctx: Who,
  input: unknown,
  ruleId: string | null = null,
): Promise<RulePreview> {
  const rule = ruleInputSchema.parse(input);
  const sorted = await sortMovements(getDb(), ctx, { id: ruleId ?? "", ...rule }, false);
  return {
    matched: sorted.matched.length,
    kept: sorted.kept,
    changes: sorted.changes.length,
    rows: sorted.changes.slice(0, PREVIEW_ROWS).map((row) => ({
      id: row.id,
      on: row.occurredAt,
      payee: row.payee,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
    })),
    retyped: retypedOf(sorted.changes, await categoryTypeOf(ctx, rule.categoryId)),
  };
}

/** The preview of a saved rule, for the dialog "Apply to existing transactions". */
export async function previewSavedRule(ctx: Who, id: string): Promise<RulePreview & { rule: Rule }> {
  const [rule] = await getDb()
    .select(RULE_COLUMNS)
    .from(categoryRules)
    .where(and(eq(categoryRules.id, id), live(ctx)));
  if (!rule) throw new TransactionError("not_found");
  return { rule, ...(await previewRule(ctx, rule, rule.id)) };
}

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
