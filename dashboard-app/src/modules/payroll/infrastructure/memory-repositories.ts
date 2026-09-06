import { DEFAULT_MAPPING_RULES } from "../domain/mapping";
import type {
  ListImportsOptions,
  ListRecordsOptions,
  NewPayrollComponent,
  NewPayrollImport,
  NewPayrollRecord,
  PayrollComponent,
  PayrollComponentsRepository,
  PayrollImport,
  PayrollImportPatch,
  PayrollImportStatus,
  PayrollImportsRepository,
  PayrollMappingRule,
  PayrollMappingRulesRepository,
  PayrollRecord,
  PayrollRecordKind,
  PayrollRecordsRepository,
} from "../application/ports";
import { TERMINAL_STATUSES } from "../domain/payroll";

/**
 * Production ids default to `uuidv7()`, which is time-ordered. This generator
 * is not a real UUIDv7, only order-compatible with one — the same mitigation
 * `interests/infrastructure/memory-repositories.ts` uses, so a `desc(id)`
 * tie-break behaves identically under the fake and under Postgres.
 */
let sequence = 0;
function monotonicId(): string {
  sequence += 1;
  return `${Date.now().toString(16).padStart(12, "0")}-${sequence.toString(16).padStart(8, "0")}`;
}

/** Strips explicit `undefined` so a spread cannot null out a field the caller never meant to touch — Drizzle's `mapUpdateSet` drops them too. */
function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Mirrors the scale Postgres reads back for `numeric(16,2)` and
 * `numeric(16,6)`. Without it a string-comparing test passes against the fake
 * and fails against Drizzle — one of the five drifts the global constraints
 * record. A regex, never `Number()`.
 */
function normalizeScale(value: string, scale: number): string {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, fracPart = ""] = m;
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

export class MemoryPayrollImportsRepository implements PayrollImportsRepository {
  private rows: PayrollImport[] = [];

  async list(userId: string, opts: ListImportsOptions = {}): Promise<PayrollImport[]> {
    let rows = this.rows.filter((r) => r.userId === userId);
    if (opts.statuses) rows = rows.filter((r) => opts.statuses!.includes(r.status));
    // `created_at desc, id desc` — the Drizzle repository's exact order.
    rows = [...rows].sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
    return (opts.limit === undefined ? rows : rows.slice(0, opts.limit)).map((r) => ({ ...r }));
  }

  async get(userId: string, id: string): Promise<PayrollImport | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return row ? { ...row } : null;
  }

  async findBySha(userId: string, sha256: string): Promise<PayrollImport | null> {
    const row = this.rows.find((r) => r.userId === userId && r.sha256 === sha256);
    return row ? { ...row } : null;
  }

  async create(input: NewPayrollImport): Promise<PayrollImport> {
    // The database's two unique indexes, reproduced by name so a test that
    // asserts on the message passes identically against both implementations.
    if (this.rows.some((r) => r.userId === input.userId && r.sha256 === input.sha256)) {
      throw new Error('duplicate key value violates unique constraint "payroll_imports_user_sha_uq"');
    }
    if (
      input.idempotencyKey !== null &&
      this.rows.some((r) => r.userId === input.userId && r.idempotencyKey === input.idempotencyKey)
    ) {
      throw new Error('duplicate key value violates unique constraint "payroll_imports_user_idem_uq"');
    }
    const now = new Date();
    const row: PayrollImport = {
      ...input,
      id: monotonicId(),
      status: "received",
      pages: null,
      textSource: null,
      parserVersion: null,
      extraction: null,
      confidence: null,
      scanStatus: "pending",
      scanner: null,
      scanSignature: null,
      scannedAt: null,
      error: null,
      purgedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    const updated: PayrollImport = {
      ...current,
      ...definedEntries(patch),
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return { ...updated };
  }

  async listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]> {
    // Least-recently-updated first, matching the Drizzle repository (Finding
    // 8) — a stuck row `payroll-ingest.ts` keeps failing gets an `error`-only
    // patch that bumps `updated_at`, which sorts it to the back of the next
    // selection instead of camping at the front on an unchanging `created_at`.
    return this.rows
      .filter((r) => statuses.includes(r.status))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]> {
    return this.rows
      .filter(
        (r) =>
          (TERMINAL_STATUSES as readonly string[]).includes(r.status) &&
          r.storageKey !== null &&
          r.retentionUntil.getTime() < before.getTime(),
      )
      .sort((a, b) => a.retentionUntil.getTime() - b.retentionUntil.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}

export class MemoryPayrollRecordsRepository implements PayrollRecordsRepository {
  private rows: PayrollRecord[] = [];

  async list(userId: string, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> {
    let rows = this.rows.filter((r) => r.userId === userId);
    if (!opts.includeSuperseded) rows = rows.filter((r) => r.supersededAt === null);
    if (opts.from) rows = rows.filter((r) => r.periodStart >= opts.from!);
    if (opts.to) rows = rows.filter((r) => r.periodStart <= opts.to!);
    return [...rows]
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.id.localeCompare(a.id))
      .map((r) => ({ ...r }));
  }

  async get(userId: string, id: string): Promise<PayrollRecord | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return row ? { ...row } : null;
  }

  async getByImport(userId: string, importId: string): Promise<PayrollRecord | null> {
    const row = this.rows.find((r) => r.userId === userId && r.importId === importId);
    return row ? { ...row } : null;
  }

  async liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null> {
    const row = this.rows.find(
      (r) => r.userId === userId && r.periodStart === periodStart && r.kind === kind && r.supersededAt === null,
    );
    return row ? { ...row } : null;
  }

  async create(input: NewPayrollRecord): Promise<PayrollRecord> {
    if (this.rows.some((r) => r.importId === input.importId)) {
      throw new Error('duplicate key value violates unique constraint "payroll_records_import_uq"');
    }
    if (
      this.rows.some(
        (r) =>
          r.userId === input.userId &&
          r.periodStart === input.periodStart &&
          r.kind === input.kind &&
          r.supersededAt === null,
      )
    ) {
      throw new Error('duplicate key value violates unique constraint "payroll_records_period_uq"');
    }
    const now = new Date();
    const row: PayrollRecord = {
      ...input,
      gross: input.gross === null ? null : normalizeScale(input.gross, 2),
      net: input.net === null ? null : normalizeScale(input.net, 2),
      id: monotonicId(),
      supersededAt: null,
      supersededByRecordId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>,
  ): Promise<PayrollRecord | null> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    const defined = definedEntries(patch);
    const updated: PayrollRecord = {
      ...current,
      ...defined,
      ...(defined.gross !== undefined ? { gross: defined.gross === null ? null : normalizeScale(defined.gross, 2) } : {}),
      ...(defined.net !== undefined ? { net: defined.net === null ? null : normalizeScale(defined.net, 2) } : {}),
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return { ...updated };
  }

  async supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void> {
    const index = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (index === -1) return;
    this.rows[index] = {
      ...this.rows[index]!,
      supersededAt: at,
      supersededByRecordId: bySupersedingRecordId,
      updatedAt: at,
    };
  }
}

export class MemoryPayrollComponentsRepository implements PayrollComponentsRepository {
  private rows: PayrollComponent[] = [];

  async listForRecord(recordId: string): Promise<PayrollComponent[]> {
    return this.rows
      .filter((c) => c.recordId === recordId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((c) => ({ ...c }));
  }

  async listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]> {
    if (recordIds.length === 0) return [];
    const wanted = new Set(recordIds);
    return this.rows
      .filter((c) => wanted.has(c.recordId))
      .sort((a, b) => a.recordId.localeCompare(b.recordId) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((c) => ({ ...c }));
  }

  async replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]> {
    this.rows = this.rows.filter((c) => c.recordId !== recordId);
    const now = new Date();
    for (const input of components) {
      this.rows.push({
        ...input,
        // The domain builds components with an empty `recordId` because it does
        // not know it; the repository owns the record and stamps it here. Both
        // implementations do this, so a caller never has to.
        recordId,
        amount: input.amount === null ? null : normalizeScale(input.amount, 2),
        quantity: input.quantity === null ? null : normalizeScale(input.quantity, 6),
        id: monotonicId(),
        createdAt: now,
      });
    }
    return this.listForRecord(recordId);
  }
}

export class MemoryPayrollMappingRulesRepository implements PayrollMappingRulesRepository {
  private userRules: PayrollMappingRule[] = [];
  private readonly globals: PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((r, i) => ({
    ...r,
    id: `global-${String(i).padStart(3, "0")}`,
    userId: null,
  }));

  /** Test-only seam: production user rules come from the database. */
  addUserRule(userId: string, rule: Omit<PayrollMappingRule, "id" | "userId">): void {
    this.userRules.push({ ...rule, id: `user-${String(this.userRules.length).padStart(3, "0")}`, userId });
  }

  async listFor(userId: string): Promise<PayrollMappingRule[]> {
    return [...this.globals, ...this.userRules.filter((r) => r.userId === userId)]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }
}
