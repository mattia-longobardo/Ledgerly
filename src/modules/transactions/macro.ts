// modules/transactions/macro.ts — the macro of the category decides how a movement counts
// (categories-and-rules.md §3.2, CR3). One write puts every movement of a person in line with the
// rule: each service that changes a category, a pair or a category's macro ends with it, in the
// same transaction. The rule is `typeByMacro` and `typeMarkerByMacro` (`rules.ts`); the SQL below
// is the same rule, and the migration of N3.3 runs it once for every person.
import "server-only";
import { sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import type { Tx } from "@/platform/db/client";

/** A transaction, or the database itself for a caller that writes nothing else. */
type Executor = Pick<Tx, "execute">;

/** The type of `t` under the rule, with its category joined as `c`. */
const TYPE = sql.raw(`case
  when t.transfer_group_id is not null then t.type
  when c.type = 'transfer' then 'transfer'
  when t.type = 'transfer' and t.origin = 'provider' and not ('type' = any(t.locally_edited)) then 'transfer'
  when t.amount_cents > 0 then 'income'
  when t.amount_cents < 0 then 'expense'
  when t.type = 'transfer' then 'income'
  else t.type end`);

/** `locally_edited` of `t` under the rule. */
const MARKER = sql.raw(`case
  when t.transfer_group_id is not null then t.locally_edited
  when c.type = 'transfer' then array(select f from unnest(array_append(array_remove(t.locally_edited, 'type'), 'type')) f order by f collate "C")
  else array_remove(t.locally_edited, 'type') end`);

/**
 * Writes the rule's type on every movement of the person that disagrees with it, and returns how
 * many changed. Movements already in line are not written: a second call changes nothing.
 */
export async function retypeMovements(tx: Executor, ctx: Pick<Ctx, "userId">): Promise<number> {
  const result = await tx.execute(sql`
    update transactions as u set type = n.type, locally_edited = n.marker
    from (
      select t.id, ${TYPE} as type, ${MARKER} as marker
      from transactions t left join categories c on c.id = t.category_id
      where t.user_id = ${ctx.userId}
    ) as n
    where u.id = n.id and (u.type <> n.type or u.locally_edited <> n.marker)`);
  return result.rowCount ?? 0;
}

/** How many movements of the person disagree with the rule: zero after every write. */
export async function movementsOutOfLine(tx: Executor, ctx: Pick<Ctx, "userId">): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
    from transactions t left join categories c on c.id = t.category_id
    where t.user_id = ${ctx.userId} and (t.type <> ${TYPE} or t.locally_edited <> ${MARKER})`);
  return Number(result.rows[0]?.n ?? 0);
}
