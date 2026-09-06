import type { Confidence, PayslipExtraction, SanityCheck } from "@/lib/contracts";
import type { AuditInput } from "@/platform/audit/record";

// ---- Infrastructure ports (resolved by the caller, before any transaction opens — Ruling R4-8) ----

/**
 * Where payslip bytes live (Ruling R4-1). Two adapters implement it:
 * `s3-document-store.ts` against the silo, `local-document-store.ts` against a
 * directory. Neither is ever called inside an open database transaction.
 *
 * `get` answers `null` for a key that is not there — a purged original is an
 * expected state (Ruling R4-5), not an error.
 */
export interface DocumentStore {
  readonly provider: "silo" | "local";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  listPrefix(prefix: string): Promise<string[]>;
}

export type ScanVerdict = "clean" | "infected" | "unavailable";

export interface ScanResult {
  verdict: ScanVerdict;
  /** What answered, recorded on the import so an audit can name it. */
  scanner: string;
  /** The signature name for an `infected` verdict; null otherwise. */
  signature: string | null;
}

/**
 * Spec §2.5 / §13.3: a boundary, not a dependency. The default implementation
 * declares everything clean and names itself `"none"`, so the absence of a
 * scanner is a recorded fact rather than an unrecorded assumption.
 */
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

// ---- Entities ----

export type PayrollImportStatus =
  | "received"
  | "scanning"
  | "needs_ocr"
  | "extracting"
  | "parsed"
  | "needs_review"
  | "verified"
  | "applied"
  | "rejected"
  | "superseded"
  | "failed";

export type ScanStatus = "pending" | "clean" | "infected" | "unavailable";
export type StorageProvider = "silo" | "local";
export type TextSourceColumn = "pdf_text" | "ocr" | "none";
export type UploadedVia = "ui" | "api" | "migration";

export interface PayrollImport {
  id: string;
  userId: string;
  status: PayrollImportStatus;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageProvider: StorageProvider;
  storageKey: string | null;
  pages: number | null;
  textSource: TextSourceColumn | null;
  parserVersion: string | null;
  extraction: PayslipExtraction | null;
  /** Per-field confidence, lifted out of `extraction` so Phase 8's auto-verify branch can index it (Ruling R4-18). */
  confidence: Record<string, Confidence> | null;
  scanStatus: ScanStatus;
  scanner: string | null;
  scanSignature: string | null;
  scannedAt: Date | null;
  error: string | null;
  idempotencyKey: string | null;
  replacesImportId: string | null;
  retentionUntil: Date;
  purgedAt: Date | null;
  uploadedVia: UploadedVia;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPayrollImport = Pick<
  PayrollImport,
  "userId" | "fileName" | "mime" | "sizeBytes" | "sha256" | "storageProvider" | "storageKey" | "idempotencyKey" | "replacesImportId" | "retentionUntil" | "uploadedVia"
>;

export type PayrollImportPatch = Partial<
  Pick<
    PayrollImport,
    | "status" | "storageKey" | "pages" | "textSource" | "parserVersion" | "extraction"
    | "confidence" | "scanStatus" | "scanner" | "scanSignature" | "scannedAt" | "error" | "purgedAt"
  >
>;

export interface ListImportsOptions {
  statuses?: readonly PayrollImportStatus[];
  limit?: number;
}

export interface PayrollImportsRepository {
  /** Newest first, by `created_at desc, id desc` — the order the imports table renders. */
  list(userId: string, opts?: ListImportsOptions): Promise<PayrollImport[]>;
  get(userId: string, id: string): Promise<PayrollImport | null>;
  findBySha(userId: string, sha256: string): Promise<PayrollImport | null>;
  /**
   * Throws on a unique-index violation rather than swallowing it — the caller
   * (`createImport`) wraps this in a savepoint and turns the violation into a
   * `409 duplicate` naming the existing import (Ruling R4-3).
   */
  create(input: NewPayrollImport): Promise<PayrollImport>;
  /** Bumps `version` and `updated_at`. No optimistic-concurrency check: pipeline transitions are server-driven. */
  patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null>;
  /**
   * Cross-user, for the ingest and retention jobs. Runs under `withSystemContext` only.
   *
   * Ordered `updated_at asc, id asc` — not `created_at`, deliberately (Finding
   * 8, B2 whole-branch review): `payroll-ingest.ts`'s job records a bare
   * `error` patch (bumping `updated_at`, changing nothing else) when an
   * import's processing throws, so a row that keeps failing (an LLM outage,
   * a malformed PDF) sorts to the back of the next tick's selection instead
   * of camping at the front of every tick forever on an unchanging
   * `created_at`. This is a bounded mitigation, not a real backoff: it has
   * no schedule and no cap on retry count (both would need a new column —
   * out of scope for that batch), and it cannot stop a full batch's worth of
   * simultaneously-failing rows from crowding out healthy ones tick after
   * tick, only a handful of them from doing so indefinitely.
   */
  listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]>;
  /** Cross-user; terminal statuses with a live object whose retention has run out (Ruling R4-5). */
  listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]>;
}

export type PayrollRecordKind = "ordinary" | "thirteenth" | "fourteenth" | "bonus" | "settlement";

export interface PayrollRecord {
  id: string;
  userId: string;
  importId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  kind: PayrollRecordKind;
  currency: string;
  gross: string | null;
  net: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  /**
   * What `applyImport` (`application/apply-import.ts`) actually writes here is
   * the verified import's own `extraction.fields` — per-field
   * `{value, confidence, rules, llm, note?}`, not an extracted-vs-corrected
   * diff. The name suggests the latter (and `verifyImport`,
   * `application/review-import.ts`, does compute a real extracted/corrected
   * map internally), but that map is never persisted — only its field
   * *names* reach the audit trail, and `applyImport` reads from
   * `extraction.fields`, which has no notion of "corrected" independent of
   * "current value" once verification has overwritten it. This type matches
   * what is genuinely stored (Finding 6, B2 whole-branch review) rather than
   * asserting a shape nothing writes, closing the double-cast that used to
   * paper over the mismatch. No consumer reads this column today, which is
   * why the mismatch was never a live bug — threading the real
   * extracted-vs-corrected map from `verifyImport` through to here remains
   * open follow-up work if a consumer ever needs the diff rather than the
   * final per-field state.
   */
  corrections: PayslipExtraction["fields"] | null;
  supersededAt: Date | null;
  supersededByRecordId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPayrollRecord = Omit<
  PayrollRecord,
  "id" | "version" | "createdAt" | "updatedAt" | "supersededAt" | "supersededByRecordId"
>;

export interface ListRecordsOptions {
  /** Inclusive lower and upper bounds on `periodStart`, as "YYYY-MM-DD". */
  from?: string;
  to?: string;
  includeSuperseded?: boolean;
}

export interface PayrollRecordsRepository {
  /** `period_start desc, id desc`. Excludes superseded rows unless asked (Ruling R4-12). */
  list(userId: string, opts?: ListRecordsOptions): Promise<PayrollRecord[]>;
  get(userId: string, id: string): Promise<PayrollRecord | null>;
  getByImport(userId: string, importId: string): Promise<PayrollRecord | null>;
  /** The live record for a period, or null. Used by the apply step to decide whether to supersede. */
  liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null>;
  create(input: NewPayrollRecord): Promise<PayrollRecord>;
  /** Recomputes an existing record from a re-apply; bumps `version`. */
  update(userId: string, id: string, patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>): Promise<PayrollRecord | null>;
  supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void>;
}

export type PayrollComponentKind =
  | "earning" | "deduction" | "tax" | "employer_contribution" | "employee_contribution"
  | "reimbursement" | "allowance" | "bonus" | "leave_balance" | "leave_used" | "leave_accrued" | "info";

export type MappingTarget =
  | { kind: "earnings" }
  | { kind: "fund_contribution"; fundSlug: string; part: "employee" | "employer" }
  | { kind: "timeoff_balance"; timeoffCode: string }
  | { kind: "timeoff_used"; timeoffCode: string }
  | { kind: "none" };

export interface PayrollComponent {
  id: string;
  recordId: string;
  code: string;
  /** The payslip's own Italian text, verbatim. Data, never UI chrome (spec §2.9). */
  labelRaw: string;
  kind: PayrollComponentKind;
  amount: string | null;
  quantity: string | null;
  unit: "hours" | "days" | "eur" | null;
  currency: string;
  confidence: Confidence | null;
  source: "rules" | "llm" | "manual";
  mappedTo: MappingTarget | null;
  sortOrder: number;
  createdAt: Date;
}

export type NewPayrollComponent = Omit<PayrollComponent, "id" | "createdAt">;

export interface PayrollComponentsRepository {
  /** `sort_order asc, id asc`. */
  listForRecord(recordId: string): Promise<PayrollComponent[]>;
  listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]>;
  /** Deletes every existing component of the record and inserts these (Ruling R4-6: replace wholesale). */
  replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]>;
}

export interface PayrollMappingRule {
  id: string;
  /** null for a seeded global rule. */
  userId: string | null;
  matchCode: string | null;
  matchLabel: string | null;
  componentKind: PayrollComponentKind;
  target: MappingTarget;
  priority: number;
}

export interface PayrollMappingRulesRepository {
  /** Global rules and this user's own, `priority asc, id asc` — the order `classifyComponent` resolves in. */
  listFor(userId: string): Promise<PayrollMappingRule[]>;
}

export interface FundContributionWrite {
  fundSlug: string;
  part: "employee" | "employer";
  accrualMonth: string;
  amount: string | null;
  currency: string;
}

export interface FundContributionSink {
  writeForRecord(input: {
    userId: string;
    payrollRecordId: string;
    supersededRecordId: string | null;
    rows: readonly FundContributionWrite[];
  }): Promise<{
    written: number;
    skipped: { fundSlug: string; reason: "no_fund" | "no_amount" }[];
  }>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  imports: PayrollImportsRepository;
  records: PayrollRecordsRepository;
  components: PayrollComponentsRepository;
  mappingRules: PayrollMappingRulesRepository;
  funds: FundContributionSink;
  /** Resolved before the transaction opens (Ruling R4-8). */
  documents: DocumentStore;
  /** Resolved before the transaction opens (Ruling R4-8). */
  scanner: MalwareScanner;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

/** Re-exported for the ingest use case, which hands them straight to `parsePayslip`. */
export type { PayslipExtraction, SanityCheck };
