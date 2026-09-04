import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestAccruals, type InterestAccrualRow } from "@/lib/db/schema";
import type { InterestAccrual, InterestAccrualsRepository, NewInterestAccrual } from "../application/ports";

function toAccrual(row: InterestAccrualRow): InterestAccrual {
  return {
    id: row.id,
    ruleId: row.ruleId,
    accrualDate: row.accrualDate,
    balanceBasis: row.balanceBasis,
    gross: row.gross,
    tax: row.tax,
    net: row.net,
    carryAfter: row.carryAfter,
    source: row.source as "computed",
    postedAt: row.postedAt,
    entryId: row.entryId,
  };
}

/**
 * Postgres-backed interest accruals store. `interest_accruals` carries no
 * `user_id` column of its own — it owns its user only indirectly, through
 * `rule_id` — so unlike every other repository in this module there is no
 * column to add an explicit `user_id` predicate to. None of this interface's
 * methods take a `userId` either (matching Task 15's port and fake exactly):
 * every one of them is scoped by an already-validated `ruleId` or `id`, on
 * the assumption the caller obtained that id through
 * `InterestRulesRepository.get(userId, ruleId)` first. Ownership is therefore
 * enforced entirely by `interest_accruals_owner`'s RLS policy, which joins to
 * `interest_rules` via `EXISTS` — the "join, not a column" case. This
 * repository must always run inside a user (or system) context; it deliberately
 * carries no defense-in-depth predicate of its own because the interface gives
 * it no user id to filter on.
 */
export class DrizzleInterestAccrualsRepository implements InterestAccrualsRepository {
  constructor(private readonly db: DbClient) {}

  async forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]> {
    const rows = await this.db
      .select()
      .from(interestAccruals)
      .where(and(eq(interestAccruals.ruleId, ruleId), gte(interestAccruals.accrualDate, from), lte(interestAccruals.accrualDate, to)))
      .orderBy(asc(interestAccruals.accrualDate));
    return rows.map(toAccrual);
  }

  async latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null> {
    const [row] = await this.db
      .select({ accrualDate: interestAccruals.accrualDate, carryAfter: interestAccruals.carryAfter })
      .from(interestAccruals)
      .where(eq(interestAccruals.ruleId, ruleId))
      .orderBy(desc(interestAccruals.accrualDate))
      .limit(1);
    return row ?? null;
  }

  async upsert(input: NewInterestAccrual): Promise<InterestAccrual> {
    // `set` deliberately omits `postedAt`/`entryId`: every caller (including
    // `runInterestAccrual`) always passes `postedAt: null, entryId: null` on
    // `input`, and this repository's contract is that a conflict never resets
    // what `markPosted` already recorded — `MemoryInterestAccrualsRepository.upsert`
    // preserves the same two columns identically on conflict (Ruling P3-16).
    const [row] = await this.db
      .insert(interestAccruals)
      .values(input)
      .onConflictDoUpdate({
        target: [interestAccruals.ruleId, interestAccruals.accrualDate],
        set: {
          balanceBasis: input.balanceBasis,
          gross: input.gross,
          tax: input.tax,
          net: input.net,
          carryAfter: input.carryAfter,
        },
      })
      .returning();
    return toAccrual(row!);
  }

  async markPosted(id: string, entryId: string, postedAt: Date): Promise<void> {
    await this.db.update(interestAccruals).set({ entryId, postedAt }).where(eq(interestAccruals.id, id));
  }
}
