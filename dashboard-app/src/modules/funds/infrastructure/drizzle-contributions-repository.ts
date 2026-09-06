import { and, asc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { fundContributions, type FundContributionRow } from "@/lib/db/schema";
import type { ContributionsRepository, FundContribution, NewFundContribution } from "../application/ports";

function toContribution(row: FundContributionRow): FundContribution {
  return {
    ...row,
    typeCode: row.typeCode as FundContribution["typeCode"],
    source: row.source as FundContribution["source"],
    reconciliationStatus: row.reconciliationStatus as FundContribution["reconciliationStatus"],
  };
}

export class DrizzleContributionsRepository implements ContributionsRepository {
  constructor(private readonly db: DbClient) {}

  async listForFund(fundId: string, opts?: { from?: string; to?: string }): Promise<FundContribution[]> {
    const predicates = [eq(fundContributions.fundId, fundId)];
    if (opts?.from) predicates.push(gte(fundContributions.postedMonth, opts.from));
    if (opts?.to) predicates.push(lte(fundContributions.postedMonth, opts.to));
    const rows = await this.db
      .select()
      .from(fundContributions)
      .where(and(...predicates))
      .orderBy(asc(fundContributions.accrualPeriodStart), asc(fundContributions.id));
    return rows.map(toContribution);
  }

  async get(fundId: string, id: string): Promise<FundContribution | null> {
    const [row] = await this.db
      .select()
      .from(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), eq(fundContributions.id, id)))
      .limit(1);
    return row ? toContribution(row) : null;
  }

  async create(input: NewFundContribution): Promise<FundContribution> {
    const [row] = await this.db.insert(fundContributions).values(input).returning();
    return toContribution(row!);
  }

  async deleteByPayrollRecord(fundId: string, payrollRecordId: string): Promise<number> {
    return (await this.deleteByPayrollRecords(fundId, [payrollRecordId])).deleted;
  }

  async deleteByPayrollRecords(fundId: string, payrollRecordIds: readonly string[]): Promise<{ deleted: number; postedMonths: string[] }> {
    if (payrollRecordIds.length === 0) return { deleted: 0, postedMonths: [] };
    const originals = await this.db
      .select({ id: fundContributions.id, postedMonth: fundContributions.postedMonth })
      .from(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), inArray(fundContributions.payrollRecordId, [...payrollRecordIds])));
    if (originals.length === 0) return { deleted: 0, postedMonths: [] };
    const originalIds = originals.map((row) => row.id);
    const reversals = await this.db
      .delete(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), inArray(fundContributions.reversesId, originalIds)))
      .returning({ id: fundContributions.id });
    const deleted = await this.db
      .delete(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), inArray(fundContributions.id, originalIds)))
      .returning({ id: fundContributions.id });
    return {
      deleted: reversals.length + deleted.length,
      postedMonths: [...new Set(originals.map((row) => row.postedMonth))].sort(),
    };
  }

  async deleteOrphanSystemFee(fundId: string, postedMonth: string): Promise<number> {
    const [eligible] = await this.db
      .select({ id: fundContributions.id })
      .from(fundContributions)
      .where(and(
        eq(fundContributions.fundId, fundId),
        eq(fundContributions.postedMonth, postedMonth),
        inArray(fundContributions.typeCode, ["employee", "employer"]),
        or(isNotNull(fundContributions.payrollRecordId), eq(fundContributions.source, "migration")),
      ))
      .limit(1);
    if (eligible) return 0;
    const fees = await this.db
      .select({ id: fundContributions.id })
      .from(fundContributions)
      .where(and(
        eq(fundContributions.fundId, fundId),
        eq(fundContributions.postedMonth, postedMonth),
        eq(fundContributions.typeCode, "fee"),
        eq(fundContributions.source, "system"),
      ));
    if (fees.length === 0) return 0;
    const feeIds = fees.map((row) => row.id);
    const reversals = await this.db
      .delete(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), inArray(fundContributions.reversesId, feeIds)))
      .returning({ id: fundContributions.id });
    const deleted = await this.db
      .delete(fundContributions)
      .where(and(eq(fundContributions.fundId, fundId), inArray(fundContributions.id, feeIds)))
      .returning({ id: fundContributions.id });
    return reversals.length + deleted.length;
  }

  async hasSystemFee(fundId: string, postedMonth: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: fundContributions.id })
      .from(fundContributions)
      .where(and(
        eq(fundContributions.fundId, fundId),
        eq(fundContributions.postedMonth, postedMonth),
        eq(fundContributions.typeCode, "fee"),
        eq(fundContributions.source, "system"),
      ))
      .limit(1);
    return row !== undefined;
  }
}
