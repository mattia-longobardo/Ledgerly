import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { contributionFee, periodFees } from "@ledgerly/domain/funds";
import { contributionFormOf, newContributionForm } from "@ledgerly/domain/funds";
import { type FundPeriod, onTheWay } from "@ledgerly/domain/funds";
import type { Operation } from "@ledgerly/domain/funds";
import { type ComponentStatus, MAIN_COMPONENTS, type QuarterStatus } from "@ledgerly/domain/funds";
import { type FundDetail, hasPayrollCalendar } from "@ledgerly/domain/funds";
import { competencePeriod, periodsPerYear, periodStart } from "@ledgerly/domain/funds";
import { competenceOn, inPeriod, quarterInPeriod } from "@ledgerly/domain/funds";
import {
  ContributionButton,
  type ContributionSetup,
  DeleteContributionButton,
  EditContributionButton,
} from "./contribution-dialog";
import { periodLabel, STATUS_TONE } from "./pension-present";
import { operationOrigin } from "./present";
import { AcceptDifferenceButton, ClearDecisionButton } from "./reconciliation-buttons";
import { frequencyText } from "./source-text";

/** More than any contribution: the fees "on each contribution" are read as amounts, whatever is charged. */
const ANY_AMOUNT: Cents = 1_000_000_000_000n;

/**
 * What "Record contribution" opens with for a fund (§8.1): the kind, the fee the fund's list of fees
 * says, the oldest period still on its way, the periods and the movements to choose from.
 */
export async function contributionSetup(
  ctx: Pick<Ctx, "numberFormat" | "locale">,
  detail: FundDetail,
  todayOn: CivilDate,
  movements: readonly { id: string; label: string }[],
): Promise<ContributionSetup> {
  const t = await getTranslations("funds.fund.contributions.register");
  const { fund, payroll, sources, fees } = detail;
  const format = ctx.numberFormat;
  const amounts = fees.filter((fee) => fee.rate === null);
  const text = (cents: Cents) => (cents === 0n ? "" : formatAmountInput(cents, format));

  // A voluntary payment written by hand costs what the recurring debit costs, as it always has.
  const debit = sources.find((source) => source.kind === "bank_debit" && source.state === "active");
  const byHand = debit ?? sources.find((source) => source.kind === "manual") ?? null;
  const voluntaryFee =
    contributionFee(amounts, { on: todayOn, chargedCents: ANY_AMOUNT, sourceId: byHand?.id ?? null }) ?? 0n;
  const payrollFee =
    payroll === null
      ? 0n
      : (contributionFee(amounts, { on: todayOn, chargedCents: ANY_AMOUNT, sourceId: payroll.source.id }) ??
          0n) +
        periodFees(fees, { sourceId: payroll.source.id, period: payroll.period, on: todayOn }).quarterCents;

  const periods: { value: string; label: string }[] = [];
  if (payroll !== null) {
    const firstYear = Math.min(
      Number(fund.startOn.slice(0, 4)),
      ...detail.competences.map((competence) => competence.year),
    );
    for (let year = Number(todayOn.slice(0, 4)); year >= firstYear; year -= 1) {
      for (let index = periodsPerYear(payroll.period); index >= 1; index -= 1) {
        if (periodStart(year, index, payroll.period) > todayOn) continue;
        periods.push({
          value: `${year}-${index}`,
          label: periodLabel(payroll.period, year, index, ctx.locale, (values) => t("quarter", values)),
        });
      }
    }
  }
  const pending = hasPayrollCalendar(detail)
    ? [...onTheWay(detail.quarters).quarters].sort((a, b) => a.year - b.year || a.quarter - b.quarter)[0]
    : undefined;

  return {
    fundId: fund.id,
    fundName: fund.name,
    today: todayOn,
    format,
    defaults: {
      voluntary: newContributionForm("voluntary", todayOn, { fee: text(voluntaryFee) }),
      payroll: newContributionForm("payroll", todayOn, {
        fee: text(payrollFee),
        period: pending ? `${pending.year}-${pending.quarter}` : "",
      }),
      other: newContributionForm("other", todayOn),
    },
    kind:
      payroll !== null && !sources.some((source) => source.kind === "bank_debit" || source.kind === "manual")
        ? "payroll"
        : "voluntary",
    hasPayroll: payroll !== null,
    periods,
    movements,
  };
}

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline";

/**
 * The Contributions tab of a fund (docs/design/rewrite-plan/ux/n6-pension-fund.md §5.3): the
 * register of the period, then the payslips, the periods and the recurring debits the fund's sources
 * call for. Every table has a list on a narrow page, with the same figures and the same controls.
 * The switch is at the width of the page and not at `md`: with the sidebar, these columns do not fit
 * a tablet.
 */
export async function FundContributions({
  ctx,
  detail,
  setup,
  archived,
  period,
  when,
  settingsHref,
}: {
  ctx: Ctx;
  detail: FundDetail;
  /** What "Record contribution" opens with; `null` for an archived fund, which is read only. */
  setup: ContributionSetup | null;
  archived: boolean;
  period: FundPeriod;
  when: string;
  /** The Settings tab: the link of a recurring debit goes to its section there. */
  settingsHref: string;
}) {
  const t = await getTranslations("funds.fund.contributions");
  const tr = await getTranslations("funds.fund.contributions.register");
  const tc = await getTranslations("funds.contribution");
  const tp = await getTranslations("funds.pension");
  const ts = await getTranslations("funds.sources");
  const { fund, payroll } = detail;
  const money = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat);
  const signed = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true });
  const long = (on: string | null) => (on === null ? NULL_DISPLAY : formatDate(on, "long", ctx.locale));
  const add = <T,>(rows: readonly T[], pick: (row: T) => Cents | null) =>
    rows.reduce<Cents>((sum, row) => sum + (pick(row) ?? 0n), 0n);
  const label = (year: number, index: number) =>
    periodLabel(payroll?.period ?? "quarter", year, index, ctx.locale, (values) => tr("quarter", values));

  // ——— The register (§5.3) ————————————————————————————————————————————————————————————————————
  const rows = detail.operations.filter((one) => inPeriod(one.operationDate, period));
  const voluntary = (one: Operation) => one.classification === "voluntary";
  const periodOf = (one: Operation) =>
    one.competenceYear === null || one.competenceQuarter === null
      ? null
      : label(one.competenceYear, one.competenceQuarter);
  /** A component of the payslip; a voluntary payment has its own column. */
  const part = (one: Operation, cents: Cents) => (voluntary(one) ? null : cents);
  const other = (one: Operation) => (one.classification === "withdrawal" ? -one.otherCents : one.otherCents);
  const showPeriod = rows.some((one) => periodOf(one) !== null);
  const showParts = rows.some(
    (one) => !voluntary(one) && (one.workerCents !== 0n || one.employerCents !== 0n || one.tfrCents !== 0n),
  );
  const showVoluntary = rows.some(voluntary);
  const showOther = rows.some((one) => one.otherCents !== 0n);
  const feeUnknown = rows.some((one) => one.feesUnknown);
  const voluntaryHeader = showParts ? tr("voluntary") : tr("charged");

  const badges = (one: Operation) => (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone="neutral">{tr(`origins.${operationOrigin(one, detail.sources)}`)}</Badge>
      {one.classification !== "contribution" && !voluntary(one) && (
        <Badge tone="accent">{tp(`classes.${one.classification}`)}</Badge>
      )}
    </span>
  );
  const fee = (one: Operation) =>
    one.feesUnknown ? (
      <span title={tr("feeUnknownCell")}>
        <span aria-hidden>{NULL_DISPLAY}</span>
        <span className="sr-only">{tr("feeUnknownCell")}</span>
      </span>
    ) : (
      money(-one.feesCents)
    );
  // One written by hand is edited and deleted. One the app found among the movements is only
  // edited — its fee is how an unknown fee becomes known —: it goes when its movement is hidden in
  // Expenses. One read from a document stays as it was read.
  const actions = (one: Operation) =>
    setup === null || one.source === "import" ? null : (
      <span className="flex justify-end gap-1">
        <EditContributionButton
          setup={setup}
          form={contributionFormOf(one, ctx.numberFormat)}
          locked={one.source === "rule"}
          label={tr("edit")}
          ariaLabel={tr("editLabel", { date: long(one.operationDate) })}
        />
        {one.source === "manual" && (
          <DeleteContributionButton
            fundId={fund.id}
            operationId={one.id}
            date={long(one.operationDate)}
            label={tr("delete")}
            ariaLabel={tr("deleteLabel", { date: long(one.operationDate) })}
          />
        )}
      </span>
    );
  const record = (variant: "primary" | "secondary") =>
    setup === null ? null : <ContributionButton setup={setup} label={tc("record")} variant={variant} />;
  const everEmpty = detail.operations.length === 0;
  const fed = detail.sources.some((source) => source.kind !== "manual");

  // ——— Payslips and periods (§5.3) —————————————————————————————————————————————————————————————
  const months = detail.months.filter(({ competence }) => inPeriod(competenceOn(competence), period));
  type Competence = (typeof months)[number]["competence"];
  const monthTotal = (competence: Competence) =>
    (competence.workerCents ?? 0n) + (competence.employerCents ?? 0n) + (competence.tfrCents ?? 0n);
  const monthName = (competence: Competence) =>
    competence.payrollPeriod
      ? formatDate(competence.payrollPeriod, "monthYear", ctx.locale)
      : tp(`payslipTypes.${competence.payslipType}` as "payslipTypes.thirteenth");
  const monthPeriod = (competence: Competence) =>
    label(competence.year, competencePeriod(competence, payroll?.period ?? "quarter"));
  const statusBadge = (quarter: QuarterStatus) => (
    <Badge tone={STATUS_TONE[quarter.status]}>
      {tp(`statuses.${quarter.status}`)}
      {quarter.reason ? ` · ${tp(`reasons.${quarter.reason}` as "reasons.missing_payslip")}` : ""}
    </Badge>
  );
  const payslipLink = (payslipId: string) => {
    const document = detail.payslipDocuments.get(payslipId) ?? null;
    return (
      document !== null && (
        <Link href={`/payroll/${document}` as Route} className={LINK}>
          {t("payslips.open")}
        </Link>
      )
    );
  };
  const touches = (quarter: QuarterStatus) => quarterInPeriod(quarter, period, payroll?.period ?? "quarter");
  const quarters = hasPayrollCalendar(detail) ? [...detail.quarters].reverse().filter(touches) : [];

  return (
    <>
      <Card padded={false} className="min-w-0" data-testid="fund-contributions">
        <CardHeader
          title={tr("title")}
          actions={
            <>
              <span className="text-sm text-muted @max-2xl:hidden">
                {tr("count", { count: rows.length })}
              </span>
              {record("secondary")}
            </>
          }
        />
        {rows.length === 0 ? (
          <div
            className="flex flex-col items-start gap-2 px-4 pb-4 text-sm"
            data-testid="contributions-empty"
          >
            <p className="text-muted">{everEmpty ? tr("emptyEver") : tr("empty", { when })}</p>
            {everEmpty && fed && <p className="text-muted">{tr("fromSources")}</p>}
            {everEmpty && record("primary")}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto @5xl:block">
              <Table>
                <THead>
                  <Th>{tr("date")}</Th>
                  <Th>{tr("origin")}</Th>
                  {showPeriod && <Th>{tr("period")}</Th>}
                  {showParts && (
                    <>
                      <Th align="right">{t("components.worker")}</Th>
                      <Th align="right">{t("components.employer")}</Th>
                      <Th align="right">{t("components.tfr")}</Th>
                    </>
                  )}
                  {showVoluntary && <Th align="right">{voluntaryHeader}</Th>}
                  {showOther && <Th align="right">{t("other")}</Th>}
                  <Th align="right">{tr("fees")}</Th>
                  <Th align="right">{tr("invested")}</Th>
                  <Th align="right">
                    <span className="sr-only">{tr("actions")}</span>
                  </Th>
                </THead>
                <TBody>
                  {rows.map((one) => (
                    <Tr key={one.id} data-testid="contribution-row" data-on={one.operationDate}>
                      <Td muted className="whitespace-nowrap">
                        {long(one.operationDate)}
                      </Td>
                      <Td>{badges(one)}</Td>
                      {showPeriod && <Td>{periodOf(one) ?? NULL_DISPLAY}</Td>}
                      {showParts && (
                        <>
                          <Td align="right">{money(part(one, one.workerCents))}</Td>
                          <Td align="right">{money(part(one, one.employerCents))}</Td>
                          <Td align="right">{money(part(one, one.tfrCents))}</Td>
                        </>
                      )}
                      {showVoluntary && (
                        <Td align="right">{money(voluntary(one) ? one.workerCents : null)}</Td>
                      )}
                      {showOther && <Td align="right">{money(other(one))}</Td>}
                      <Td align="right" className={cn(one.feesCents !== 0n && "text-neg")}>
                        {fee(one)}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {money(one.netCents)}
                      </Td>
                      <Td align="right">{actions(one)}</Td>
                    </Tr>
                  ))}
                  <TotalRow label={t("total")}>
                    <Td />
                    {showPeriod && <Td />}
                    {showParts && (
                      <>
                        <Td align="right">{money(add(rows, (one) => part(one, one.workerCents)))}</Td>
                        <Td align="right">{money(add(rows, (one) => part(one, one.employerCents)))}</Td>
                        <Td align="right">{money(add(rows, (one) => part(one, one.tfrCents)))}</Td>
                      </>
                    )}
                    {showVoluntary && (
                      <Td align="right" data-testid="contributions-voluntary-total">
                        {money(add(rows, (one) => (voluntary(one) ? one.workerCents : null)))}
                      </Td>
                    )}
                    {showOther && <Td align="right">{money(add(rows, other))}</Td>}
                    <Td align="right" className="text-neg">
                      {money(-add(rows, (one) => one.feesCents))}
                    </Td>
                    <Td align="right" data-testid="contributions-total">
                      {money(add(rows, (one) => one.netCents))}
                    </Td>
                    <Td />
                  </TotalRow>
                </TBody>
              </Table>
            </div>

            <ul className="flex flex-col @5xl:hidden">
              {rows.map((one) => (
                <li
                  key={one.id}
                  data-testid="contribution-item"
                  data-on={one.operationDate}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{long(one.operationDate)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(one.netCents)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    {badges(one)}
                    {periodOf(one) !== null && <span className="text-muted">{periodOf(one)}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    {voluntary(one) ? (
                      <span>
                        {voluntaryHeader} {money(one.workerCents)}
                      </span>
                    ) : (
                      <>
                        {one.workerCents !== 0n && (
                          <span>
                            {t("components.worker")} {money(one.workerCents)}
                          </span>
                        )}
                        {one.employerCents !== 0n && (
                          <span>
                            {t("components.employer")} {money(one.employerCents)}
                          </span>
                        )}
                        {one.tfrCents !== 0n && (
                          <span>
                            {t("components.tfr")} {money(one.tfrCents)}
                          </span>
                        )}
                      </>
                    )}
                    {one.otherCents !== 0n && (
                      <span>
                        {t("other")} {money(other(one))}
                      </span>
                    )}
                    <span className={cn(one.feesCents !== 0n && "text-neg")}>
                      {tr("fees")} {fee(one)}
                    </span>
                  </div>
                  {actions(one)}
                </li>
              ))}
              <li className="flex flex-col gap-1 px-4 py-3 font-medium">
                <span className="flex items-center justify-between gap-2">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">{money(add(rows, (one) => one.netCents))}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 text-sm font-normal text-muted tabular-nums">
                  {showVoluntary && (
                    <span>
                      {voluntaryHeader} {money(add(rows, (one) => (voluntary(one) ? one.workerCents : null)))}
                    </span>
                  )}
                  <span>
                    {tr("fees")} {money(-add(rows, (one) => one.feesCents))}
                  </span>
                </span>
              </li>
            </ul>
            {feeUnknown && (
              <p className="border-t border-border px-4 py-3 text-sm text-muted" data-testid="fee-unknown">
                {tr("feeUnknown")}
              </p>
            )}
          </>
        )}
      </Card>

      {payroll !== null && (
        <Card padded={false} className="min-w-0" data-testid="fund-payslips">
          <CardHeader
            title={t("payslips.title")}
            actions={<span className="text-sm text-muted">{t("payslips.hint")}</span>}
          />
          {months.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted" data-testid="payslips-empty">
              {t("payslips.empty", { when })}
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto @5xl:block">
                <Table>
                  <THead>
                    <Th>{t("payslips.month")}</Th>
                    <Th>{t("payslips.period")}</Th>
                    <Th align="right">{t("components.worker")}</Th>
                    <Th align="right">{t("components.employer")}</Th>
                    <Th align="right">{t("components.tfr")}</Th>
                    <Th align="right">{t("total")}</Th>
                    <Th>{t("payslips.status")}</Th>
                  </THead>
                  <TBody>
                    {months.map(({ competence, quarter }) => (
                      <Tr key={competence.id} data-testid="payslip-line">
                        <Td>
                          <span className="flex flex-wrap items-center gap-2">
                            {monthName(competence)}
                            {payslipLink(competence.payslipId)}
                          </span>
                        </Td>
                        <Td muted>{monthPeriod(competence)}</Td>
                        <Td align="right">{money(competence.workerCents)}</Td>
                        <Td align="right">{money(competence.employerCents)}</Td>
                        <Td align="right">{money(competence.tfrCents)}</Td>
                        <Td align="right" className="font-semibold">
                          {money(monthTotal(competence))}
                        </Td>
                        <Td>{quarter ? statusBadge(quarter) : NULL_DISPLAY}</Td>
                      </Tr>
                    ))}
                    <TotalRow label={t("total")}>
                      <Td />
                      <Td align="right">{money(add(months, (row) => row.competence.workerCents))}</Td>
                      <Td align="right">{money(add(months, (row) => row.competence.employerCents))}</Td>
                      <Td align="right">{money(add(months, (row) => row.competence.tfrCents))}</Td>
                      <Td align="right">{money(add(months, (row) => monthTotal(row.competence)))}</Td>
                      <Td />
                    </TotalRow>
                  </TBody>
                </Table>
              </div>
              <ul className="flex flex-col @5xl:hidden">
                {months.map(({ competence, quarter }) => (
                  <li
                    key={competence.id}
                    data-testid="payslip-item"
                    className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{monthName(competence)}</span>
                        <span className="text-sm text-muted">{monthPeriod(competence)}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {money(monthTotal(competence))}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                      <span>
                        {t("components.worker")} {money(competence.workerCents)}
                      </span>
                      <span>
                        {t("components.employer")} {money(competence.employerCents)}
                      </span>
                      <span>
                        {t("components.tfr")} {money(competence.tfrCents)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {quarter ? statusBadge(quarter) : <span />}
                      {payslipLink(competence.payslipId)}
                    </div>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">
                    {money(add(months, (row) => monthTotal(row.competence)))}
                  </span>
                </li>
              </ul>
            </>
          )}
        </Card>
      )}

      {payroll !== null && hasPayrollCalendar(detail) && (
        <Card padded={false} className="min-w-0" data-testid="fund-quarters">
          <CardHeader
            title={t("quarters.title")}
            actions={
              <span className="text-sm text-muted">
                {t("quarters.hint", { days: payroll.toleranceDays })}
              </span>
            }
          />
          {quarters.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted" data-testid="quarters-empty">
              {t("quarters.empty", { when })}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {quarters.map((quarter) => (
                <li
                  key={`${quarter.year}-${quarter.quarter}`}
                  data-testid="quarter-line"
                  className="flex flex-col gap-2 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {label(quarter.year, quarter.quarter)}
                      {statusBadge(quarter)}
                    </span>
                    <span className="text-sm text-muted">
                      {t("quarters.due", { date: long(quarter.due) })}
                      {quarter.operationDates.length > 0 &&
                        ` · ${t("quarters.credited", { date: long(quarter.operationDates.at(-1) ?? null) })}`}
                    </span>
                  </div>
                  <div className="grid gap-1 text-sm @2xl:grid-cols-2">
                    {quarter.components
                      .filter(
                        (component) =>
                          MAIN_COMPONENTS.includes(component.component) || component.creditedCents !== null,
                      )
                      .map((component) => (
                        <ComponentLine
                          key={component.component}
                          fundId={fund.id}
                          archived={archived}
                          quarter={quarter}
                          component={component}
                          labels={{
                            component: t(`components.${component.component}` as "components.worker"),
                            accrued: t("quarters.accrued"),
                            credited: t("quarters.inFund"),
                            difference: t("quarters.difference"),
                            accept: t("quarters.accept"),
                            clear: t("quarters.clear"),
                          }}
                          money={money}
                          signed={signed}
                        />
                      ))}
                  </div>
                  {quarter.missingMonths.length > 0 && (
                    <p className="text-sm text-warn">
                      {t("quarters.missing", {
                        months: quarter.missingMonths
                          .map((one) => formatDate(one, "monthYear", ctx.locale))
                          .join(", "),
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {detail.debits.length > 0 && (
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2">
          {detail.debits.map(({ source, plan, accountName }) => (
            <Card key={source.id} className="flex min-w-0 flex-col gap-2" data-testid="fund-deposit-rule">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {ts("debit.kpi")}
                <Badge tone={source.state === "active" ? "pos" : "neutral"}>
                  {t(source.state === "active" ? "debit.active" : "debit.paused")}
                </Badge>
              </h2>
              <p className="text-sm">
                {[
                  source.amountCents === null
                    ? frequencyText(ts, plan.frequency.count, plan.frequency.unit)
                    : t("debit.amount", {
                        amount: money(source.amountCents),
                        frequency: frequencyText(ts, plan.frequency.count, plan.frequency.unit),
                      }),
                  plan.day === null ? null : t("debit.day", { day: plan.day }),
                  accountName ? t("debit.account", { account: accountName }) : t("debit.anyAccount"),
                  source.payeeMatch ? t("debit.match", { match: source.payeeMatch }) : null,
                ]
                  .filter((one) => one !== null)
                  .join(" · ")}
              </p>
              <Link href={`${settingsHref}#sources` as Route} className={cn(LINK, "min-w-6 self-start")}>
                {t("debit.edit")}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ComponentLine({
  fundId,
  archived,
  quarter,
  component,
  labels,
  money,
  signed,
}: {
  fundId: string;
  archived: boolean;
  quarter: QuarterStatus;
  component: ComponentStatus;
  labels: Record<"component" | "accrued" | "credited" | "difference" | "accept" | "clear", string>;
  money: (cents: bigint | null) => string;
  signed: (cents: bigint | null) => string;
}) {
  const open = component.status === "discrepancy";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-24 shrink-0 font-medium">{labels.component}</span>
      <span className="text-muted">
        {labels.accrued} {money(component.accruedCents)} · {labels.credited} {money(component.creditedCents)}
      </span>
      {component.differenceCents !== null && component.differenceCents !== 0n && (
        <span className={cn("font-medium", TONE_TEXT[toneOfSign(component.differenceCents)])}>
          {labels.difference} {signed(component.differenceCents)}
        </span>
      )}
      {open && !archived && (
        <AcceptDifferenceButton
          fundId={fundId}
          label={labels.accept}
          target={{
            year: quarter.year,
            quarter: quarter.quarter,
            component: component.component,
            componentLabel: labels.component,
            differenceCents: decimalOf(component.differenceCents ?? 0n),
            accruedCents: component.accruedCents === null ? null : decimalOf(component.accruedCents),
            creditedCents: component.creditedCents === null ? null : decimalOf(component.creditedCents),
            competenceIds: component.competenceIds,
            operationIds: component.operationIds,
            difference: signed(component.differenceCents),
          }}
        />
      )}
      {component.decision && (
        <>
          <span className="text-sm text-muted">{component.decision.note}</span>
          {!archived && (
            <ClearDecisionButton
              fundId={fundId}
              year={quarter.year}
              quarter={quarter.quarter}
              component={component.component}
              label={labels.clear}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Cents as the action reads them back ("-500" → "-5.00"). */
function decimalOf(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}
