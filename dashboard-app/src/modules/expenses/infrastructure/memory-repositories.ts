import { fromCents, toCents } from "@/lib/calc/money";
import type { DetectedPattern } from "../domain/recurring";
import type { Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";
import { InvalidInputError } from "../application/errors";
import type {
  CategoriesRepository,
  CategoryPatch,
  LabelPatch,
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

/**
 * Mirrors the `numeric(16, 2)` column scale `transactions.amount` and
 * `recurring_patterns.amount_low`/`amount_high` carry in Postgres: the real
 * repository always reads back a two-decimal string (Postgres pads or rounds
 * to the column's declared scale on write), so a fake that stored the raw
 * input verbatim would let a string-comparing test pass here and fail there.
 * Goes through integer cents rather than `Number()`, matching this
 * codebase's money-parsing rule.
 */
function normalizeMoney(value: string): string {
  const cents = toCents(value);
  return cents === null ? value : fromCents(cents).toFixed(2);
}

/** Strips explicit `undefined` values so a spread merge can't null out a field the caller never meant to touch — Drizzle's `mapUpdateSet` already drops them before the `SET` clause is built. */
function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Production ids default to `uuidv7()`, which is time-ordered, and
 * `list()`/`listAll()` tie-break equal `occurredAt` values on `desc(id)`. A
 * fake that generated ids with `crypto.randomUUID()` (v4, random) would make
 * that tie-break effectively random instead of chronological — untestable
 * divergence from production for same-day imports, which are ordinary, not
 * hypothetical. This generator is not a real UUIDv7, only order-compatible
 * with one: a millisecond timestamp prefix (ties broken across calls in the
 * same millisecond by a monotonic sequence) so ids created later always sort
 * greater than ids created earlier, matching uuidv7's time-ordering.
 */
let sequence = 0;
function monotonicId(): string {
  sequence += 1;
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const seq = sequence.toString(16).padStart(8, "0");
  return `${timestamp}-${seq}`;
}

/** In-memory stand-in for the Drizzle-backed repository, used by unit tests. */
export class MemoryTransactionsRepository implements TransactionsRepository {
  private rows: Transaction[] = [];
  private labelLinks = new Map<string, Set<string>>();

  /**
   * Optional, matching production only when supplied: the Drizzle repository
   * always joins `transaction_labels` to check ownership before inserting a
   * `transaction_label_links` row (see `setLabels` below and A5's ruling), so
   * a harness that exercises label assignment must construct this with the
   * `MemoryLabelsRepository` it also wires up, or the fake would silently
   * accept another user's label id where production refuses it.
   */
  constructor(private readonly labels?: MemoryLabelsRepository) {}

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
    // Compared as `Date`s, exactly like the Drizzle repository's
    // `gte`/`lt` against `new Date(opts.from/to)` — a lexical string compare
    // against the raw ISO param would silently disagree with Postgres for
    // any offset other than Z (e.g. `+02:00` sorts differently as text than
    // as an instant). The schema boundary (`ListTransactionsQuerySchema`)
    // already rejects an unparseable value before it reaches here.
    if (opts.from) {
      const from = new Date(opts.from);
      filtered = filtered.filter((t) => t.occurredAt.getTime() >= from.getTime());
    }
    if (opts.to) {
      const to = new Date(opts.to);
      filtered = filtered.filter((t) => t.occurredAt.getTime() < to.getTime());
    }
    if (opts.labelId) filtered = filtered.filter((t) => this.labelLinks.get(t.id)?.has(opts.labelId!));

    if (opts.cursor) {
      // Anchors on the (occurredAt, id) sort key, exactly like the Drizzle
      // repository's SQL tuple comparison `(occurred_at, id) < (anchor...)`:
      // the anchor row is looked up by userId + id alone, regardless of the
      // other filters above, and every row that sorts after it under the
      // same ORDER BY occurredAt DESC, id DESC is kept. This is standard
      // keyset pagination and cheap in SQL — the real repository is the
      // source of truth for this shape. One consequence: a cursor is only
      // valid against the filter set it was issued under; changing filters
      // between pages of the same cursor is not a supported flow.
      const anchor = this.rows.find((t) => t.userId === userId && t.id === opts.cursor);
      if (anchor) {
        filtered = filtered.filter(
          (t) =>
            t.occurredAt.getTime() < anchor.occurredAt.getTime() ||
            (t.occurredAt.getTime() === anchor.occurredAt.getTime() && t.id.localeCompare(anchor.id) < 0),
        );
      }
    }

    const page = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? page[page.length - 1]!.id : null;
    const labelsByTransaction = new Map<string, string[]>();
    for (const t of page) labelsByTransaction.set(t.id, [...(this.labelLinks.get(t.id) ?? [])]);
    return { items: page.map((t) => ({ ...t })), labelsByTransaction, nextCursor };
  }

  async get(userId: string, id: string): Promise<Transaction | null> {
    const row = this.rows.find((t) => t.userId === userId && t.id === id);
    // A copy, not the stored reference: a caller mutating the returned object
    // must never corrupt the store, the way a caller mutating a row returned
    // from a real query can never reach back into Postgres either.
    return row ? { ...row } : null;
  }

  async create(input: NewTransaction): Promise<Transaction> {
    const now = new Date();
    const row: Transaction = {
      ...input,
      amount: normalizeMoney(input.amount),
      id: monotonicId(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
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
    // Drizzle's `mapUpdateSet` drops explicit `undefined` values before
    // building the `SET` clause, so an unset field is left untouched rather
    // than nulled — the spread below must agree, or a patch built with an
    // explicit `undefined` (e.g. `{ note: undefined }`) would erase the
    // field here but leave it alone in production.
    const updated: Transaction = {
      ...current,
      ...definedEntries(patch),
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return updated;
  }

  async setLabels(userId: string, id: string, labelIds: string[]): Promise<void> {
    if (!this.rows.some((t) => t.userId === userId && t.id === id)) return;
    // Matches the Drizzle repository's ownership predicate: a labelId that
    // does not belong to this user must never be linked, even though the
    // FK alone would happily accept it (FK checks are not subject to RLS).
    if (labelIds.length > 0 && this.labels) {
      const owned = new Set((await this.labels.list(userId)).map((l) => l.id));
      if (labelIds.some((labelId) => !owned.has(labelId))) {
        throw new InvalidInputError("labelIds must belong to the caller");
      }
    }
    this.labelLinks.set(id, new Set(labelIds));
  }

  async labelsFor(userId: string, ids: string[]): Promise<Map<string, string[]>> {
    const owned = new Set(this.rows.filter((t) => t.userId === userId).map((t) => t.id));
    const out = new Map<string, string[]>();
    for (const id of ids) out.set(id, owned.has(id) ? [...(this.labelLinks.get(id) ?? [])] : []);
    return out;
  }

  async listAll(userId: string): Promise<Transaction[]> {
    return this.sorted(userId).map((t) => ({ ...t }));
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

  async create(input: NewCategory): Promise<TransactionCategory | "duplicate_name"> {
    if (this.rows.some((c) => c.userId === input.userId && c.name === input.name)) return "duplicate_name";
    const now = new Date();
    const row: TransactionCategory = { ...input, id: monotonicId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(userId: string, id: string, patch: CategoryPatch): Promise<TransactionCategory | "duplicate_name" | null> {
    const row = this.rows.find((c) => c.userId === userId && c.id === id);
    if (!row) return null;
    if (patch.name !== undefined && this.rows.some((c) => c.userId === userId && c.id !== id && c.name === patch.name)) {
      return "duplicate_name";
    }
    Object.assign(row, definedEntries(patch), { updatedAt: new Date() });
    return row;
  }
}

export class MemoryLabelsRepository implements LabelsRepository {
  private rows: TransactionLabel[] = [];

  async list(userId: string): Promise<TransactionLabel[]> {
    return this.rows.filter((l) => l.userId === userId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(userId: string, id: string): Promise<TransactionLabel | null> {
    return this.rows.find((l) => l.userId === userId && l.id === id) ?? null;
  }

  async findByName(userId: string, name: string): Promise<TransactionLabel | null> {
    return this.rows.find((l) => l.userId === userId && l.name === name) ?? null;
  }

  async create(input: NewLabel): Promise<TransactionLabel | "duplicate_name"> {
    if (this.rows.some((l) => l.userId === input.userId && l.name === input.name)) return "duplicate_name";
    const now = new Date();
    const row: TransactionLabel = { ...input, id: monotonicId(), createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(userId: string, id: string, patch: LabelPatch): Promise<TransactionLabel | "duplicate_name" | null> {
    const row = this.rows.find((l) => l.userId === userId && l.id === id);
    if (!row) return null;
    if (patch.name !== undefined && this.rows.some((l) => l.userId === userId && l.id !== id && l.name === patch.name)) {
      return "duplicate_name";
    }
    Object.assign(row, definedEntries(patch), { updatedAt: new Date() });
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
      this.rows.push({
        ...p,
        amountLow: normalizeMoney(p.amountLow),
        amountHigh: normalizeMoney(p.amountHigh),
        id: monotonicId(),
        userId,
      });
    }
  }
}
