import type { DbClient } from "@/lib/db/client";
import type { FundContributionSink } from "@/modules/payroll/application/ports";
import { z } from "zod";
import type {
  ContributionsRepository,
  FundsRepository,
  SchedulesRepository,
} from "../application/ports";
import { InvalidInputError } from "../application/errors";
import {
  currencySchema,
  formatCents,
  moneyCents,
  moneySchema,
  monthSchema,
  parseInput,
} from "../application/validation";
import { accrualPeriodFor, effectiveRule, postedMonthFor, type ScheduleRule } from "../domain/schedule";
import { DrizzleContributionsRepository } from "./drizzle-contributions-repository";
import { DrizzleFundsRepository } from "./drizzle-funds-repository";
import { DrizzleSchedulesRepository } from "./drizzle-schedules-plans-repository";

export interface PayrollContributionSinkRepositories {
  funds: FundsRepository;
  schedules: SchedulesRepository;
  contributions: ContributionsRepository;
}

const DEFAULT_SCHEDULE: ScheduleRule = {
  frequency: "quarterly",
  periodAnchorMonth: 1,
  postingLagMonths: 1,
  feePerPosting: "0.00",
};

const writeRowsSchema = z.array(z.object({
  fundSlug: z.string().min(1),
  part: z.enum(["employee", "employer"]),
  accrualMonth: monthSchema,
  amount: moneySchema.nullable(),
  currency: currencySchema,
}).strict());

export function createPayrollContributionSink(
  repositories: PayrollContributionSinkRepositories,
): FundContributionSink {
  return {
    async writeForRecord(input) {
      const parsedRows = parseInput(writeRowsSchema, input.rows);
      for (const row of parsedRows) {
        if (row.amount !== null && moneyCents(row.amount) <= 0n) {
          throw new InvalidInputError("Invalid contribution amount sign.");
        }
      }
      const ownedFunds = await repositories.funds.list(input.userId, { includeArchived: true });
      const lockedFunds = [];
      for (const candidate of [...ownedFunds].sort((a, b) => a.id.localeCompare(b.id))) {
        const locked = await repositories.funds.lock(input.userId, candidate.id);
        if (locked) lockedFunds.push(locked);
      }

      const bySlug = new Map(lockedFunds.map((fund) => [fund.slug, fund]));
      for (const row of parsedRows) {
        const fund = bySlug.get(row.fundSlug);
        if (fund && row.currency !== fund.currency) {
          throw new InvalidInputError("Fund contribution currency must match the fund currency.");
        }
      }

      const skipped: { fundSlug: string; reason: "no_fund" | "no_amount" }[] = [];
      const grouped = new Map<string, {
        fund: (typeof lockedFunds)[number];
        part: "employee" | "employer";
        accrualMonth: string;
        amount: bigint;
        currency: string;
      }>();
      for (const row of parsedRows) {
        const fund = bySlug.get(row.fundSlug);
        if (!fund) {
          skipped.push({ fundSlug: row.fundSlug, reason: "no_fund" });
          continue;
        }
        if (row.amount === null) {
          skipped.push({ fundSlug: row.fundSlug, reason: "no_amount" });
          continue;
        }
        const key = `${fund.id}\0${row.part}`;
        const existing = grouped.get(key);
        if (existing && (existing.accrualMonth !== row.accrualMonth || existing.currency !== row.currency)) {
          throw new InvalidInputError("A fund contribution part cannot span months or currencies.");
        }
        if (existing) existing.amount += moneyCents(row.amount);
        else grouped.set(key, {
          fund,
          part: row.part,
          accrualMonth: row.accrualMonth,
          amount: moneyCents(row.amount),
          currency: row.currency,
        });
      }

      const fees = new Map<string, {
        fundId: string;
        currency: string;
        period: { start: string; end: string };
        postedMonth: string;
        fee: string;
      }>();
      const prepared: Array<{
        fundId: string;
        typeCode: "employee" | "employer";
        period: { start: string; end: string };
        postedMonth: string;
        amount: string;
        currency: string;
      }> = [];

      const scheduleCache = new Map<string, Awaited<ReturnType<SchedulesRepository["listForFund"]>>>();
      for (const row of grouped.values()) {
        const fund = row.fund;
        let rules = scheduleCache.get(fund.id);
        if (!rules) {
          rules = await repositories.schedules.listForFund(fund.id);
          scheduleCache.set(fund.id, rules);
        }
        const rule = effectiveRule(rules, row.accrualMonth) ?? DEFAULT_SCHEDULE;
        const period = accrualPeriodFor(row.accrualMonth, rule);
        const postedMonth = postedMonthFor(row.accrualMonth, rule);
        const amount = formatCents(row.amount);
        if (!moneySchema.safeParse(amount).success) throw new InvalidInputError("Invalid money amount.");
        const feeCents = moneyCents(rule.feePerPosting);
        if (feeCents < 0n) throw new InvalidInputError("Invalid negative posting fee.");
        prepared.push({
          fundId: fund.id,
          typeCode: row.part,
          period,
          postedMonth,
          amount,
          currency: row.currency,
        });
        fees.set(`${fund.id}\0${postedMonth}`, {
          fundId: fund.id,
          currency: fund.currency,
          period,
          postedMonth,
          fee: rule.feePerPosting,
        });
      }

      const affectedPostings = new Map<string, Set<string>>();
      const recordIds = [...new Set([
        input.payrollRecordId,
        ...(input.supersededRecordId ? [input.supersededRecordId] : []),
      ])];
      for (const fund of lockedFunds) {
        const removed = await repositories.contributions.deleteByPayrollRecords(fund.id, recordIds);
        if (removed.postedMonths.length > 0) {
          affectedPostings.set(fund.id, new Set(removed.postedMonths));
        }
      }
      for (const [fundId, postedMonths] of affectedPostings) {
        for (const postedMonth of postedMonths) {
          await repositories.contributions.deleteOrphanSystemFee(fundId, postedMonth);
        }
      }

      for (const row of prepared) {
        await repositories.contributions.create({
          fundId: row.fundId,
          typeCode: row.typeCode,
          accrualPeriodStart: row.period.start,
          accrualPeriodEnd: row.period.end,
          postedMonth: row.postedMonth,
          valueDate: null,
          amount: row.amount,
          currency: row.currency,
          source: "payroll",
          payrollRecordId: input.payrollRecordId,
          note: null,
          reversesId: null,
          reconciliationStatus: "received",
        });
      }

      for (const fee of fees.values()) {
        const cents = moneyCents(fee.fee);
        if (cents === 0n || await repositories.contributions.hasSystemFee(fee.fundId, fee.postedMonth)) continue;
        await repositories.contributions.create({
          fundId: fee.fundId,
          typeCode: "fee",
          accrualPeriodStart: fee.period.start,
          accrualPeriodEnd: fee.period.end,
          postedMonth: fee.postedMonth,
          valueDate: null,
          amount: formatCents(-cents),
          currency: fee.currency,
          source: "system",
          payrollRecordId: null,
          note: null,
          reversesId: null,
          reconciliationStatus: "received",
        });
      }

      return { written: prepared.length, skipped };
    },
  };
}

export function payrollContributionSink(tx: DbClient): FundContributionSink {
  return createPayrollContributionSink({
    funds: new DrizzleFundsRepository(tx),
    schedules: new DrizzleSchedulesRepository(tx),
    contributions: new DrizzleContributionsRepository(tx),
  });
}
