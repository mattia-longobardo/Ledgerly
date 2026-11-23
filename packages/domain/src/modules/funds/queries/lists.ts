// Funds · what other readers ask of the detail and of the funds: the flows, the calendar, the search.
import { and, asc, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type CivilDate } from "../../../shared/dates";
import { NO_PERIOD_FEES, periodFees } from "../fees";
import { type FundFlow, fundFlows } from "../period";
import { funds } from "../schema";
import { hasDueDates } from "../sources";
import { asOperation, type FundDetail } from "./detail";

export function fundDetailFlows(detail: FundDetail, todayOn: CivilDate): FundFlow[] {
  const { payroll } = detail;
  const operations = detail.operations.map((operation) =>
    asOperation(operation, detail.unitsOf.get(operation.id) ?? "0"),
  );
  return fundFlows(
    payroll === null ? operations.reverse() : operations,
    detail.quarters,
    payroll === null
      ? NO_PERIOD_FEES
      : periodFees(detail.fees, { sourceId: payroll.source.id, period: payroll.period, on: todayOn }),
  );
}

/** Whether "On the way" and the periods' reconciliation have something to say: a payslip source with due dates. */
export const hasPayrollCalendar = (detail: Pick<FundDetail, "payroll">): boolean =>
  detail.payroll !== null && hasDueDates(detail.payroll.calendar);

/**
 * The accounts that are a fund's valuation account: `funds` writes them, so no other module may
 * take them over (docs/design/investments.md §1.3).
 */
export async function valuationAccountIds(ctx: Pick<Ctx, "userId">): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: funds.valuationAccountId })
    .from(funds)
    .where(userScoped(ctx).owns(funds));
  return new Set(rows.map((row) => row.id));
}

/** Every fund by the account that holds its value: what makes an account a fund's row (R5b). */
export async function fundsByAccount(
  ctx: Pick<Ctx, "userId">,
): Promise<Map<string, { id: string; name: string }>> {
  const rows = await getDb()
    .select({ id: funds.id, name: funds.name, accountId: funds.valuationAccountId })
    .from(funds)
    .where(userScoped(ctx).owns(funds));
  return new Map(rows.map((row) => [row.accountId, { id: row.id, name: row.name }]));
}

/** Funds by name, for the ⌘K palette (spec §8.2), with the account their page is on (R5b). */
export async function searchFunds(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string; accountId: string }[]> {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const rows = await getDb()
    .select({ id: funds.id, name: funds.name, accountId: funds.valuationAccountId })
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.state, "active")))
    .orderBy(asc(funds.name), asc(funds.id));
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}
