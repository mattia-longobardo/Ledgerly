import { monthKey } from "@/lib/time";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { effectiveRule } from "../domain/schedule";
import { depositedThrough, quarterlyRows, type QuarterRow } from "../domain/totals";
import { NotFoundError } from "./errors";
import type { FundContribution, FundPlan, FundSchedule, ReconciliationIssue, UseCaseDeps } from "./ports";
import { summarizeFund, type FundSummary } from "./summary";

export interface FundDetail extends FundSummary {
  plan: FundPlan | null;
  schedule: FundSchedule | null;
  plans: FundPlan[];
  schedules: FundSchedule[];
  contributions: FundContribution[];
  quarters: QuarterRow[];
  valueSeries: { month: string; value: string; deposited: string }[];
  issues: ReconciliationIssue[];
}

export function getFundDetail(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<FundDetail> => {
    assertPermission(principal, "funds.read");
    const fund = await deps.funds.get(principal.userId, id);
    if (!fund) throw new NotFoundError();

    const [plans, schedules, contributions, issues, valuations] = await Promise.all([
      deps.plans.listForFund(fund.id),
      deps.schedules.listForFund(fund.id),
      deps.contributions.listForFund(fund.id),
      deps.issues.listOpen(principal.userId, "funds", `${fund.id}:`),
      fund.accountId === null ? Promise.resolve([]) : deps.valuations.monthly(principal.userId, fund.accountId),
    ]);
    const summary = await summarizeFund(deps, principal.userId, fund, contributions, issues);
    const valueByMonth = new Map(valuations.map((row) => [row.month, row.balance]));
    const months = [...new Set([...valuations.map((row) => row.month), ...contributions.map((row) => row.postedMonth)])].sort();
    let carried: string | null = null;
    const valueSeries: FundDetail["valueSeries"] = [];
    for (const month of months) {
      carried = valueByMonth.get(month) ?? carried;
      if (carried === null) continue;
      valueSeries.push({ month, value: carried, deposited: depositedThrough(contributions, month) });
    }
    const today = monthKey(deps.clock.now());
    return {
      ...summary,
      plan: effectiveRule(plans, today),
      schedule: effectiveRule(schedules, today),
      plans,
      schedules,
      contributions,
      quarters: quarterlyRows(contributions, today),
      valueSeries,
      issues,
    };
  };
}
