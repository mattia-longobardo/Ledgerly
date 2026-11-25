// modules/transactions/macro.ts — what a movement counts as (categories-and-rules.md §3.2): a pair
// or a leg to an account outside is a transfer, else what was decided here, else the source's
// transfer, else the sign. One write puts every movement of a person in line with the rule: each
// service that changes a pair or a type ends with it, in the same transaction. The rule is
// `typeByMacro` (`rules.ts`); the SQL below is the same rule.
import { sql } from "drizzle-orm";
import type { Ctx } from "../../platform/context";
import type { Tx } from "../../platform/db/client";

/** A transaction, or the database itself for a caller that writes nothing else. */
type Executor = Pick<Tx, "execute">;

/** The type of `t` under the rule. */
const TYPE_SQL = `case
  when t.transfer_group_id is not null or t.transfer_outside then 'transfer'
  when 'type' = any(t.locally_edited) then t.type
  when t.type = 'transfer' and t.origin = 'provider' then 'transfer'
  when t.amount_cents > 0 then 'income'
  when t.amount_cents < 0 then 'expense'
  when t.type = 'transfer' then 'income'
  else t.type end`;
const TYPE = sql.raw(TYPE_SQL);

/** A row out of line: another type, or a giroconto that still has a category or a suggestion. */
const OUT_OF_LINE = sql.raw(`(t.type <> ${TYPE_SQL}
  or (t.type = 'transfer' and (t.category_id is not null or t.suggested_category_id is not null)))`);

/**
 * Writes the rule's type on every movement of the person that disagrees with it, and returns how
 * many changed. A movement that becomes a giroconto loses its category and its suggestion: a
 * giroconto has accounts, not a category (`transactions_transfer_category_ck`). Movements already
 * in line are not written: a second call changes nothing.
 */
export async function retypeMovements(tx: Executor, ctx: Pick<Ctx, "userId">): Promise<number> {
  const result = await tx.execute(sql`
    update transactions as t set
      type = n.type,
      category_id = case when n.type = 'transfer' then null else t.category_id end,
      category_origin = case when n.type = 'transfer' then null else t.category_origin end,
      category_confidence = case when n.type = 'transfer' then null else t.category_confidence end,
      category_model_version = case when n.type = 'transfer' then null else t.category_model_version end,
      category_reason = case when n.type = 'transfer' then null else t.category_reason end,
      category_reason_params = case when n.type = 'transfer' then null else t.category_reason_params end,
      category_rule_id = case when n.type = 'transfer' then null else t.category_rule_id end,
      suggested_category_id = case when n.type = 'transfer' then null else t.suggested_category_id end
    from (select t.id, ${TYPE} as type from transactions t where t.user_id = ${ctx.userId} and ${OUT_OF_LINE}) as n
    where t.id = n.id`);
  return result.rowCount ?? 0;
}

/** How many movements of the person disagree with the rule: zero after every write. */
export async function movementsOutOfLine(tx: Executor, ctx: Pick<Ctx, "userId">): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
    from transactions t
    where t.user_id = ${ctx.userId} and ${OUT_OF_LINE}`);
  return Number(result.rows[0]?.n ?? 0);
}
