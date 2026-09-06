import { and, asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { budgetAllocations, budgetAmountVersions, budgets, type BudgetAllocationRow, type BudgetAmountVersionRow } from "@/lib/db/schema";
import { VersionMismatchError } from "../application/errors";
import type { Allocation, AllocationsRepository, AmountVersion, AmountVersionsRepository } from "../application/ports";

function toAmountVersion(row: BudgetAmountVersionRow): AmountVersion {
  return row;
}

function toAllocation(row: BudgetAllocationRow): Allocation {
  return {
    ...row,
    sourceKind: row.sourceKind as Allocation["sourceKind"],
    recurrence: row.recurrence as Allocation["recurrence"],
  };
}

/** budget_amount_versions has no `user_id` column; it is protected by an EXISTS-to-parent RLS policy, so every method here still carries an explicit `budget_id` predicate. */
export class DrizzleAmountVersionsRepository implements AmountVersionsRepository {
  constructor(private readonly db: DbClient) {}

  async listForBudget(budgetId: string): Promise<AmountVersion[]> {
    const rows = await this.db
      .select()
      .from(budgetAmountVersions)
      .where(eq(budgetAmountVersions.budgetId, budgetId))
      .orderBy(asc(budgetAmountVersions.effectiveFrom), asc(budgetAmountVersions.id));
    return rows.map(toAmountVersion);
  }

  async add(input: Omit<AmountVersion, "id" | "createdAt">): Promise<AmountVersion> {
    const [row] = await this.db
      .insert(budgetAmountVersions)
      .values(input)
      .onConflictDoUpdate({
        target: [budgetAmountVersions.budgetId, budgetAmountVersions.effectiveFrom],
        set: {
          initialAmount: sql`excluded.initial_amount`,
          reason: sql`excluded.reason`,
          actorUserId: sql`excluded.actor_user_id`,
        },
      })
      .returning();
    return toAmountVersion(row!);
  }
}

/** budget_allocations has no `user_id` column; it is protected by an EXISTS-to-parent RLS policy, so every method here still carries an explicit `budget_id` predicate, and `listAgainstSource` joins `budgets` for an explicit `user_id` predicate. */
export class DrizzleAllocationsRepository implements AllocationsRepository {
  constructor(private readonly db: DbClient) {}

  async listForBudget(budgetId: string): Promise<Allocation[]> {
    const rows = await this.db
      .select()
      .from(budgetAllocations)
      .where(eq(budgetAllocations.budgetId, budgetId))
      .orderBy(asc(budgetAllocations.effectiveFrom), asc(budgetAllocations.id));
    return rows.map(toAllocation);
  }

  async listAgainstSource(userId: string, sourceKind: "fund" | "account", sourceId: string): Promise<Allocation[]> {
    const rows = await this.db
      .select({
        id: budgetAllocations.id,
        budgetId: budgetAllocations.budgetId,
        sourceKind: budgetAllocations.sourceKind,
        sourceId: budgetAllocations.sourceId,
        amount: budgetAllocations.amount,
        recurrence: budgetAllocations.recurrence,
        effectiveFrom: budgetAllocations.effectiveFrom,
        effectiveTo: budgetAllocations.effectiveTo,
        note: budgetAllocations.note,
        actorUserId: budgetAllocations.actorUserId,
        version: budgetAllocations.version,
        createdAt: budgetAllocations.createdAt,
        updatedAt: budgetAllocations.updatedAt,
      })
      .from(budgetAllocations)
      .innerJoin(budgets, eq(budgets.id, budgetAllocations.budgetId))
      .where(and(eq(budgets.userId, userId), eq(budgetAllocations.sourceKind, sourceKind), eq(budgetAllocations.sourceId, sourceId)))
      .orderBy(asc(budgetAllocations.effectiveFrom), asc(budgetAllocations.id));
    return rows.map(toAllocation);
  }

  async get(budgetId: string, id: string): Promise<Allocation | null> {
    const [row] = await this.db
      .select()
      .from(budgetAllocations)
      .where(and(eq(budgetAllocations.budgetId, budgetId), eq(budgetAllocations.id, id)))
      .limit(1);
    return row ? toAllocation(row) : null;
  }

  async create(input: Omit<Allocation, "id" | "version" | "createdAt" | "updatedAt">): Promise<Allocation> {
    const [row] = await this.db.insert(budgetAllocations).values(input).returning();
    return toAllocation(row!);
  }

  async update(
    budgetId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Allocation, "effectiveTo" | "note">>,
  ): Promise<Allocation | null> {
    const [row] = await this.db
      .update(budgetAllocations)
      .set({ ...patch, version: sql`${budgetAllocations.version} + 1`, updatedAt: new Date() })
      .where(and(eq(budgetAllocations.budgetId, budgetId), eq(budgetAllocations.id, id), eq(budgetAllocations.version, expectedVersion)))
      .returning();
    if (row) return toAllocation(row);
    if (await this.get(budgetId, id)) throw new VersionMismatchError();
    return null;
  }
}
