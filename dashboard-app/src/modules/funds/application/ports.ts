import type { AuditInput } from "@/platform/audit/record";

export type FundKind = "pension" | "investment" | "savings" | "other";
export type FundStatus = "active" | "archived";
export type ContributionTypeCode = "employee" | "employer" | "voluntary" | "adjustment" | "reversal" | "fee";
export type ContributionSource = "manual" | "payroll" | "system" | "migration";
export type ReconciliationStatus = "expected" | "received" | "matched" | "missing" | "delayed" | "duplicate" | "anomalous";

export interface Fund {
  id: string;
  userId: string;
  slug: string;
  name: string;
  kind: FundKind;
  currency: string;
  accountId: string | null;
  status: FundStatus;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewFund = Pick<Fund, "userId" | "slug" | "name" | "kind" | "currency" | "accountId">;
export type FundPatch = Partial<Pick<Fund, "name" | "kind" | "accountId" | "status" | "archivedAt">>;

export interface FundSchedule {
  id: string;
  fundId: string;
  frequency: "monthly" | "quarterly" | "annual";
  periodAnchorMonth: number;
  postingLagMonths: number;
  feePerPosting: string;
  effectiveFrom: string;
  createdAt: Date;
}

export interface FundPlan {
  id: string;
  fundId: string;
  effectiveFrom: string;
  initialCapital: string;
  fixedMonthlyAmount: string | null;
  note: string | null;
  createdAt: Date;
}

export interface FundContribution {
  id: string;
  fundId: string;
  typeCode: ContributionTypeCode;
  accrualPeriodStart: string;
  accrualPeriodEnd: string;
  postedMonth: string;
  valueDate: string | null;
  amount: string;
  currency: string;
  source: ContributionSource;
  payrollRecordId: string | null;
  note: string | null;
  reversesId: string | null;
  reconciliationStatus: ReconciliationStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewFundContribution = Omit<FundContribution, "id" | "version" | "createdAt" | "updatedAt">;

export interface ReconciliationIssue {
  id: string;
  userId: string;
  domain: string;
  entityType: string;
  entityId: string;
  kind: string;
  severity: "info" | "warning" | "error";
  detail: Record<string, unknown>;
  status: "open" | "acknowledged" | "resolved";
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FundsRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Fund[]>;
  get(userId: string, id: string): Promise<Fund | null>;
  lock(userId: string, id: string): Promise<Fund | null>;
  getBySlug(userId: string, slug: string): Promise<Fund | null>;
  create(input: NewFund): Promise<Fund>;
  update(userId: string, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund | null>;
}

export interface SchedulesRepository {
  listForFund(fundId: string): Promise<FundSchedule[]>;
  add(input: Omit<FundSchedule, "id" | "createdAt">): Promise<FundSchedule>;
}

export interface PlansRepository {
  listForFund(fundId: string): Promise<FundPlan[]>;
  add(input: Omit<FundPlan, "id" | "createdAt">): Promise<FundPlan>;
}

export interface ContributionsRepository {
  listForFund(fundId: string, opts?: { from?: string; to?: string }): Promise<FundContribution[]>;
  get(fundId: string, id: string): Promise<FundContribution | null>;
  create(input: NewFundContribution): Promise<FundContribution>;
  deleteByPayrollRecord(fundId: string, payrollRecordId: string): Promise<number>;
  deleteByPayrollRecords(fundId: string, payrollRecordIds: readonly string[]): Promise<{ deleted: number; postedMonths: string[] }>;
  /** Removes an ineligible system fee and any reversal that references it. */
  deleteOrphanSystemFee(fundId: string, postedMonth: string): Promise<number>;
  hasSystemFee(fundId: string, postedMonth: string): Promise<boolean>;
}

/**
 * Filters for the cross-domain issue list. `domain` is a filter rather than a
 * required argument because `reconciliation_issues` is not the funds module's
 * private table — `funds`, and whatever writes issues next, all land in it, and
 * the management list has to be able to show the lot.
 */
export interface ListIssuesOptions {
  domain?: string;
  status?: ReconciliationIssue["status"];
  severity?: ReconciliationIssue["severity"];
  cursor?: string | null;
  limit?: number;
}

export interface ListIssuesPage {
  items: ReconciliationIssue[];
  nextCursor: string | null;
}

export interface IssuesRepository {
  /** Newest first (`created_at desc, id desc`), keyset-paged on the last item's id. */
  list(userId: string, opts: ListIssuesOptions): Promise<ListIssuesPage>;
  /** One issue of the caller's, whatever its status — `listOpen` cannot see a resolved one. */
  get(userId: string, id: string): Promise<ReconciliationIssue | null>;
  listOpen(userId: string, domain: string, entityIdPrefix?: string): Promise<ReconciliationIssue[]>;
  upsertOpen(input: Pick<ReconciliationIssue, "userId" | "domain" | "entityType" | "entityId" | "kind" | "severity" | "detail">): Promise<ReconciliationIssue>;
  resolveMissing(userId: string, domain: string, entityIdPrefix: string, keep: readonly { entityType: string; entityId: string; kind: string }[], by: string | null, at: Date): Promise<number>;
  setStatus(userId: string, id: string, status: "acknowledged" | "resolved", by: string, at: Date): Promise<ReconciliationIssue | null>;
}

export interface ValuationSource {
  latest(userId: string, accountId: string): Promise<{ asOf: string; balance: string } | null>;
  monthly(userId: string, accountId: string): Promise<{ month: string; balance: string }[]>;
}

export interface PayrollMonthsSource {
  liveMonths(userId: string): Promise<string[]>;
  liveRecords(userId: string, includeExtraordinary?: boolean): Promise<{ id: string; month: string }[]>;
  expectedMonths(userId: string, fundSlug: string): Promise<string[]>;
}

export interface AccountLinkSource {
  get(userId: string, accountId: string): Promise<{ currency: string } | null>;
}

export interface Clock { now(): Date }

export interface UseCaseDeps {
  accountLinks: AccountLinkSource;
  funds: FundsRepository;
  schedules: SchedulesRepository;
  plans: PlansRepository;
  contributions: ContributionsRepository;
  issues: IssuesRepository;
  valuations: ValuationSource;
  payrollMonths: PayrollMonthsSource;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
