import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import { Badge } from "@ledgerly/ui/badge";
import { feeFormOf, sourceFormOf } from "@ledgerly/domain/funds";
import { calendarOf, type FundDetail } from "@ledgerly/domain/funds";
import { hasDueDates, nextDueDates, type PayrollComponent } from "@ledgerly/domain/funds";
import { CompactEmpty } from "./compact-empty";
import type { SourceSetup } from "./source-dialog";
import { AddSource, SourceActions } from "./source-list-client";
import { customDueText, dueDatesText, sourceSummary } from "./source-text";

/**
 * The Payroll module is active for every user until release R5a (modules per user). From R5a this
 * is the user's own setting: without the module "Payslip" is not offered, and a payslip source that
 * exists stays, with a note.
 */
const PAYROLL_AVAILABLE = true;

/** The payslip codes behind each part of a contribution, by the role the user's code map gives them. */
const CODE_GROUPS = [
  { key: "worker", roles: ["employee_fund"] },
  { key: "employer", roles: ["employer_fund"] },
  { key: "tfr", roles: ["tfr_contribution"] },
  { key: "enrollment", roles: ["employee_fund_enrollment", "employer_fund_enrollment"] },
  { key: "adjustment", roles: ["employee_fund_adjustment", "employer_fund_adjustment"] },
] as const;

/**
 * Settings › Contributions (docs/design/rewrite-plan/ux/n6-pension-fund.md §6.2): the content of
 * the section, without its title. One row per source — what it is, what it says, its next due dates
 * and its note — with "Edit" and its menu, then "Add source". The payslip source the fund reads
 * also shows the payslip codes, read only, and "Rebuild from payslips". An archived fund is read
 * only.
 */
export async function FundSourcesSection({
  ctx,
  detail,
  archived,
  todayOn,
  accounts,
  movements,
  taken,
  rebuild,
}: {
  ctx: Ctx;
  detail: FundDetail;
  archived: boolean;
  todayOn: CivilDate;
  /** The open accounts a recurring debit can be watched on. */
  accounts: readonly { id: string; name: string }[];
  /** The movements "Find from the movements" chooses from. */
  movements: readonly { id: string; label: string }[];
  /** The payslip components another fund holds already: component → that fund's name. */
  taken: Partial<Record<PayrollComponent, string>>;
  /** "Rebuild from payslips": the page gives it, it needs both modules at once. */
  rebuild: ReactNode;
}) {
  const t = await getTranslations("funds.sources");
  const { fund, sources } = detail;
  const setup: SourceSetup = {
    fundId: fund.id,
    accounts,
    movements,
    taken,
    payrollAvailable: PAYROLL_AVAILABLE,
    todayOn,
    format: ctx.numberFormat,
    locale: ctx.locale,
    currency: detail.currency,
  };
  const add = archived ? null : (
    <AddSource
      {...setup}
      hasManual={sources.some((source) => source.kind === "manual")}
      provider={fund.provider ?? ""}
    />
  );

  if (sources.length === 0) {
    return <CompactEmpty title={t("empty.title")} description={t("empty.text")} actions={add} />;
  }

  return (
    <>
      <ul className="flex flex-col">
        {sources.map((source) => {
          const form = sourceFormOf(source, ctx.numberFormat);
          const calendar = calendarOf(source);
          const custom = calendar.entries.length > 0 ? customDueText(calendar.entries) : null;
          const due =
            source.kind === "payroll" && source.accrualPeriod !== null && hasDueDates(calendar)
              ? nextDueDates(source.accrualPeriod, calendar, todayOn)
              : [];
          const accountName =
            source.accountId === null
              ? null
              : (accounts.find((account) => account.id === source.accountId)?.name ??
                detail.debits.find((debit) => debit.source.id === source.id)?.accountName ??
                null);
          return (
            <li
              key={source.id}
              data-testid="source-row"
              data-source={source.id}
              className="flex flex-col gap-1.5 border-t border-border py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="flex flex-wrap items-center gap-2 font-medium">
                    {t(`kinds.${source.kind}`)}
                    {source.state === "paused" && <Badge tone="neutral">{t("paused")}</Badge>}
                  </h3>
                  <p className="text-sm break-words text-muted">
                    {sourceSummary(t, form, {
                      format: ctx.numberFormat,
                      locale: ctx.locale,
                      currency: detail.currency,
                      accountName,
                      customDue: custom,
                    })}
                  </p>
                </div>
                {!archived && (
                  <div className="-ml-2 flex shrink-0 items-center gap-1 sm:ml-0">
                    <SourceActions
                      {...setup}
                      source={{ ...form, id: source.id }}
                      fees={detail.fees
                        .filter((fee) => fee.sourceId === source.id)
                        .map((fee) => feeFormOf(fee, ctx.numberFormat))}
                      contributions={detail.sourceContributions.get(source.id) ?? 0}
                      customDue={custom}
                    />
                  </div>
                )}
              </div>
              {due.length > 0 && (
                <p className="text-sm text-muted">
                  {t("due.next", { dates: dueDatesText(due, ctx.locale) })}
                </p>
              )}
              {source.kind === "payroll" && source.employer && (
                <p className="text-sm text-muted">{t("employerLine", { employer: source.employer })}</p>
              )}
              {source.kind === "payroll" && source.note && (
                <p className="text-sm break-words whitespace-pre-line">{source.note}</p>
              )}
              {source.kind === "payroll" && !PAYROLL_AVAILABLE && (
                <p className="text-sm text-muted">{t("payrollInactive")}</p>
              )}
              {source.kind === "payroll" && PAYROLL_AVAILABLE && detail.payroll?.source.id === source.id && (
                <div className="mt-1.5 flex flex-col gap-2">
                  <h4 className="text-sm font-medium">{t("codes.title")}</h4>
                  <dl className="flex flex-col gap-1 text-sm">
                    {CODE_GROUPS.map((group) => {
                      const codes = group.roles.flatMap((role) => detail.codes[role] ?? []);
                      return (
                        <div
                          key={group.key}
                          className="flex flex-wrap items-baseline justify-between gap-x-3"
                        >
                          <dt className="text-muted">{t(`codes.groups.${group.key}`)}</dt>
                          <dd className="font-medium break-words tabular-nums">
                            {codes.length > 0 ? codes.join(", ") : NULL_DISPLAY}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link
                      href={"/payroll/settings" as Route}
                      className="focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline"
                    >
                      {t("codes.open")}
                    </Link>
                    {!archived && rebuild}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {add && <div className="flex border-t border-border pt-3">{add}</div>}
    </>
  );
}
