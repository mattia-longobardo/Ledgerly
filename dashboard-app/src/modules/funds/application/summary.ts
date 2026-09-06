import { monthKey } from "@/lib/time";
import { absoluteReturn, depositedThrough } from "../domain/totals";
import type { Fund, FundContribution, ReconciliationIssue, UseCaseDeps } from "./ports";

export interface FundSummary {
  fund: Fund;
  value: string | null;
  valueAsOf: string | null;
  deposited: string;
  absReturn: string | null;
  lastContributionMonth: string | null;
  openIssues: number;
}

export async function summarizeFund(
  deps: UseCaseDeps,
  userId: string,
  fund: Fund,
  contributions?: FundContribution[],
  issues?: ReconciliationIssue[],
): Promise<FundSummary> {
  const rows = contributions ?? await deps.contributions.listForFund(fund.id);
  const openIssues = issues ?? await deps.issues.listOpen(userId, "funds", `${fund.id}:`);
  const valuation = fund.accountId === null ? null : await deps.valuations.latest(userId, fund.accountId);
  const deposited = depositedThrough(rows, monthKey(deps.clock.now()));
  const value = valuation?.balance ?? null;
  return {
    fund,
    value,
    valueAsOf: valuation?.asOf ?? null,
    deposited,
    absReturn: absoluteReturn(value, deposited),
    lastContributionMonth: rows.reduce<string | null>((latest, row) => latest === null || row.postedMonth > latest ? row.postedMonth : latest, null),
    openIssues: openIssues.length,
  };
}
