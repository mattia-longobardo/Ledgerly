import type { DetectedPattern } from "../domain/recurring";
import type { Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";
import type {
  CategoriesRepository,
  ListTransactionsOptions,
  ListTransactionsPage,
  NewCategory,
  NewLabel,
  NewTransaction,
  RecurringPatternRecord,
  RecurringPatternsRepository,
  TransactionPatch,
  TransactionsRepository,
  LabelsRepository,
} from "../application/ports";

function randomId(): string {
  return crypto.randomUUID();
}

/** In-memory stand-in for the Drizzle-backed repository, used by unit tests. */
export class MemoryTransactionsRepository implements TransactionsRepository {
  private rows: Transaction[] = [];
  private labelLinks = new Map<string, Set<string>>();

  private sorted(userId: string): Transaction[] {
    return this.rows
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
  }

  async list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let filtered = this.sorted(userId);
    if (opts.accountId) filtered = filtered.filter((t) => t.accountId === opts.accountId);
    if (opts.categoryId) filtered = filtered.filter((t) => t.categoryId === opts.categoryId);
    if (opts.type) filtered = filtered.filter((t) => t.type === opts.type);
    if (opts.from) filtered = filtered.filter((t) => t.occurredAt.toISOString() >= opts.from!);
    if (opts.to) filtered = filtered.filter((t) => t.occurredAt.toISOString() < opts.to!);
    if (opts.labelId) filtered = filtered.filter((t) => this.labelLinks.get(t.id)?.has(opts.labelId!));

    const startIndex = opts.cursor ? filtered.findIndex((t) => t.id === opts.cursor) + 1 : 0;
    const page = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < filtered.length ? page[page.length - 1]!.id : null;
    const labelsByTransaction = new Map<string, string[]>();
    for (const t of page) labelsByTransaction.set(t.id, [...(this.labelLinks.get(t.id) ?? [])]);
    return { items: page, labelsByTransaction, nextCursor };
  }

  async get(userId: string, id: string): Promise<Transaction | null> {
    return this.rows.find((t) => t.userId === userId && t.id === id) ?? null;
  }

  async create(input: NewTransaction): Promise<Transaction> {
    const now = new Date();
    const row: Transaction = { ...input, id: randomId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: TransactionPatch,
  ): Promise<Transaction | "version_mismatch" | null> {
    const index = this.rows.findIndex((t) => t.userId === userId && t.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) return "version_mismatch";
    const updated: Transaction = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return updated;
  }

  async setLabels(userId: string, id: string, labelIds: string[]): Promise<void> {
    if (!this.rows.some((t) => t.userId === userId && t.id === id)) return;
    this.labelLinks.set(id, new Set(labelIds));
  }

  async labelsFor(_userId: string, ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (const id of ids) out.set(id, [...(this.labelLinks.get(id) ?? [])]);
    return out;
  }

  async listAll(userId: string): Promise<Transaction[]> {
    return this.sorted(userId);
  }
}

export class MemoryCategoriesRepository implements CategoriesRepository {
  private rows: TransactionCategory[] = [];

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]> {
    const includeArchived = opts?.includeArchived ?? false;
    return this.rows
      .filter((c) => c.userId === userId && (includeArchived || c.archivedAt === null))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(userId: string, id: string): Promise<TransactionCategory | null> {
    return this.rows.find((c) => c.userId === userId && c.id === id) ?? null;
  }

  async findByName(userId: string, name: string): Promise<TransactionCategory | null> {
    return this.rows.find((c) => c.userId === userId && c.name === name) ?? null;
  }

  async create(input: NewCategory): Promise<TransactionCategory> {
    const now = new Date();
    const row: TransactionCategory = { ...input, id: randomId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
}

export class MemoryLabelsRepository implements LabelsRepository {
  private rows: TransactionLabel[] = [];

  async list(userId: string): Promise<TransactionLabel[]> {
    return this.rows.filter((l) => l.userId === userId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findByName(userId: string, name: string): Promise<TransactionLabel | null> {
    return this.rows.find((l) => l.userId === userId && l.name === name) ?? null;
  }

  async create(input: NewLabel): Promise<TransactionLabel> {
    const now = new Date();
    const row: TransactionLabel = { ...input, id: randomId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
}

export class MemoryRecurringPatternsRepository implements RecurringPatternsRepository {
  private rows: RecurringPatternRecord[] = [];

  async list(userId: string): Promise<RecurringPatternRecord[]> {
    return this.rows.filter((r) => r.userId === userId).sort((a, b) => a.payee.localeCompare(b.payee));
  }

  async replaceAll(userId: string, patterns: readonly DetectedPattern[]): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
    for (const p of patterns) {
      this.rows.push({ ...p, id: randomId(), userId });
    }
  }
}
