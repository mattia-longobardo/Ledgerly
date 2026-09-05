import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

/**
 * Pipeline state for one uploaded payslip. Bytes never live here (Ruling
 * R4-1): `storage_key` points into the `DocumentStore`, and a null key on a
 * terminal row means the retention job has already purged the object while
 * keeping the provenance (Ruling R4-5).
 *
 * `text_source` carries the spec's three values while the parser's own
 * `TextSource` has two (Ruling R4-14): `none` is the honest encoding of an
 * import that reached `needs_ocr` and was therefore never parsed at all.
 */
export const payrollImports = pgTable(
  "payroll_imports",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    status: text("status").notNull().default("received"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageProvider: text("storage_provider").notNull().default("silo"),
    storageKey: text("storage_key"),
    pages: integer("pages"),
    textSource: text("text_source"),
    parserVersion: text("parser_version"),
    extraction: jsonb("extraction"),
    confidence: jsonb("confidence"),
    scanStatus: text("scan_status").notNull().default("pending"),
    scanner: text("scanner"),
    scanSignature: text("scan_signature"),
    scannedAt: tz("scanned_at"),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    replacesImportId: uuid("replaces_import_id").references((): AnyPgColumn => payrollImports.id),
    retentionUntil: tz("retention_until").notNull(),
    purgedAt: tz("purged_at"),
    uploadedVia: text("uploaded_via").notNull().default("ui"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_imports_status_ck",
      sql`${t.status} IN ('received','scanning','needs_ocr','extracting','parsed','needs_review','verified','applied','rejected','superseded','failed')`,
    ),
    check("payroll_imports_storage_ck", sql`${t.storageProvider} IN ('silo','local')`),
    check("payroll_imports_scan_ck", sql`${t.scanStatus} IN ('pending','clean','infected','unavailable')`),
    check("payroll_imports_text_source_ck", sql`${t.textSource} IN ('pdf_text','ocr','none')`),
    check("payroll_imports_uploaded_via_ck", sql`${t.uploadedVia} IN ('ui','api','migration')`),
    check("payroll_imports_size_ck", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
    check("payroll_imports_sha_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("payroll_imports_user_sha_uq").on(t.userId, t.sha256),
    // Partial: two imports may both have no idempotency key (Ruling R4-3);
    // in Postgres NULLs never collide in a plain unique index either, but the
    // predicate keeps the index small and states the intent.
    uniqueIndex("payroll_imports_user_idem_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index("payroll_imports_user_created_idx").on(t.userId, t.createdAt.desc()),
    // Spec §5.10's partial index, widened by the two statuses this phase's
    // pipeline actually parks in (`scanning`, `needs_ocr`) — the ingest job
    // scans exactly this set on every tick.
    index("payroll_imports_open_idx")
      .on(t.status)
      .where(sql`status IN ('received','scanning','needs_ocr','extracting','needs_review')`),
  ],
);

/**
 * The money. One live record per (user, period, kind); a correction supersedes
 * rather than overwrites (Ruling R4-4), which is what lets the partial unique
 * index below stay a hard constraint.
 */
export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    importId: uuid("import_id").notNull().references(() => payrollImports.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date"),
    kind: text("kind").notNull().default("ordinary"),
    currency: text("currency").notNull().default("EUR"),
    // Nullable on purpose: an applied record whose gross the parser could not
    // read renders as "—", never as 0.00 (global constraint: never invent).
    gross: money("gross"),
    net: money("net"),
    verifiedAt: tz("verified_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    corrections: jsonb("corrections"),
    supersededAt: tz("superseded_at"),
    supersededByRecordId: uuid("superseded_by_record_id").references((): AnyPgColumn => payrollRecords.id),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("payroll_records_kind_ck", sql`${t.kind} IN ('ordinary','thirteenth','fourteenth','bonus','settlement')`),
    check("payroll_records_currency_ck", sql`char_length(${t.currency}) = 3`),
    check("payroll_records_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
    uniqueIndex("payroll_records_import_uq").on(t.importId),
    uniqueIndex("payroll_records_period_uq")
      .on(t.userId, t.periodStart, t.kind)
      .where(sql`superseded_at IS NULL`),
    index("payroll_records_user_period_idx").on(t.userId, t.periodStart.desc()),
  ],
);

/**
 * One row per line the parser produced. `label_raw` is the payslip's own
 * Italian text, kept verbatim as data (spec §2.9); `kind` and everything the
 * UI renders around it are English.
 */
export const payrollComponents = pgTable(
  "payroll_components",
  {
    id: id(),
    recordId: uuid("record_id").notNull().references(() => payrollRecords.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    labelRaw: text("label_raw").notNull(),
    kind: text("kind").notNull(),
    amount: money("amount"),
    quantity: numeric("quantity", { precision: 16, scale: 6 }),
    unit: text("unit"),
    currency: text("currency").notNull().default("EUR"),
    confidence: text("confidence"),
    source: text("source").notNull().default("rules"),
    mappedTo: jsonb("mapped_to"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_components_kind_ck",
      sql`${t.kind} IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')`,
    ),
    check("payroll_components_confidence_ck", sql`${t.confidence} IN ('high','medium','low')`),
    check("payroll_components_source_ck", sql`${t.source} IN ('rules','llm','manual')`),
    check("payroll_components_unit_ck", sql`${t.unit} IN ('hours','days','eur')`),
    index("payroll_components_record_idx").on(t.recordId, t.sortOrder),
  ],
);

/**
 * `user_id IS NULL` is a global rule, seeded by this migration and readable by
 * everybody. The RLS policy's USING clause admits those rows; its WITH CHECK
 * does not, so a user can never write one.
 */
export const payrollMappingRules = pgTable(
  "payroll_mapping_rules",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    matchCode: text("match_code"),
    matchLabel: text("match_label"),
    componentKind: text("component_kind").notNull(),
    target: jsonb("target").notNull(),
    priority: integer("priority").notNull().default(100),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payroll_mapping_rules_kind_ck",
      sql`${t.componentKind} IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')`,
    ),
    check("payroll_mapping_rules_match_ck", sql`${t.matchCode} IS NOT NULL OR ${t.matchLabel} IS NOT NULL`),
    index("payroll_mapping_rules_lookup_idx").on(t.userId, t.priority),
  ],
);

export type PayrollImportRow = typeof payrollImports.$inferSelect;
export type PayrollRecordRow = typeof payrollRecords.$inferSelect;
export type PayrollComponentRow = typeof payrollComponents.$inferSelect;
export type PayrollMappingRuleRow = typeof payrollMappingRules.$inferSelect;
