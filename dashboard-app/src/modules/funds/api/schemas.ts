import { z } from "@hono/zod-openapi";

const money = /^-?\d{1,14}(\.\d{1,2})?$/;
const currency = /^[A-Z]{3}$/;

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

const DateSchema = z.string().refine(isRealDate, "Invalid calendar date");
const MonthSchema = DateSchema.refine((value) => value.endsWith("-01"), "Use the first day of a real month");
const MoneySchema = z.string().regex(money);

export const FundKindSchema = z.enum(["pension", "investment", "savings", "other"]).openapi("FundKind");
export const FundStatusSchema = z.enum(["active", "archived"]).openapi("FundStatus");
export const ContributionTypeSchema = z.enum(["employee", "employer", "voluntary", "adjustment", "reversal", "fee"]).openapi("FundContributionType");
export const ContributionSourceSchema = z.enum(["manual", "payroll", "system", "migration"]).openapi("FundContributionSource");
export const ReconciliationStatusSchema = z.enum(["expected", "received", "matched", "missing", "delayed", "duplicate", "anomalous"]).openapi("FundReconciliationStatus");

export const FundSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  kind: FundKindSchema,
  currency: z.string(),
  accountId: z.string().uuid().nullable(),
  status: FundStatusSchema,
  archivedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi("Fund");

export const FundSummarySchema = z.object({
  fund: FundSchema,
  value: MoneySchema.nullable(),
  valueAsOf: DateSchema.nullable(),
  deposited: MoneySchema,
  absReturn: MoneySchema.nullable(),
  lastContributionMonth: MonthSchema.nullable(),
  openIssues: z.number().int().nonnegative(),
}).openapi("FundSummary");

export const FundScheduleSchema = z.object({
  id: z.string().uuid(),
  fundId: z.string().uuid(),
  frequency: z.enum(["monthly", "quarterly", "annual"]),
  periodAnchorMonth: z.number().int().min(1).max(12),
  postingLagMonths: z.number().int().min(0).max(12),
  feePerPosting: MoneySchema,
  effectiveFrom: MonthSchema,
  createdAt: z.string(),
}).openapi("FundSchedule");

export const FundPlanSchema = z.object({
  id: z.string().uuid(),
  fundId: z.string().uuid(),
  effectiveFrom: MonthSchema,
  initialCapital: MoneySchema,
  fixedMonthlyAmount: MoneySchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
}).openapi("FundPlan");

export const FundContributionSchema = z.object({
  id: z.string().uuid(),
  fundId: z.string().uuid(),
  typeCode: ContributionTypeSchema,
  accrualPeriodStart: DateSchema,
  accrualPeriodEnd: DateSchema,
  postedMonth: MonthSchema,
  valueDate: DateSchema.nullable(),
  amount: MoneySchema,
  currency: z.string(),
  source: ContributionSourceSchema,
  payrollRecordId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  reversesId: z.string().uuid().nullable(),
  reconciliationStatus: ReconciliationStatusSchema,
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi("FundContribution");

export const ReconciliationIssueSchema = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  detail: z.record(z.string(), z.unknown()),
  status: z.enum(["open", "acknowledged", "resolved"]),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi("ReconciliationIssue");

export const FundQuarterSchema = z.object({
  quarter: z.string(),
  accrualMonths: z.array(MonthSchema),
  postedMonth: MonthSchema,
  gross: MoneySchema,
  fees: MoneySchema,
  net: MoneySchema,
  posted: z.boolean(),
}).openapi("FundQuarter");

export const FundValuePointSchema = z.object({
  month: MonthSchema,
  value: MoneySchema,
  deposited: MoneySchema,
}).openapi("FundValuePoint");

export const FundDetailSchema = FundSummarySchema.extend({
  plan: FundPlanSchema.nullable(),
  schedule: FundScheduleSchema.nullable(),
  plans: z.array(FundPlanSchema),
  schedules: z.array(FundScheduleSchema),
  contributions: z.array(FundContributionSchema),
  quarters: z.array(FundQuarterSchema),
  valueSeries: z.array(FundValuePointSchema),
  issues: z.array(ReconciliationIssueSchema),
}).openapi("FundDetail");

export const FundListResponseSchema = z.object({ items: z.array(FundSummarySchema) }).openapi("FundListResponse");
export const FundContributionsResponseSchema = z.object({
  items: z.array(FundContributionSchema),
  nextCursor: z.null(),
}).openapi("FundContributionsResponse");

export const CreateFundRequestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  kind: FundKindSchema,
  currency: z.string().regex(currency).optional(),
  accountId: z.string().uuid().nullable().optional(),
}).strict().openapi("CreateFundRequest");

export const UpdateFundRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: FundKindSchema.optional(),
  accountId: z.string().uuid().nullable().optional(),
  status: FundStatusSchema.optional(),
  version: z.number().int().min(1).optional(),
}).strict().openapi("UpdateFundRequest");

export const SetScheduleRequestSchema = z.object({
  frequency: z.enum(["monthly", "quarterly", "annual"]),
  periodAnchorMonth: z.number().int().min(1).max(12),
  postingLagMonths: z.number().int().min(0).max(12),
  feePerPosting: MoneySchema.refine((value) => !value.startsWith("-"), "Fee must be non-negative"),
  effectiveFrom: MonthSchema,
}).strict().openapi("SetScheduleRequest");

export const SetPlanRequestSchema = z.object({
  effectiveFrom: MonthSchema,
  initialCapital: MoneySchema.refine((value) => !value.startsWith("-"), "Initial capital must be non-negative"),
  fixedMonthlyAmount: MoneySchema.refine((value) => !value.startsWith("-"), "Monthly amount must be non-negative").nullable(),
  note: z.string().max(2000).nullable(),
}).strict().openapi("SetPlanRequest");

export const AddContributionRequestSchema = z.object({
  typeCode: z.enum(["employee", "employer", "voluntary", "adjustment", "fee"]),
  accrualMonth: MonthSchema,
  amount: z.string().regex(/^-?\d{1,14}(\.\d{1,2})?$/),
  valueDate: DateSchema.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  postedMonth: MonthSchema.optional(),
}).strict().openapi("AddContributionRequest");

export const ReverseContributionRequestSchema = z.object({
  note: z.string().max(2000).nullable().optional(),
}).strict().openapi("ReverseContributionRequest");

export const DetectedIssueSchema = z.object({
  kind: z.enum(["missing", "duplicate", "anomalous"]),
  entityType: z.enum(["fund_month", "fund_contribution"]),
  entityId: z.string(),
  severity: z.enum(["warning", "error"]),
  detail: z.record(z.string(), z.unknown()),
}).openapi("DetectedFundIssue");

export const ReconcileResultSchema = z.object({
  detected: z.array(DetectedIssueSchema),
  resolved: z.number().int().nonnegative(),
}).openapi("ReconcileFundResult");

export const FundIdParamSchema = z.object({ id: z.string().uuid() });
export const ContributionIdParamSchema = z.object({ id: z.string().uuid(), cid: z.string().uuid() });
export const IssueIdParamSchema = z.object({ issueId: z.string().uuid() });
export const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });
export const ListFundsQuerySchema = z.object({ includeArchived: z.enum(["true", "false"]).optional() }).strict();
export const ListContributionsQuerySchema = z.object({ from: MonthSchema.optional(), to: MonthSchema.optional() }).strict();
