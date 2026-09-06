import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { budgets, type BudgetRow } from "@/lib/db/schema";
import { VersionMismatchError } from "../application/errors";
import type { Budget, BudgetPatch, BudgetsRepository, NewBudget } from "../application/ports";

function toBudget(row: BudgetRow): Budget {
  return {
    ...row,
    status: row.status as Budget["status"],
    periodKind: row.periodKind as Budget["periodKind"],
    labels: [...row.labels],
  };
}

/**
 * Every method assumes the client is a transaction carrying the caller's RLS
 * context; the explicit `user_id` predicates keep the intent readable and
 * hold even under `withSystemContext`, where RLS lets everything through.
 */
export class DrizzleBudgetsRepository implements BudgetsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Budget[]> {
    const owned = eq(budgets.userId, userId);
    const rows = await this.db
      .select()
      .from(budgets)
      .where(opts?.includeArchived ? owned : and(owned, ne(budgets.status, "archived")))
      .orderBy(asc(budgets.name), asc(budgets.id));
    return rows.map(toBudget);
  }

  async get(userId: string, id: string): Promise<Budget | null> {
    const [row] = await this.db.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.id, id))).limit(1);
    return row ? toBudget(row) : null;
  }

  async create(input: NewBudget): Promise<Budget> {
    const [row] = await this.db.insert(budgets).values(input).returning();
    return toBudget(row!);
  }

  async update(userId: string, id: string, expectedVersion: number, patch: BudgetPatch): Promise<Budget | null> {
    const [row] = await this.db
      .update(budgets)
      .set({ ...patch, version: sql`${budgets.version} + 1`, updatedAt: new Date() })
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId), eq(budgets.version, expectedVersion)))
      .returning();
    if (row) return toBudget(row);
    if (await this.get(userId, id)) throw new VersionMismatchError();
    return null;
  }
}
