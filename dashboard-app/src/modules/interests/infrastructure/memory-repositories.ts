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

/** Strips explicit `undefined` values so a spread merge can't null out a field the caller never meant to touch — Drizzle's `mapUpdateSet` already drops them before the `SET` clause is built (carried from batch A's expenses-side fix, B9). */
function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Mirrors the `numeric(16, 2)` scale `interest_accruals.balance_basis`/`net`
 * carry in Postgres — same rationale as the expenses module's
 * `normalizeMoney` (B9, carried from batch A): the real repository always
 * reads back a two-decimal string, so a fake that echoed the raw input
 * verbatim would let a string-comparing test pass here and fail there. A
 * plain regex, never `Number()`.
 */
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
function normalizeScale(value: string, scale: number): string {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, fracPart = ""] = m;
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

/** In-memory stand-in for `DrizzleInterestRulesRepository` (Task 16), used by unit tests. */
export class MemoryInterestRulesRepository implements InterestRulesRepository {
  private rows: InterestRule[] = [];

  async list(userId: string): Promise<InterestRule[]> {
    return this.rows.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }

  async get(userId: string, id: string): Promise<InterestRule | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return row ? { ...row } : null;
  }

  async listActiveForAllUsers(asOf: string): Promise<InterestRule[]> {
    return this.rows
      .filter((r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf))
      .map((r) => ({ ...r }));
  }

  async create(input: NewInterestRule): Promise<InterestRule> {
    const now = new Date();
    const row: InterestRule = { ...input, id: monotonicId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
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
    const updated: InterestRule = { ...current, ...definedEntries(patch), version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return { ...updated };
  }
}

/** In-memory stand-in for `DrizzleInterestAccrualsRepository` (Task 16), used by unit tests. */
export class MemoryInterestAccrualsRepository implements InterestAccrualsRepository {
  private rows: InterestAccrual[] = [];

  async forRule(ruleId: string, from: string, to: string): Promise<InterestAccrual[]> {
    return this.rows
      .filter((a) => a.ruleId === ruleId && a.accrualDate >= from && a.accrualDate <= to)
      .sort((a, b) => a.accrualDate.localeCompare(b.accrualDate))
      .map((a) => ({ ...a }));
  }

  async latestCarry(ruleId: string): Promise<{ accrualDate: string; carryAfter: string } | null> {
    const rows = this.rows.filter((a) => a.ruleId === ruleId).sort((a, b) => b.accrualDate.localeCompare(a.accrualDate));
    const latest = rows[0];
    return latest ? { accrualDate: latest.accrualDate, carryAfter: normalizeScale(latest.carryAfter, 6) } : null;
  }

  async upsert(input: NewInterestAccrual): Promise<InterestAccrual> {
    const normalized: NewInterestAccrual = {
      ...input,
      balanceBasis: normalizeScale(input.balanceBasis, 2),
      gross: normalizeScale(input.gross, 6),
      tax: normalizeScale(input.tax, 6),
      net: normalizeScale(input.net, 2),
      carryAfter: normalizeScale(input.carryAfter, 6),
    };
    const index = this.rows.findIndex((a) => a.ruleId === normalized.ruleId && a.accrualDate === normalized.accrualDate);
    if (index === -1) {
      const row: InterestAccrual = { ...normalized, id: monotonicId() };
      this.rows.push(row);
      return { ...row };
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
      balanceBasis: normalized.balanceBasis,
      gross: normalized.gross,
      tax: normalized.tax,
      net: normalized.net,
      carryAfter: normalized.carryAfter,
    };
    this.rows[index] = updated;
    return { ...updated };
  }

  async markPosted(id: string, entryId: string, postedAt: Date): Promise<boolean> {
    const index = this.rows.findIndex((a) => a.id === id);
    if (index === -1) return false;
    this.rows[index] = { ...this.rows[index]!, postedAt, entryId };
    return true;
  }

  /**
   * Ruling P3-C39 (B2): the same atomic "claim, only if unclaimed" semantics
   * the Drizzle repository implements as a conditional `UPDATE ... WHERE
   * posted_at IS NULL RETURNING id`. Safe here without any locking of its
   * own: this fake is only ever driven by a single-threaded event loop, and
   * `find` + assign below never awaits in between, so no interleaving is
   * possible — the JS-level equivalent of the same guarantee the database
   * row gives production callers.
   */
  async claimForPosting(id: string, claimedAt: Date): Promise<boolean> {
    const index = this.rows.findIndex((a) => a.id === id);
    if (index === -1) return false;
    const row = this.rows[index]!;
    if (row.postedAt !== null) return false;
    this.rows[index] = { ...row, postedAt: claimedAt };
    return true;
  }

  async releaseClaim(id: string): Promise<void> {
    const index = this.rows.findIndex((a) => a.id === id);
    if (index === -1) return;
    const row = this.rows[index]!;
    if (row.entryId !== null) return; // never un-post a confirmed post
    this.rows[index] = { ...row, postedAt: null };
  }
}

/** In-memory stand-in for `DrizzleInterestEntriesRepository` (Task 16), used by unit tests. */
export class MemoryInterestEntriesRepository implements InterestEntriesRepository {
  private rows: InterestEntry[] = [];

  async listForRule(ruleId: string, kind?: InterestEntry["kind"]): Promise<InterestEntry[]> {
    return this.rows
      .filter((e) => e.ruleId === ruleId && (kind === undefined || e.kind === kind))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((e) => ({ ...e }));
  }

  async create(input: NewInterestEntry): Promise<InterestEntry> {
    const row: InterestEntry = { ...input, id: monotonicId() };
    this.rows.push(row);
    return { ...row };
  }
}
