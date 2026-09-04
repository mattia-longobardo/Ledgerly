import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestEntries, type InterestEntryRow } from "@/lib/db/schema";
import type { InterestEntriesRepository, InterestEntry, NewInterestEntry } from "../application/ports";

function toEntry(row: InterestEntryRow): InterestEntry {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    occurredAt: row.occurredAt,
    gross: row.gross,
    net: row.net,
    kind: row.kind as InterestEntry["kind"],
    transactionId: row.transactionId,
    ruleId: row.ruleId,
    source: row.source as InterestEntry["source"],
  };
}

/**
 * Postgres-backed interest entries store. `interest_entries` carries its own
 * `user_id` column and a `interest_entries_owner` RLS policy on it directly
 * (no join needed), but `listForRule` — like `InterestAccrualsRepository`'s
 * methods — takes no `userId` in this interface (matching Task 15's port and
 * fake exactly); it is scoped by an already-validated `ruleId`, with RLS as
 * the enforcement layer for that query.
 */
export class DrizzleInterestEntriesRepository implements InterestEntriesRepository {
  constructor(private readonly db: DbClient) {}

  async listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]> {
    const conditions = [eq(interestEntries.ruleId, ruleId)];
    if (kind) conditions.push(eq(interestEntries.kind, kind));
    const rows = await this.db
      .select()
      .from(interestEntries)
      .where(and(...conditions))
      .orderBy(asc(interestEntries.occurredAt));
    return rows.map(toEntry);
  }

  async create(input: NewInterestEntry): Promise<InterestEntry> {
    const [row] = await this.db.insert(interestEntries).values(input).returning();
    return toEntry(row!);
  }
}
