import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollImports, type PayrollImportRow } from "@/lib/db/schema";
import type { Confidence, PayslipExtraction } from "@/lib/contracts";
import type {
  ListImportsOptions,
  NewPayrollImport,
  PayrollImport,
  PayrollImportPatch,
  PayrollImportStatus,
  PayrollImportsRepository,
} from "../application/ports";
import { TERMINAL_STATUSES } from "../domain/payroll";

function toImport(row: PayrollImportRow): PayrollImport {
  return {
    id: row.id,
    userId: row.userId,
    // The only casts in this module: a `text` column with an app-level CHECK
    // has no narrower Drizzle-inferred type, the same reason
    // `DrizzleAccountsRepository` casts at its own boundary.
    status: row.status as PayrollImport["status"],
    fileName: row.fileName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    storageProvider: row.storageProvider as PayrollImport["storageProvider"],
    storageKey: row.storageKey,
    pages: row.pages,
    textSource: row.textSource as PayrollImport["textSource"],
    parserVersion: row.parserVersion,
    extraction: row.extraction as PayslipExtraction | null,
    confidence: row.confidence as Record<string, Confidence> | null,
    scanStatus: row.scanStatus as PayrollImport["scanStatus"],
    scanner: row.scanner,
    scanSignature: row.scanSignature,
    scannedAt: row.scannedAt,
    error: row.error,
    idempotencyKey: row.idempotencyKey,
    replacesImportId: row.replacesImportId,
    retentionUntil: row.retentionUntil,
    purgedAt: row.purgedAt,
    uploadedVia: row.uploadedVia as PayrollImport["uploadedVia"],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed pipeline state. Every method assumes the client is a
 * transaction carrying the caller's RLS context (`withUserContext`); the
 * explicit `user_id` predicates keep the intent readable and hold under the
 * system context too, where RLS lets everything through — the precedent
 * `DrizzleInterestRulesRepository` sets. The two `ForAllUsers` methods are the
 * deliberate exceptions and are meant for `withSystemContext` only.
 */
export class DrizzlePayrollImportsRepository implements PayrollImportsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListImportsOptions = {}): Promise<PayrollImport[]> {
    const where = opts.statuses
      ? and(eq(payrollImports.userId, userId), inArray(payrollImports.status, [...opts.statuses]))
      : eq(payrollImports.userId, userId);
    const query = this.db
      .select()
      .from(payrollImports)
      .where(where)
      // Explicit and total: without the id tie-break, two imports created in
      // the same millisecond swap position between reloads.
      .orderBy(desc(payrollImports.createdAt), desc(payrollImports.id));
    const rows = opts.limit === undefined ? await query : await query.limit(opts.limit);
    return rows.map(toImport);
  }

  async get(userId: string, id: string): Promise<PayrollImport | null> {
    const [row] = await this.db
      .select()
      .from(payrollImports)
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.id, id)))
      .limit(1);
    return row ? toImport(row) : null;
  }

  async findBySha(userId: string, sha256: string): Promise<PayrollImport | null> {
    const [row] = await this.db
      .select()
      .from(payrollImports)
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.sha256, sha256)))
      .limit(1);
    return row ? toImport(row) : null;
  }

  async create(input: NewPayrollImport): Promise<PayrollImport> {
    const [row] = await this.db.insert(payrollImports).values(input).returning();
    return toImport(row!);
  }

  async patch(userId: string, id: string, patch: PayrollImportPatch): Promise<PayrollImport | null> {
    const [row] = await this.db
      .update(payrollImports)
      .set({ ...patch, version: sql`${payrollImports.version} + 1`, updatedAt: new Date() })
      .where(and(eq(payrollImports.userId, userId), eq(payrollImports.id, id)))
      .returning();
    return row ? toImport(row) : null;
  }

  async listByStatusForAllUsers(statuses: readonly PayrollImportStatus[], limit: number): Promise<PayrollImport[]> {
    const rows = await this.db
      .select()
      .from(payrollImports)
      .where(inArray(payrollImports.status, [...statuses]))
      // `updated_at`, not `created_at` — see the port's doc-comment
      // (Finding 8): a row payroll-ingest.ts keeps failing gets its
      // `updated_at` bumped without changing status, which sorts it to the
      // back of the next tick's selection instead of the front of every one.
      .orderBy(asc(payrollImports.updatedAt), asc(payrollImports.id))
      .limit(limit);
    return rows.map(toImport);
  }

  async listPurgeableForAllUsers(before: Date, limit: number): Promise<PayrollImport[]> {
    const rows = await this.db
      .select()
      .from(payrollImports)
      .where(
        and(
          inArray(payrollImports.status, [...TERMINAL_STATUSES]),
          isNotNull(payrollImports.storageKey),
          lt(payrollImports.retentionUntil, before),
        ),
      )
      .orderBy(asc(payrollImports.retentionUntil), asc(payrollImports.id))
      .limit(limit);
    return rows.map(toImport);
  }
}
