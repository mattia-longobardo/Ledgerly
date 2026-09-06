import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { budgetScopes, budgetUsages, type BudgetScopeRow, type BudgetUsageRow } from "@/lib/db/schema";
import type { Scope, ScopesRepository, Usage, UsagesRepository } from "../application/ports";
import type { ScopeLike } from "../domain/scopes";

function toScope(row: BudgetScopeRow): Scope {
  return { ...row, kind: row.kind as Scope["kind"] };
}

function toUsage(row: BudgetUsageRow): Usage {
  return { ...row, matchedBy: row.matchedBy as Usage["matchedBy"] };
}

/** Mirrors `normalizeScale` in the memory repository: comparisons against a stored `numeric(16,2)` must not treat "10" and "10.00" as a spurious change. */
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
function normalizeScale(value: string, scale: number): string {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, fracPart = ""] = m;
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

/** budget_scopes has no `user_id` column; it is protected by an EXISTS-to-parent RLS policy, so every method here still carries an explicit `budget_id` predicate. */
export class DrizzleScopesRepository implements ScopesRepository {
  constructor(private readonly db: DbClient) {}

  async listForBudget(budgetId: string): Promise<Scope[]> {
    const rows = await this.db
      .select()
      .from(budgetScopes)
      .where(eq(budgetScopes.budgetId, budgetId))
      .orderBy(asc(budgetScopes.id));
    return rows.map(toScope);
  }

  async replace(budgetId: string, scopes: readonly ScopeLike[]): Promise<Scope[]> {
    await this.db.delete(budgetScopes).where(eq(budgetScopes.budgetId, budgetId));
    if (scopes.length === 0) return [];
    const rows = await this.db
      .insert(budgetScopes)
      .values(scopes.map((scope) => ({ budgetId, kind: scope.kind, refId: scope.refId })))
      .returning();
    return rows.map(toScope);
  }
}

/** budget_usages has no `user_id` column; it is protected by an EXISTS-to-parent RLS policy, so every method here still carries an explicit `budget_id` predicate. */
export class DrizzleUsagesRepository implements UsagesRepository {
  constructor(private readonly db: DbClient) {}

  async listForBudget(budgetId: string, opts?: { from?: string; to?: string }): Promise<Usage[]> {
    const conditions = [eq(budgetUsages.budgetId, budgetId)];
    if (opts?.from) conditions.push(gte(budgetUsages.occurredAt, opts.from));
    if (opts?.to) conditions.push(lte(budgetUsages.occurredAt, opts.to));
    const rows = await this.db
      .select()
      .from(budgetUsages)
      .where(and(...conditions))
      .orderBy(asc(budgetUsages.occurredAt), asc(budgetUsages.id));
    return rows.map(toUsage);
  }

  async get(budgetId: string, id: string): Promise<Usage | null> {
    const [row] = await this.db
      .select()
      .from(budgetUsages)
      .where(and(eq(budgetUsages.budgetId, budgetId), eq(budgetUsages.id, id)))
      .limit(1);
    return row ? toUsage(row) : null;
  }

  async create(input: Omit<Usage, "id" | "createdAt">): Promise<Usage> {
    const [row] = await this.db.insert(budgetUsages).values(input).returning();
    return toUsage(row!);
  }

  async delete(budgetId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(budgetUsages)
      .where(and(eq(budgetUsages.budgetId, budgetId), eq(budgetUsages.id, id)))
      .returning({ id: budgetUsages.id });
    return rows.length > 0;
  }

  /** R6-3: select the budget's scope-matched rows, diff in memory against `rows` (keyed by `transactionId`), then batch insert / update / delete inside the caller's transaction. `matchedBy = 'manual'` rows are never selected, so they are never touched. */
  async replaceScopeMatched(
    budgetId: string,
    rows: readonly { transactionId: string; amount: string; occurredAt: string }[],
  ): Promise<{ inserted: number; updated: number; deleted: number }> {
    const existing = await this.db
      .select({ id: budgetUsages.id, transactionId: budgetUsages.transactionId, amount: budgetUsages.amount, occurredAt: budgetUsages.occurredAt })
      .from(budgetUsages)
      .where(and(eq(budgetUsages.budgetId, budgetId), eq(budgetUsages.matchedBy, "scope")));

    const existingByTx = new Map(existing.filter((row) => row.transactionId !== null).map((row) => [row.transactionId as string, row]));
    const wantedTxIds = new Set(rows.map((row) => row.transactionId));

    const toInsert: { transactionId: string; amount: string; occurredAt: string }[] = [];
    const toUpdate: { id: string; amount: string; occurredAt: string }[] = [];
    for (const row of rows) {
      const amount = normalizeScale(row.amount, 2);
      const existingRow = existingByTx.get(row.transactionId);
      if (!existingRow) {
        toInsert.push({ transactionId: row.transactionId, amount, occurredAt: row.occurredAt });
      } else if (existingRow.amount !== amount || existingRow.occurredAt !== row.occurredAt) {
        toUpdate.push({ id: existingRow.id, amount, occurredAt: row.occurredAt });
      }
    }
    const toDeleteIds = existing.filter((row) => row.transactionId !== null && !wantedTxIds.has(row.transactionId)).map((row) => row.id);

    if (toInsert.length > 0) {
      await this.db.insert(budgetUsages).values(
        toInsert.map((row) => ({
          budgetId,
          transactionId: row.transactionId,
          amount: row.amount,
          occurredAt: row.occurredAt,
          matchedBy: "scope" as const,
          note: null,
        })),
      );
    }
    for (const row of toUpdate) {
      await this.db
        .update(budgetUsages)
        .set({ amount: row.amount, occurredAt: row.occurredAt })
        .where(and(eq(budgetUsages.budgetId, budgetId), eq(budgetUsages.id, row.id)));
    }
    if (toDeleteIds.length > 0) {
      await this.db.delete(budgetUsages).where(and(eq(budgetUsages.budgetId, budgetId), inArray(budgetUsages.id, toDeleteIds)));
    }

    return { inserted: toInsert.length, updated: toUpdate.length, deleted: toDeleteIds.length };
  }
}
