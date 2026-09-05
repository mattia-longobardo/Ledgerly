import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollComponents, type PayrollComponentRow } from "@/lib/db/schema";
import type { Confidence } from "@/lib/contracts";
import type {
  MappingTarget,
  NewPayrollComponent,
  PayrollComponent,
  PayrollComponentKind,
  PayrollComponentsRepository,
} from "../application/ports";

function toComponent(row: PayrollComponentRow): PayrollComponent {
  return {
    id: row.id,
    recordId: row.recordId,
    code: row.code,
    labelRaw: row.labelRaw,
    kind: row.kind as PayrollComponentKind,
    amount: row.amount,
    quantity: row.quantity,
    unit: row.unit as PayrollComponent["unit"],
    currency: row.currency,
    confidence: row.confidence as Confidence | null,
    source: row.source as PayrollComponent["source"],
    mappedTo: row.mappedTo as MappingTarget | null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export class DrizzlePayrollComponentsRepository implements PayrollComponentsRepository {
  constructor(private readonly db: DbClient) {}

  async listForRecord(recordId: string): Promise<PayrollComponent[]> {
    const rows = await this.db
      .select()
      .from(payrollComponents)
      .where(eq(payrollComponents.recordId, recordId))
      .orderBy(asc(payrollComponents.sortOrder), asc(payrollComponents.id));
    return rows.map(toComponent);
  }

  async listForRecords(recordIds: readonly string[]): Promise<PayrollComponent[]> {
    if (recordIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(payrollComponents)
      .where(inArray(payrollComponents.recordId, [...recordIds]))
      .orderBy(asc(payrollComponents.recordId), asc(payrollComponents.sortOrder), asc(payrollComponents.id));
    return rows.map(toComponent);
  }

  /**
   * Delete-then-insert rather than an upsert (Ruling R4-6): a re-apply may drop
   * a component the previous parse produced, and an upsert keyed on
   * `(record, code)` would leave that stale row behind — a component the
   * payslip no longer has, still feeding Earnings.
   *
   * Runs inside the caller's transaction, so the record is never briefly
   * componentless to any other reader.
   */
  async replaceForRecord(recordId: string, components: readonly NewPayrollComponent[]): Promise<PayrollComponent[]> {
    await this.db.delete(payrollComponents).where(eq(payrollComponents.recordId, recordId));
    if (components.length > 0) {
      await this.db.insert(payrollComponents).values(components.map((c) => ({ ...c, recordId })));
    }
    return this.listForRecord(recordId);
  }
}
