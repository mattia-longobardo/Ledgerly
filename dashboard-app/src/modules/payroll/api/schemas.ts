import { z } from "@hono/zod-openapi";

export const PayrollImportStatusSchema = z
  .enum([
    "received", "scanning", "needs_ocr", "extracting", "parsed",
    "needs_review", "verified", "applied", "rejected", "superseded", "failed",
  ])
  .openapi("PayrollImportStatus");

export const ScanStatusSchema = z.enum(["pending", "clean", "infected", "unavailable"]).openapi("ScanStatus");
export const TextSourceSchema = z.enum(["pdf_text", "ocr", "none"]).openapi("PayrollTextSource");
export const PayrollRecordKindSchema = z
  .enum(["ordinary", "thirteenth", "fourteenth", "bonus", "settlement"])
  .openapi("PayrollRecordKind");
export const PayrollComponentKindSchema = z
  .enum([
    "earning", "deduction", "tax", "employer_contribution", "employee_contribution",
    "reimbursement", "allowance", "bonus", "leave_balance", "leave_used", "leave_accrued", "info",
  ])
  .openapi("PayrollComponentKind");

/**
 * `storageKey` is deliberately absent: it is the unguessable object key
 * (Ruling R4-1), and a client that learns it learns where the bytes live. The
 * bytes are only ever reachable through the audited `/original` route.
 */
export const PayrollImportSchema = z
  .object({
    id: z.string().uuid(),
    status: PayrollImportStatusSchema,
    fileName: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    storageProvider: z.enum(["silo", "local"]),
    pages: z.number().int().nullable(),
    textSource: TextSourceSchema.nullable(),
    parserVersion: z.string().nullable(),
    scanStatus: ScanStatusSchema,
    scanner: z.string().nullable(),
    scannedAt: z.string().nullable(),
    error: z.string().nullable(),
    replacesImportId: z.string().uuid().nullable(),
    retentionUntil: z.string(),
    purgedAt: z.string().nullable(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PayrollImport");

export const PayrollImportDetailSchema = PayrollImportSchema.extend({
  extraction: z.unknown().nullable(),
  confidence: z.record(z.string(), z.enum(["high", "medium", "low"])).nullable(),
}).openapi("PayrollImportDetail");

export const PayrollImportListResponseSchema = z
  .object({ items: z.array(PayrollImportSchema) })
  .openapi("PayrollImportListResponse");

export const PayrollComponentSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    /** The payslip's own Italian text, carried through as data (spec §2.9). */
    labelRaw: z.string(),
    kind: PayrollComponentKindSchema,
    amount: z.string().nullable(),
    quantity: z.string().nullable(),
    unit: z.enum(["hours", "days", "eur"]).nullable(),
    currency: z.string(),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    source: z.enum(["rules", "llm", "manual"]),
    mappedTo: z.unknown().nullable(),
    sortOrder: z.number().int(),
  })
  .openapi("PayrollComponent");

export const PayrollRecordSchema = z
  .object({
    id: z.string().uuid(),
    importId: z.string().uuid(),
    periodStart: z.string(),
    periodEnd: z.string(),
    payDate: z.string().nullable(),
    kind: PayrollRecordKindSchema,
    currency: z.string(),
    gross: z.string().nullable(),
    net: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    supersededAt: z.string().nullable(),
    supersededByRecordId: z.string().uuid().nullable(),
    version: z.number().int(),
  })
  .openapi("PayrollRecord");

export const PayrollRecordListResponseSchema = z
  .object({ items: z.array(PayrollRecordSchema) })
  .openapi("PayrollRecordListResponse");

export const PayrollRecordDetailSchema = PayrollRecordSchema.extend({
  components: z.array(PayrollComponentSchema),
}).openapi("PayrollRecordDetail");

export const EarningsBucketSchema = z
  .object({
    key: z.string(),
    gross: z.string().nullable(),
    net: z.string().nullable(),
    taxes: z.string().nullable(),
    contributions: z.string().nullable(),
    recordCount: z.number().int(),
  })
  .openapi("EarningsBucket");

export const EarningsSummarySchema = z
  .object({
    months: z.array(EarningsBucketSchema),
    quarters: z.array(EarningsBucketSchema),
    years: z.array(EarningsBucketSchema),
  })
  .openapi("EarningsSummary");

/**
 * Multipart is described for OpenAPI purposes (`format: "binary"`) but not
 * actually gated by Zod: `@hono/zod-openapi` runs this schema against Hono's
 * own multipart parser, which hands back a real `File` for a file part — not
 * a string — so the schema has to accept a `File` or the validator itself
 * would reject every real upload with a `422` before the handler ever runs.
 * The handler reads the same parsed body with `c.req.formData()` and hands
 * the bytes to `validateUpload`, which is the single content gate every entry
 * point shares.
 */
export const UploadRequestSchema = z
  .object({ file: z.instanceof(File).openapi({ type: "string", format: "binary" }) })
  .openapi("PayrollUploadRequest");

export const VerifyImportRequestSchema = z.object({
  version: z.number().int().optional(),
  month: z.string(),
  isThirteenth: z.boolean(),
  values: z.record(z.string(), z.string().nullable()),
});

export const RejectImportRequestSchema = z.object({ version: z.number().int().optional() });

export const ListImportsQuerySchema = z.object({
  status: PayrollImportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ListRecordsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

// `ErrorResponseSchema` is NOT declared here: it is imported from
// `@/modules/accounts/api/schemas` in routes.ts, the app's one existing
// `.openapi("ErrorResponse")` registration (Ruling P3-15).

/** The classification-rule editor (Phase 9). Mirrors `MappingTarget` in `application/ports.ts`. */
export const MappingTargetSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("earnings") }),
    z.object({
      kind: z.literal("fund_contribution"),
      fundSlug: z.string().min(1).max(64),
      part: z.enum(["employee", "employer"]),
    }),
    z.object({ kind: z.literal("timeoff_balance"), timeoffCode: z.string().min(1).max(64) }),
    z.object({ kind: z.literal("timeoff_used"), timeoffCode: z.string().min(1).max(64) }),
    z.object({ kind: z.literal("none") }),
  ])
  .openapi("MappingTarget");

export const ComponentKindSchema = z
  .enum([
    "earning",
    "deduction",
    "tax",
    "employer_contribution",
    "employee_contribution",
    "reimbursement",
    "allowance",
    "bonus",
    "leave_balance",
    "leave_used",
    "leave_accrued",
    "info",
  ])
  .openapi("PayrollComponentKind");

export const MappingRuleSchema = z
  .object({
    id: z.string(),
    matchCode: z.string().nullable(),
    matchLabel: z.string().nullable(),
    componentKind: ComponentKindSchema,
    target: MappingTargetSchema,
    priority: z.number().int(),
    /** Null for a global rule: the seeded catalogue lives in code and has no row to version. */
    version: z.number().int().nullable(),
    /** True for the seeded catalogue — readable, never editable or deletable. */
    global: z.boolean(),
  })
  .openapi("PayrollMappingRule");

export const MappingRuleListResponseSchema = z
  .object({ items: z.array(MappingRuleSchema) })
  .openapi("PayrollMappingRuleListResponse");

export const CreateMappingRuleRequestSchema = z
  .object({
    matchCode: z.string().min(1).max(120).nullable().optional(),
    matchLabel: z.string().min(1).max(200).nullable().optional(),
    componentKind: ComponentKindSchema,
    target: MappingTargetSchema,
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .openapi("CreateMappingRuleRequest");

export const UpdateMappingRuleRequestSchema = z
  .object({
    matchCode: z.string().min(1).max(120).nullable().optional(),
    matchLabel: z.string().min(1).max(200).nullable().optional(),
    componentKind: ComponentKindSchema.optional(),
    target: MappingTargetSchema.optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    version: z.number().int().optional(),
  })
  .openapi("UpdateMappingRuleRequest");
