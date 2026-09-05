import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollRecords, type PayrollRecordRow } from "@/lib/db/schema";
import type {
  ListRecordsOptions,
  NewPayrollRecord,
  PayrollRecord,
  PayrollRecordKind,
  PayrollRecordsRepository,
} from "../application/ports";

function toRecord(row: PayrollRecordRow): PayrollRecord {
  return {
    id: row.id,
    userId: row.userId,
    importId: row.importId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    kind: row.kind as PayrollRecordKind,
    currency: row.currency,
    gross: row.gross,
    net: row.net,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    corrections: row.corrections as PayrollRecord["corrections"],
    supersededAt: row.supersededAt,
    supersededByRecordId: row.supersededByRecordId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzlePayrollRecordsRepository implements PayrollRecordsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListRecordsOptions = {}): Promise<PayrollRecord[]> {
    const clauses = [eq(payrollRecords.userId, userId)];
    if (!opts.includeSuperseded) clauses.push(isNull(payrollRecords.supersededAt));
    if (opts.from) clauses.push(gte(payrollRecords.periodStart, opts.from));
    if (opts.to) clauses.push(lte(payrollRecords.periodStart, opts.to));
    const rows = await this.db
      .select()
      .from(payrollRecords)
      .where(and(...clauses))
      .orderBy(desc(payrollRecords.periodStart), desc(payrollRecords.id));
    return rows.map(toRecord);
  }

  async get(userId: string, id: string): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async getByImport(userId: string, importId: string): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.importId, importId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async liveForPeriod(userId: string, periodStart: string, kind: PayrollRecordKind): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .select()
      .from(payrollRecords)
      .where(
        and(
          eq(payrollRecords.userId, userId),
          eq(payrollRecords.periodStart, periodStart),
          eq(payrollRecords.kind, kind),
          isNull(payrollRecords.supersededAt),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: NewPayrollRecord): Promise<PayrollRecord> {
    const [row] = await this.db.insert(payrollRecords).values(input).returning();
    return toRecord(row!);
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<Pick<PayrollRecord, "periodEnd" | "payDate" | "currency" | "gross" | "net" | "corrections">>,
  ): Promise<PayrollRecord | null> {
    const [row] = await this.db
      .update(payrollRecords)
      .set({ ...patch, version: sql`${payrollRecords.version} + 1`, updatedAt: new Date() })
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async supersede(userId: string, id: string, bySupersedingRecordId: string, at: Date): Promise<void> {
    await this.db
      .update(payrollRecords)
      .set({ supersededAt: at, supersededByRecordId: bySupersedingRecordId, updatedAt: at })
      .where(and(eq(payrollRecords.userId, userId), eq(payrollRecords.id, id)));
  }
}
