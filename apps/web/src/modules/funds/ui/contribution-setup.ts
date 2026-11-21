"use client";
// What «Record contribution» opens with (§8.1), from `GET /funds/{id}/contributions` and the
// movements of `GET /funds/{id}/movement-candidates` (rewrite plan R3): the kind, the fees the fund's
// list says, the oldest period still on its way and the periods to choose from are the server's; this
// file only writes them as the form's text.
import { useTranslations } from "next-intl";
import { funds } from "@ledgerly/api-contract/funds";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatAmountInput } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { newContributionForm } from "@ledgerly/domain/funds/client";
import type { ContributionSetup } from "./contribution-dialog";
import { periodLabel } from "./pension-present";
import type { Say } from "@/platform/say";
import { cents, movementOptions } from "./wire-forms";

export type Contributions = RouteOutput<typeof funds.getFundContributions>;

/** The movements a contribution or a debit can be tied to: the last 60 out of the debit's account. */
export function useMovements(fundId: string, accountId: string | null, say: Say | undefined) {
  const read = useApi(funds.getFundMovementCandidates, {
    params: { id: fundId },
    query: accountId === null ? {} : { accountId },
  });
  return say === undefined ? [] : movementOptions(read.data?.movements ?? [], say);
}

/** The label of a period of the payslip source: «Q2 2026», «March 2026». */
export function usePeriodLabel(accrual: "month" | "quarter" | undefined, say: Say) {
  const register = useTranslations("funds.fund.contributions.register");
  return (year: number, index: number) =>
    periodLabel(accrual ?? "quarter", year, index, say.locale, (values) => register("quarter", values));
}

/** The dialog's setup; `null` for an archived fund, which is read only. */
export function contributionSetupOf(
  contributions: Contributions,
  say: Say,
  movements: readonly { id: string; label: string }[],
  label: (year: number, index: number) => string,
): ContributionSetup | null {
  const { setup, fund, payroll } = contributions;
  if (setup === null) return null;
  const text = (amount: string) => {
    const value = cents(amount);
    return value === null || value === 0n ? "" : formatAmountInput(value, say.format);
  };
  const pending = setup.pendingPeriod;
  return {
    fundId: fund.id,
    fundName: fund.name,
    today: say.todayOn,
    format: say.format,
    defaults: {
      voluntary: newContributionForm("voluntary", say.todayOn, { fee: text(setup.defaultFees.voluntary) }),
      payroll: newContributionForm("payroll", say.todayOn, {
        fee: text(setup.defaultFees.payroll),
        period: pending ? `${pending.year}-${pending.index}` : "",
      }),
      other: newContributionForm("other", say.todayOn),
    },
    kind: setup.defaultKind,
    hasPayroll: payroll !== null,
    periods: setup.periods.map(({ year, index }) => ({
      value: `${year}-${index}`,
      label: label(year, index),
    })),
    movements,
  };
}
