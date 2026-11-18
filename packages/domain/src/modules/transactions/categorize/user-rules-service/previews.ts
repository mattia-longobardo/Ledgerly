import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import { typeByMacro } from "../../rules";
import { categories, categoryRules, transactions } from "../../schema";
import { ruleAccountFacts, TransactionError } from "../../service";
import { type RuleFacts, ruleInputSchema, ruleMatches } from "../user-rules";
import { ruleMovementOf } from "./new-movements";
import { PREVIEW_ROWS, RULE_COLUMNS, live, type Rule } from "./rules";
import type { Ctx } from "../../../../platform/context";
import { AUTOMATIC_CATEGORY_ORIGINS } from "../../rules";

type Who = Pick<Ctx, "userId">;

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
    row.categoryOrigin !== null &&
    (AUTOMATIC_CATEGORY_ORIGINS as readonly string[]).includes(row.categoryOrigin);
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

export async function sortMovements(
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
