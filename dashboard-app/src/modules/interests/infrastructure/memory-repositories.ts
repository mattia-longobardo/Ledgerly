import type {
  InterestAccrual,
  InterestAccrualsRepository,
  InterestEntriesRepository,
  InterestEntry,
  InterestRule,
  InterestRulePatch,
  InterestRulesRepository,
  NewInterestAccrual,
  NewInterestEntry,
  NewInterestRule,
} from "../application/ports";

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

/** In-memory stand-in for `DrizzleInterestRulesRepository` (Task 16), used by unit tests. */
export class MemoryInterestRulesRepository implements InterestRulesRepository {
  private rows: InterestRule[] = [];

  async list(userId: string): Promise<InterestRule[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async get(userId: string, id: string): Promise<InterestRule | null> {
    return this.rows.find((r) => r.userId === userId && r.id === id) ?? null;
  }

  async listActiveForAllUsers(asOf: string): Promise<InterestRule[]> {
    return this.rows.filter((r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf));
  }

  async create(input: NewInterestRule): Promise<InterestRule> {
    const now = new Date();
    const row: InterestRule = { ...input, id: monotonicId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: InterestRulePatch,
  ): Promise<InterestRule | "version_mismatch" | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) return "version_mismatch";
    const updated: InterestRule = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return updated;
  }
}

/** In-memory stand-in for `DrizzleInterestAccrualsRepository` (Task 16), used by unit tests. */
export class MemoryInterestAccrualsRepository implements InterestAccrualsRepository {
  private rows: InterestAccrual[] = [];

  async forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]> {
    return this.rows
      .filter((a) => a.ruleId === ruleId && a.accrualDate >= from && a.accrualDate <= to)
      .sort((a, b) => a.accrualDate.localeCompare(b.accrualDate));
  }

  async latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null> {
    const rows = this.rows.filter((a) => a.ruleId === ruleId).sort((a, b) => b.accrualDate.localeCompare(a.accrualDate));
    const latest = rows[0];
    return latest ? { accrualDate: latest.accrualDate, carryAfter: latest.carryAfter } : null;
  }

  async upsert(input: NewInterestAccrual): Promise<InterestAccrual> {
    const index = this.rows.findIndex((a) => a.ruleId === input.ruleId && a.accrualDate === input.accrualDate);
    if (index === -1) {
      const row: InterestAccrual = { ...input, id: monotonicId() };
      this.rows.push(row);
      return row;
    }
    // Mirrors DrizzleInterestAccrualsRepository.upsert's onConflictDoUpdate `set`
    // list exactly: only the computed fields are replaced on conflict.
    // `postedAt`/`entryId` are never touched here — every caller (including
    // `runInterestAccrual`) always passes `postedAt: null, entryId: null`, so
    // spreading `input` over them would silently un-post an accrual that
    // `markPosted` already posted, and `shouldPost`'s idempotency check would
    // then post it to Wallet a second time (Ruling P3-16).
    const existing = this.rows[index]!;
    const updated: InterestAccrual = {
      ...existing,
      balanceBasis: input.balanceBasis,
      gross: input.gross,
      tax: input.tax,
      net: input.net,
      carryAfter: input.carryAfter,
    };
    this.rows[index] = updated;
    return updated;
  }

  async markPosted(id: string, entryId: string, postedAt: Date): Promise<boolean> {
    const index = this.rows.findIndex((a) => a.id === id);
    if (index === -1) return false;
    this.rows[index] = { ...this.rows[index]!, postedAt, entryId };
    return true;
  }
}

/** In-memory stand-in for `DrizzleInterestEntriesRepository` (Task 16), used by unit tests. */
export class MemoryInterestEntriesRepository implements InterestEntriesRepository {
  private rows: InterestEntry[] = [];

  async listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]> {
    return this.rows
      .filter((e) => e.ruleId === ruleId && (kind === undefined || e.kind === kind))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  async create(input: NewInterestEntry): Promise<InterestEntry> {
    const row: InterestEntry = { ...input, id: monotonicId() };
    this.rows.push(row);
    return row;
  }
}
