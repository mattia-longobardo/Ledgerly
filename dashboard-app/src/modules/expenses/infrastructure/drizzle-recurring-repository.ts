import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { recurringPatterns } from "@/lib/db/schema";
import type { RecurringPatternRecord, RecurringPatternsRepository } from "../application/ports";
import type { DetectedPattern } from "../domain/recurring";

/**
 * Postgres-backed recurring-patterns store. Every method assumes the client
 * is a transaction carrying the caller's RLS context (see
 * `withUserContext`); the explicit `user_id` predicates hold even under the
 * system context, where RLS lets everything through.
 */
export class DrizzleRecurringRepository implements RecurringPatternsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<RecurringPatternRecord[]> {
    const rows = await this.db
      .select()
      .from(recurringPatterns)
      .where(eq(recurringPatterns.userId, userId))
      .orderBy(asc(recurringPatterns.payee));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      payee: r.payee,
      cadence: r.cadence as RecurringPatternRecord["cadence"],
      amountLow: r.amountLow,
      amountHigh: r.amountHigh,
      currency: r.currency,
      sign: r.sign as RecurringPatternRecord["sign"],
      lastSeenAt: r.lastSeenAt,
      nextExpectedAt: r.nextExpectedAt,
      occurrenceCount: r.occurrenceCount,
    }));
  }

  /** Full recompute per run: the detector re-derives every pattern from all transactions, so the previous set is discarded first. */
  async replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(recurringPatterns).where(eq(recurringPatterns.userId, userId));
      if (patterns.length === 0) return;
      await tx.insert(recurringPatterns).values(
        patterns.map((p) => ({
          userId,
          payee: p.payee,
          cadence: p.cadence,
          amountLow: p.amountLow,
          amountHigh: p.amountHigh,
          currency: p.currency,
          sign: p.sign,
          lastSeenAt: p.lastSeenAt,
          nextExpectedAt: p.nextExpectedAt,
          occurrenceCount: p.occurrenceCount,
        })),
      );
    });
  }
}
