import { asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { fundContributionSchedules, fundPlans, type FundPlanRow, type FundScheduleRow } from "@/lib/db/schema";
import type { FundPlan, FundSchedule, PlansRepository, SchedulesRepository } from "../application/ports";

function toSchedule(row: FundScheduleRow): FundSchedule {
  return { ...row, frequency: row.frequency as FundSchedule["frequency"] };
}

function toPlan(row: FundPlanRow): FundPlan {
  return row;
}

export class DrizzleSchedulesRepository implements SchedulesRepository {
  constructor(private readonly db: DbClient) {}

  async listForFund(fundId: string): Promise<FundSchedule[]> {
    const rows = await this.db
      .select()
      .from(fundContributionSchedules)
      .where(eq(fundContributionSchedules.fundId, fundId))
      .orderBy(asc(fundContributionSchedules.effectiveFrom), asc(fundContributionSchedules.id));
    return rows.map(toSchedule);
  }

  async add(input: Omit<FundSchedule, "id" | "createdAt">): Promise<FundSchedule> {
    const [row] = await this.db
      .insert(fundContributionSchedules)
      .values(input)
      .onConflictDoUpdate({
        target: [fundContributionSchedules.fundId, fundContributionSchedules.effectiveFrom],
        set: {
          frequency: sql`excluded.frequency`,
          periodAnchorMonth: sql`excluded.period_anchor_month`,
          postingLagMonths: sql`excluded.posting_lag_months`,
          feePerPosting: sql`excluded.fee_per_posting`,
        },
      })
      .returning();
    return toSchedule(row!);
  }
}

export class DrizzlePlansRepository implements PlansRepository {
  constructor(private readonly db: DbClient) {}

  async listForFund(fundId: string): Promise<FundPlan[]> {
    const rows = await this.db
      .select()
      .from(fundPlans)
      .where(eq(fundPlans.fundId, fundId))
      .orderBy(asc(fundPlans.effectiveFrom), asc(fundPlans.id));
    return rows.map(toPlan);
  }

  async add(input: Omit<FundPlan, "id" | "createdAt">): Promise<FundPlan> {
    const [row] = await this.db
      .insert(fundPlans)
      .values(input)
      .onConflictDoUpdate({
        target: [fundPlans.fundId, fundPlans.effectiveFrom],
        set: {
          initialCapital: sql`excluded.initial_capital`,
          fixedMonthlyAmount: sql`excluded.fixed_monthly_amount`,
          note: sql`excluded.note`,
        },
      })
      .returning();
    return toPlan(row!);
  }
}
