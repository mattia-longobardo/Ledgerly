import { z } from "@hono/zod-openapi";

export const DayCountSchema = z.union([z.literal(360), z.literal(365), z.literal("actual")]).openapi("DayCount");
export const CompoundingSchema = z.enum(["simple_daily", "monthly", "none"]).openapi("Compounding");
export const PostingModeSchema = z.enum(["analyze_only", "post_to_provider"]).openapi("PostingMode");

export const InterestRuleSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    annualRate: z.string(),
    taxRate: z.string(),
    dayCount: DayCountSchema,
    compounding: CompoundingSchema,
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
    postingMode: PostingModeSchema,
    providerCategoryRef: z.string().nullable(),
    noteMarker: z.string(),
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("InterestRule");

export const InterestAccrualSchema = z
  .object({
    id: z.string().uuid(),
    accrualDate: z.string(),
    balanceBasis: z.string(),
    gross: z.string(),
    tax: z.string(),
    net: z.string(),
    carryAfter: z.string(),
    postedAt: z.string().nullable(),
  })
  .openapi("InterestAccrual");

export const InterestEntrySchema = z
  .object({
    id: z.string().uuid(),
    occurredAt: z.string(),
    gross: z.string(),
    net: z.string(),
    kind: z.enum(["paid", "projected", "adjustment"]),
    source: z.enum(["computed", "provider", "manual"]),
  })
  .openapi("InterestEntry");

/**
 * `no_data` is a fifth, distinct status from `reconcileInterest` (domain,
 * Task 14's review): an empty accrual list for the period, not evidence that
 * nothing was owed. Omitting it here would let a legitimate "no accrual rows
 * yet" result get serialized as `undefined` past this schema's enum check
 * (or fail response validation) instead of being carried through honestly —
 * exactly what global constraint #7 warns against.
 *
 * `indeterminate` is a sixth (Ruling P3-C39, B2): at least one accrual in
 * the period is claimed-but-unconfirmed — `postedAt` set, `entryId` still
 * null, the signature of a crash between a successful Wallet POST and the
 * local confirm write. Same rationale as `no_data`: omitting it would fail
 * response validation (or silently misreport) the exact period where an
 * operator most needs an honest signal that money may already be at Wallet.
 */
export const ReconciliationSummarySchema = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    accruedTotal: z.string(),
    paidTotal: z.string(),
    status: z.enum(["matched", "missing", "delayed", "anomalous", "no_data", "indeterminate"]),
    differenceCents: z.number(),
  })
  .openapi("ReconciliationSummary");

export const ProjectionPointSchema = z.object({ date: z.string(), net: z.string(), cumulativeNet: z.string() }).openapi("ProjectionPoint");

export const InterestRuleDetailSchema = InterestRuleSchema.extend({
  accruals: z.array(InterestAccrualSchema),
  entries: z.array(InterestEntrySchema),
  reconciliation: ReconciliationSummarySchema,
  projection: z.array(ProjectionPointSchema),
}).openapi("InterestRuleDetail");

export const InterestRuleListResponseSchema = z.object({ items: z.array(InterestRuleSchema) }).openapi("InterestRuleListResponse");

export const CreateInterestRuleRequestSchema = z.object({
  accountId: z.string().uuid(),
  annualRate: z.string(),
  taxRate: z.string(),
  dayCount: DayCountSchema,
  compounding: CompoundingSchema.optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  postingMode: PostingModeSchema.optional(),
  providerCategoryRef: z.string().nullable().optional(),
  noteMarker: z.string().optional(),
});

export const UpdateInterestRuleRequestSchema = z.object({
  annualRate: z.string().optional(),
  taxRate: z.string().optional(),
  dayCount: DayCountSchema.optional(),
  compounding: CompoundingSchema.optional(),
  effectiveTo: z.string().nullable().optional(),
  postingMode: PostingModeSchema.optional(),
  providerCategoryRef: z.string().nullable().optional(),
  noteMarker: z.string().optional(),
  version: z.number().int().optional(),
});

export const GetRuleDetailQuerySchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  projectionDays: z.coerce.number().int().min(1).max(365).optional(),
});

// `ErrorResponseSchema` itself is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration — see the corrected Ruling P3-11.
