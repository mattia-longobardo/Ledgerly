import { VersionMismatchError } from "../application/errors";
import type {
  ContributionsRepository,
  Fund,
  FundContribution,
  FundPatch,
  FundPlan,
  FundSchedule,
  FundsRepository,
  IssuesRepository,
  NewFund,
  NewFundContribution,
  PlansRepository,
  ReconciliationIssue,
  SchedulesRepository,
} from "../application/ports";

let sequence = 0;
function monotonicId(): string {
  sequence += 1;
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const seq = sequence.toString(16).padStart(8, "0");
  return `${timestamp}-${seq}`;
}

function definedEntries<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
function normalizeScale(value: string, scale: number): string {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) return value;
  const [, sign, integer, fraction = ""] = match;
  const normalizedFraction = (fraction + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${integer}.${normalizedFraction}` : `${sign}${integer}`;
}

function cloneIssue(row: ReconciliationIssue): ReconciliationIssue {
  return { ...row, detail: { ...row.detail } };
}

function uniqueViolation(name: string): Error {
  return new Error(`Unique constraint violated: ${name}`);
}

export class MemoryFundsRepository implements FundsRepository {
  private rows: Fund[] = [];

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Fund[]> {
    return this.rows
      .filter((row) => row.userId === userId && (opts?.includeArchived || row.status !== "archived"))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async get(userId: string, id: string): Promise<Fund | null> {
    const row = this.rows.find((candidate) => candidate.userId === userId && candidate.id === id);
    return row ? { ...row } : null;
  }

  async lock(userId: string, id: string): Promise<Fund | null> {
    return this.get(userId, id);
  }

  async getBySlug(userId: string, slug: string): Promise<Fund | null> {
    const row = this.rows.find((candidate) => candidate.userId === userId && candidate.slug === slug);
    return row ? { ...row } : null;
  }

  async create(input: NewFund): Promise<Fund> {
    if (this.rows.some((row) => row.userId === input.userId && row.slug === input.slug)) {
      throw uniqueViolation("funds_user_slug_uq");
    }
    const now = new Date();
    const row: Fund = { ...input, id: monotonicId(), status: "active", archivedAt: null, version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
  }

  async update(userId: string, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund | null> {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index === -1) return null;
    const current = this.rows[index]!;
    if (current.version !== expectedVersion) throw new VersionMismatchError();
    const updated: Fund = { ...current, ...definedEntries(patch), version: current.version + 1, updatedAt: new Date() };
    this.rows[index] = updated;
    return { ...updated };
  }
}

export class MemorySchedulesRepository implements SchedulesRepository {
  private rows: FundSchedule[] = [];

  async listForFund(fundId: string): Promise<FundSchedule[]> {
    return this.rows
      .filter((row) => row.fundId === fundId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async add(input: Omit<FundSchedule, "id" | "createdAt">): Promise<FundSchedule> {
    const normalized = { ...input, feePerPosting: normalizeScale(input.feePerPosting, 2) };
    const index = this.rows.findIndex((row) => row.fundId === input.fundId && row.effectiveFrom === input.effectiveFrom);
    if (index >= 0) {
      const updated = { ...this.rows[index]!, ...normalized };
      this.rows[index] = updated;
      return { ...updated };
    }
    const row: FundSchedule = { ...normalized, id: monotonicId(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

export class MemoryPlansRepository implements PlansRepository {
  private rows: FundPlan[] = [];

  async listForFund(fundId: string): Promise<FundPlan[]> {
    return this.rows
      .filter((row) => row.fundId === fundId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async add(input: Omit<FundPlan, "id" | "createdAt">): Promise<FundPlan> {
    const normalized = {
      ...input,
      initialCapital: normalizeScale(input.initialCapital, 2),
      fixedMonthlyAmount: input.fixedMonthlyAmount === null ? null : normalizeScale(input.fixedMonthlyAmount, 2),
    };
    const index = this.rows.findIndex((row) => row.fundId === input.fundId && row.effectiveFrom === input.effectiveFrom);
    if (index >= 0) {
      const updated = { ...this.rows[index]!, ...normalized };
      this.rows[index] = updated;
      return { ...updated };
    }
    const row: FundPlan = { ...normalized, id: monotonicId(), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

export class MemoryContributionsRepository implements ContributionsRepository {
  private rows: FundContribution[] = [];

  async listForFund(fundId: string, opts?: { from?: string; to?: string }): Promise<FundContribution[]> {
    return this.rows
      .filter((row) => row.fundId === fundId && (!opts?.from || row.postedMonth >= opts.from) && (!opts?.to || row.postedMonth <= opts.to))
      .sort((a, b) => a.accrualPeriodStart.localeCompare(b.accrualPeriodStart) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async get(fundId: string, id: string): Promise<FundContribution | null> {
    const row = this.rows.find((candidate) => candidate.fundId === fundId && candidate.id === id);
    return row ? { ...row } : null;
  }

  async create(input: NewFundContribution): Promise<FundContribution> {
    if (input.payrollRecordId !== null && this.rows.some((row) => row.fundId === input.fundId && row.typeCode === input.typeCode && row.payrollRecordId === input.payrollRecordId)) {
      throw uniqueViolation("fund_contributions_payroll_uq");
    }
    if (input.typeCode === "fee" && input.source === "system" && this.rows.some((row) => row.fundId === input.fundId && row.postedMonth === input.postedMonth && row.typeCode === "fee" && row.source === "system")) {
      throw uniqueViolation("fund_contributions_system_fee_uq");
    }
    const now = new Date();
    const row: FundContribution = { ...input, amount: normalizeScale(input.amount, 2), id: monotonicId(), version: 1, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
  }

  async deleteByPayrollRecord(fundId: string, payrollRecordId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.fundId !== fundId || row.payrollRecordId !== payrollRecordId);
    return before - this.rows.length;
  }

  async hasSystemFee(fundId: string, postedMonth: string): Promise<boolean> {
    return this.rows.some((row) => row.fundId === fundId && row.postedMonth === postedMonth && row.typeCode === "fee" && row.source === "system");
  }
}

type NewIssue = Pick<ReconciliationIssue, "userId" | "domain" | "entityType" | "entityId" | "kind" | "severity" | "detail">;

export class MemoryIssuesRepository implements IssuesRepository {
  private rows: ReconciliationIssue[] = [];

  async listOpen(userId: string, domain: string, entityIdPrefix?: string): Promise<ReconciliationIssue[]> {
    return this.rows
      .filter((row) => row.userId === userId && row.domain === domain && row.status !== "resolved" && (!entityIdPrefix || row.entityId.startsWith(entityIdPrefix)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(cloneIssue);
  }

  async upsertOpen(input: NewIssue): Promise<ReconciliationIssue> {
    const index = this.rows.findIndex((row) => row.userId === input.userId && row.domain === input.domain && row.entityType === input.entityType && row.entityId === input.entityId && row.kind === input.kind && row.status !== "resolved");
    if (index >= 0) {
      const updated = { ...this.rows[index]!, severity: input.severity, detail: { ...input.detail }, updatedAt: new Date() };
      this.rows[index] = updated;
      return cloneIssue(updated);
    }
    const now = new Date();
    const row: ReconciliationIssue = { ...input, detail: { ...input.detail }, id: monotonicId(), status: "open", resolvedBy: null, resolvedAt: null, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return cloneIssue(row);
  }

  async resolveMissing(userId: string, domain: string, entityIdPrefix: string, keep: readonly { entityType: string; entityId: string; kind: string }[], by: string | null, at: Date): Promise<number> {
    const keepKeys = new Set(keep.map((item) => `${item.entityType}\u0000${item.entityId}\u0000${item.kind}`));
    let count = 0;
    this.rows = this.rows.map((row) => {
      const key = `${row.entityType}\u0000${row.entityId}\u0000${row.kind}`;
      if (row.userId !== userId || row.domain !== domain || row.status === "resolved" || !row.entityId.startsWith(entityIdPrefix) || keepKeys.has(key)) return row;
      count += 1;
      return { ...row, status: "resolved", resolvedBy: by, resolvedAt: at, updatedAt: at };
    });
    return count;
  }

  async setStatus(userId: string, id: string, status: "acknowledged" | "resolved", by: string, at: Date): Promise<ReconciliationIssue | null> {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index === -1) return null;
    const row = this.rows[index]!;
    const updated: ReconciliationIssue = {
      ...row,
      status,
      resolvedBy: status === "resolved" ? by : null,
      resolvedAt: status === "resolved" ? at : null,
      updatedAt: at,
    };
    this.rows[index] = updated;
    return cloneIssue(updated);
  }
}
