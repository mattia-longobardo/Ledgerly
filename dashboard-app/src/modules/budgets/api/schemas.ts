import { z } from "@hono/zod-openapi";

/**
 * DTO and request Zod schemas for the budgets REST API. Dates are always
 * "YYYY-MM-DD" or ISO-8601 strings, money is always a decimal string — the
 * same wire rule the rest of the app's DTOs follow (see `@/lib/contracts`).
 *
 * `ErrorResponseSchema` is NOT declared here: it is imported from
 * `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
 * `.openapi("ErrorResponse")` registration.
 */

const MoneySchema = z.string().regex(/^-?\d{1,14}(\.\d{1,2})?$/, "Invalid money amount.");

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

const DateSchema = z.string().refine(isRealDate, "Invalid calendar date.");

export const BudgetStatusSchema = z.enum(["active", "archived"]).openapi("BudgetStatus");
export const BudgetPeriodKindSchema = z.enum(["none", "monthly", "quarterly", "annual", "custom"]).openapi("BudgetPeriodKind");
export const BudgetSourceKindSchema = z.enum(["fund", "account", "none"]).openapi("BudgetSourceKind");
export const BudgetRecurrenceSchema = z.enum(["once", "monthly"]).openapi("BudgetRecurrence");
export const BudgetScopeKindSchema = z.enum(["account", "category", "label", "fund"]).openapi("BudgetScopeKind");

export const BudgetSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    currency: z.string(),
    status: BudgetStatusSchema,
    periodKind: BudgetPeriodKindSchema,
    startDate: DateSchema,
    endDate: DateSchema.nullable(),
    goalAmount: MoneySchema.nullable(),
    labels: z.array(z.string()),
    archivedAt: z.string().nullable(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Budget");

export const BudgetFiguresSchema = z
  .object({
    initial: MoneySchema,
    allocated: MoneySchema,
    used: MoneySchema,
    remaining: MoneySchema,
    goalProgress: z.number().nullable(),
  })
  .openapi("BudgetFigures");

export const BudgetSummarySchema = z
  .object({
    budget: BudgetSchema,
    figures: BudgetFiguresSchema,
    asOf: DateSchema,
  })
  .openapi("BudgetSummary");

export const AllocationSchema = z
  .object({
    id: z.string().uuid(),
    budgetId: z.string().uuid(),
    sourceKind: BudgetSourceKindSchema,
    sourceId: z.string().uuid().nullable(),
    amount: MoneySchema,
    recurrence: BudgetRecurrenceSchema,
    effectiveFrom: DateSchema,
    effectiveTo: DateSchema.nullable(),
    note: z.string().nullable(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("BudgetAllocation");

export const AllocationViewSchema = AllocationSchema.extend({
  sourceLabel: z.string().nullable(),
  availableInSource: MoneySchema.nullable(),
}).openapi("BudgetAllocationView");

export const ScopeSchema = z
  .object({
    id: z.string().uuid(),
    budgetId: z.string().uuid(),
    kind: BudgetScopeKindSchema,
    refId: z.string().uuid(),
  })
  .openapi("BudgetScope");

export const UsageSchema = z
  .object({
    id: z.string().uuid(),
    budgetId: z.string().uuid(),
    transactionId: z.string().uuid().nullable(),
    amount: MoneySchema,
    occurredAt: DateSchema,
    matchedBy: z.enum(["scope", "manual"]),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("BudgetUsage");

export const AmountVersionSchema = z
  .object({
    id: z.string().uuid(),
    budgetId: z.string().uuid(),
    initialAmount: MoneySchema,
    effectiveFrom: DateSchema,
    reason: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("BudgetAmountVersion");

export const BudgetEventSchema = z
  .object({
    id: z.string().uuid(),
    budgetId: z.string().uuid(),
    kind: z.string(),
    detail: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi("BudgetEvent");

export const BudgetSeriesPointSchema = z.object({ month: z.string(), remaining: MoneySchema }).openapi("BudgetSeriesPoint");

export const BudgetDetailSchema = BudgetSummarySchema.extend({
  versions: z.array(AmountVersionSchema),
  allocations: z.array(AllocationViewSchema),
  scopes: z.array(ScopeSchema),
  usages: z.array(UsageSchema),
  events: z.array(BudgetEventSchema),
  series: z.array(BudgetSeriesPointSchema),
}).openapi("BudgetDetail");

export const BudgetListResponseSchema = z.object({ items: z.array(BudgetSummarySchema) }).openapi("BudgetListResponse");
export const ScopesResponseSchema = z.object({ items: z.array(ScopeSchema) }).openapi("BudgetScopesResponse");

export const RefreshUsagesResultSchema = z
  .object({
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
  })
  .openapi("RefreshUsagesResult");

// ---- Request bodies ----

export const CreateBudgetRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    periodKind: BudgetPeriodKindSchema,
    startDate: DateSchema,
    endDate: DateSchema.nullable(),
    goalAmount: MoneySchema.nullable(),
    labels: z.array(z.string()),
    initialAmount: MoneySchema,
  })
  .strict()
  .openapi("CreateBudgetRequest");

/**
 * `updateBudget`'s use-case patch schema is `.strict()` and deliberately
 * does not declare `archivedAt` — that field is set only by the use case's
 * own `status === "archived"` branch, never by a caller. This wire schema
 * mirrors that: no `archivedAt` field, so a client that sends one gets a
 * clean `422` at the wire boundary rather than it silently being ignored or
 * (were the use-case schema not `.strict()`) desyncing `status` from
 * `archivedAt`. `version` is carried for the body-`version` fallback to
 * `If-Match` and the route strips it before building the patch — see
 * `routes.ts`.
 */
export const UpdateBudgetRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    periodKind: BudgetPeriodKindSchema.optional(),
    startDate: DateSchema.optional(),
    endDate: DateSchema.nullable().optional(),
    goalAmount: MoneySchema.nullable().optional(),
    labels: z.array(z.string()).optional(),
    status: BudgetStatusSchema.optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .openapi("UpdateBudgetRequest");

export const SetInitialAmountRequestSchema = z
  .object({
    initialAmount: MoneySchema,
    effectiveFrom: DateSchema,
    reason: z.string().nullable().optional(),
  })
  .strict()
  .openapi("SetInitialAmountRequest");

export const AddAllocationRequestSchema = z
  .object({
    sourceKind: BudgetSourceKindSchema,
    sourceId: z.string().uuid().nullable().optional(),
    amount: MoneySchema,
    recurrence: BudgetRecurrenceSchema,
    effectiveFrom: DateSchema,
    effectiveTo: DateSchema.nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict()
  .openapi("AddAllocationRequest");

export const EndAllocationRequestSchema = z
  .object({
    effectiveTo: DateSchema,
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .openapi("EndAllocationRequest");

export const SetScopesRequestSchema = z
  .array(z.object({ kind: BudgetScopeKindSchema, refId: z.string().uuid() }).strict())
  .openapi("SetScopesRequest");

export const AddManualUsageRequestSchema = z
  .object({
    amount: MoneySchema,
    occurredAt: DateSchema,
    note: z.string().nullable().optional(),
  })
  .strict()
  .openapi("AddManualUsageRequest");

// ---- Params, query and headers ----

export const BudgetIdParamSchema = z.object({ id: z.string().uuid() });
export const AllocationIdParamSchema = z.object({ id: z.string().uuid(), aid: z.string().uuid() });
export const UsageIdParamSchema = z.object({ id: z.string().uuid(), uid: z.string().uuid() });
export const ListBudgetsQuerySchema = z.object({ includeArchived: z.enum(["true", "false"]).optional() }).strict();
export const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });
