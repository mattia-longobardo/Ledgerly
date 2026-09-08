import { desc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { budgetEvents, type BudgetEventRow } from "@/lib/db/schema";
import type { BudgetEvent, EventsRepository } from "../application/ports";

function toEvent(row: BudgetEventRow): BudgetEvent {
  return { ...row, detail: row.detail as Record<string, unknown> };
}

/** budget_events has no `user_id` column; it is protected by an EXISTS-to-parent RLS policy, so every method here still carries an explicit `budget_id` predicate. */
export class DrizzleEventsRepository implements EventsRepository {
  constructor(private readonly db: DbClient) {}

  async listForBudget(budgetId: string, limit?: number): Promise<BudgetEvent[]> {
    const query = this.db
      .select()
      .from(budgetEvents)
      .where(eq(budgetEvents.budgetId, budgetId))
      .orderBy(desc(budgetEvents.createdAt), desc(budgetEvents.id));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(toEvent);
  }

  async add(input: Omit<BudgetEvent, "id" | "createdAt">): Promise<BudgetEvent> {
    const [row] = await this.db.insert(budgetEvents).values(input).returning();
    return toEvent(row!);
  }
}
