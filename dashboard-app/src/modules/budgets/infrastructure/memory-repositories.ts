import { VersionMismatchError } from "../application/errors";
import type {
  Allocation,
  AllocationsRepository,
  AmountVersion,
  AmountVersionsRepository,
  Budget,
  BudgetEvent,
  BudgetPatch,
  BudgetsRepository,
  EventsRepository,
  NewBudget,
  Scope,
  ScopesRepository,
  Usage,
  UsagesRepository,
} from "../application/ports";
import type { ScopeLike } from "../domain/scopes";
import { normalizeScale } from "./decimal";

/**
 * Production ids default to `uuidv7()`, which is time-ordered. This fake
 * generator is not a real UUIDv7, only order-compatible with one: a
 * millisecond timestamp prefix (ties within the same millisecond broken by a
 * monotonic sequence) so ids created later always sort greater than ids
 * created earlier — matching `expenses`'s `MemoryTransactionsRepository`
 * precedent, in case any future ordering ever tie-breaks on id.
 */
let sequence = 0;
function monotonicId(): string {
  sequence += 1;
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const seq = sequence.toString(16).padStart(8, "0");
  return `${timestamp}-${seq}`;
}

/** Strips explicit `undefined` values so a spread merge can't null out a field the caller never meant to touch — Drizzle's `mapUpdateSet` already drops them before the `SET` clause is built (carried from batch A's expenses-side fix, B9). */
function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export class MemoryBudgetsRepository implements BudgetsRepository {
  private rows: Budget[] = [];

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Budget[]> {
    return this.rows
      .filter((row) => row.userId === userId && (opts?.includeArchived || row.status !== "archived"))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row, labels: [...row.labels] }));
  }

  async get(userId: string, id: string): Promise<Budget | null> {
    const row = this.rows.find((candidate) => candidate.userId === userId && candidate.id === id);
    return row ? { ...row, labels: [...row.labels] } : null;
  }

  async create(input: NewBudget): Promise<Budget> {
    const now = new Date();
    const row: Budget = {
      ...input,
      labels: [...input.labels],
      goalAmount: input.goalAmount === null ? null : normalizeScale(input.goalAmount, 2),
      id: monotonicId(),
      status: "active",
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row, labels: [...row.labels] };
  }

  async update(userId: string, id: string, expectedVersion: number, patch: BudgetPatch): Promise<Budget | null> {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) throw new VersionMismatchError();
    const changes = definedEntries(patch);
    if (changes.goalAmount !== undefined && changes.goalAmount !== null) {
      changes.goalAmount = normalizeScale(changes.goalAmount, 2);
    }
    const updated: Budget = {
      ...current,
      ...changes,
      labels: changes.labels ? [...changes.labels] : [...current.labels],
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return { ...updated, labels: [...updated.labels] };
  }
}

export class MemoryAmountVersionsRepository implements AmountVersionsRepository {
  private rows: AmountVersion[] = [];

  async listForBudget(budgetId: string): Promise<AmountVersion[]> {
    return this.rows
      .filter((row) => row.budgetId === budgetId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async add(input: Omit<AmountVersion, "id" | "createdAt">): Promise<AmountVersion> {
    const normalized = { ...input, initialAmount: normalizeScale(input.initialAmount, 2) };
    const index = this.rows.findIndex((row) => row.budgetId === input.budgetId && row.effectiveFrom === input.effectiveFrom);
    if (index >= 0) {
      const updated = { ...this.rows[index]!, ...normalized };
      this.rows[index] = updated;
      return { ...updated };
    }
    const row: AmountVersion = { ...normalized, id: monotonicId(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

export class MemoryAllocationsRepository implements AllocationsRepository {
  private rows: Allocation[] = [];

  constructor(private readonly budgets: BudgetsRepository) {}

  async listForBudget(budgetId: string): Promise<Allocation[]> {
    return this.rows
      .filter((row) => row.budgetId === budgetId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async listAgainstSource(userId: string, sourceKind: "fund" | "account", sourceId: string): Promise<Allocation[]> {
    const owned = new Set((await this.budgets.list(userId, { includeArchived: true })).map((row) => row.id));
    return this.rows
      .filter((row) => owned.has(row.budgetId) && row.sourceKind === sourceKind && row.sourceId === sourceId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async get(budgetId: string, id: string): Promise<Allocation | null> {
    const row = this.rows.find((candidate) => candidate.budgetId === budgetId && candidate.id === id);
    return row ? { ...row } : null;
  }

  async create(input: Omit<Allocation, "id" | "version" | "createdAt" | "updatedAt">): Promise<Allocation> {
    const now = new Date();
    const row: Allocation = { ...input, amount: normalizeScale(input.amount, 2), id: monotonicId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
  }

  async update(
    budgetId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Allocation, "effectiveTo" | "note">>,
  ): Promise<Allocation | null> {
    const index = this.rows.findIndex((row) => row.budgetId === budgetId && row.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) throw new VersionMismatchError();
    const updated: Allocation = { ...current, ...definedEntries(patch), version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return { ...updated };
  }
}

export class MemoryScopesRepository implements ScopesRepository {
  private rows: Scope[] = [];

  async listForBudget(budgetId: string): Promise<Scope[]> {
    return this.rows
      .filter((row) => row.budgetId === budgetId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async replace(budgetId: string, scopes: readonly ScopeLike[]): Promise<Scope[]> {
    const created: Scope[] = scopes.map((scope) => ({ ...scope, id: monotonicId(), budgetId }));
    this.rows = [...this.rows.filter((row) => row.budgetId !== budgetId), ...created];
    return created.map((row) => ({ ...row }));
  }
}

export class MemoryUsagesRepository implements UsagesRepository {
  private rows: Usage[] = [];

  async listForBudget(budgetId: string, opts?: { from?: string; to?: string }): Promise<Usage[]> {
    return this.rows
      .filter((row) => row.budgetId === budgetId && (!opts?.from || row.occurredAt >= opts.from) && (!opts?.to || row.occurredAt <= opts.to))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async get(budgetId: string, id: string): Promise<Usage | null> {
    const row = this.rows.find((candidate) => candidate.budgetId === budgetId && candidate.id === id);
    return row ? { ...row } : null;
  }

  async create(input: Omit<Usage, "id" | "createdAt">): Promise<Usage> {
    const row: Usage = { ...input, amount: normalizeScale(input.amount, 2), id: monotonicId(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }

  async delete(budgetId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.budgetId === budgetId && row.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  /** R6-3: keyed by transactionId; `matchedBy = 'manual'` rows are never touched. */
  async replaceScopeMatched(
    budgetId: string,
    rows: readonly { transactionId: string; amount: string; occurredAt: string }[],
  ): Promise<{ inserted: number; updated: number; deleted: number }> {
    const wanted = new Map(rows.map((row) => [row.transactionId, { amount: normalizeScale(row.amount, 2), occurredAt: row.occurredAt }]));
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    const now = new Date();
    const otherBudgets = this.rows.filter((row) => row.budgetId !== budgetId);
    const mine = this.rows.filter((row) => row.budgetId === budgetId);

    const kept: Usage[] = [];
    for (const row of mine) {
      if (row.matchedBy === "manual") {
        kept.push(row);
        continue;
      }
      const transactionId = row.transactionId!;
      const want = wanted.get(transactionId);
      if (want === undefined) {
        deleted += 1;
        continue;
      }
      wanted.delete(transactionId);
      if (want.amount !== row.amount || want.occurredAt !== row.occurredAt) {
        kept.push({ ...row, amount: want.amount, occurredAt: want.occurredAt });
        updated += 1;
      } else {
        kept.push(row);
      }
    }
    for (const [transactionId, want] of wanted) {
      kept.push({
        id: monotonicId(),
        budgetId,
        transactionId,
        amount: want.amount,
        occurredAt: want.occurredAt,
        matchedBy: "scope",
        note: null,
        createdAt: now,
      });
      inserted += 1;
    }
    this.rows = [...otherBudgets, ...kept];
    return { inserted, updated, deleted };
  }
}

export class MemoryEventsRepository implements EventsRepository {
  private rows: BudgetEvent[] = [];

  async listForBudget(budgetId: string, limit?: number): Promise<BudgetEvent[]> {
    const rows = this.rows
      .filter((row) => row.budgetId === budgetId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map((row) => ({ ...row, detail: { ...row.detail } }));
    return limit === undefined ? rows : rows.slice(0, limit);
  }

  async add(input: Omit<BudgetEvent, "id" | "createdAt">): Promise<BudgetEvent> {
    const row: BudgetEvent = { ...input, detail: { ...input.detail }, id: monotonicId(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row, detail: { ...row.detail } };
  }
}
