import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, monthLabels } from "@/modules/accounts/ui/display";
import type { Ctx } from "@/platform/context";
import type { MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { MultiLine } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { PensionDetail } from "../pension/queries";
import { MAIN_COMPONENTS, type ComponentStatus, type QuarterStatus } from "../pension/reconcile";
import {
  AcceptDifferenceButton,
  AddVoluntaryButton,
  ClearDecisionButton,
  ContributionRuleForm,
  DeleteOperationButton,
  DeleteRuleButton,
  ImportCometaButton,
  ReceivesPayrollButton,
  ToleranceForm,
} from "./pension-forms";
import { DeleteValuation, EditValuationButton } from "./fund-forms";
import { ForecastCard } from "./forecast-card";
import { ReturnsCard } from "./returns-card";
import { valuationDraft } from "./present";
import {
  type CometaKind,
  kpiBlockedBy,
  missingImports,
  quarterLabel,
  STATUS_TONE,
  transferRhythm,
} from "./pension-present";

export const PENSION_TABS = ["overview", "contributions", "valuations", "settings"] as const;
export type PensionTab = (typeof PENSION_TABS)[number];

/** The design's "Source: payslips" fields: which roles of the code map feed each component. */
const CODE_GROUPS = [
  { key: "worker", roles: ["employee_fund"] },
  { key: "employer", roles: ["employer_fund"] },
  { key: "tfr", roles: ["tfr_contribution"] },
  { key: "enrollment", roles: ["employee_fund_enrollment", "employer_fund_enrollment"] },
  { key: "adjustment", roles: ["employee_fund_adjustment", "employer_fund_adjustment"] },
] as const;

const SPANS = [
  { value: "12", label: "1Y" },
  { value: "24", label: "2Y" },
  { value: "60", label: "All" },
] as const;

/**
 * The pension side of Fund detail (spec §7.7, design "Fund detail" · pension): the six quantities
 * kept apart, each with its date, the reconciliation quarter by quarter, and what explains the
 * differences. `rebuild` and `settingsForm` come from the page: they need both modules at once.
 */
export async function PensionView({
  ctx,
  detail,
  tab,
  span,
  movements,
  rebuild,
  settingsForm,
  valuationButton,
  archiveButton,
  window,
  rangePicker,
}: {
  ctx: Ctx;
  detail: PensionDetail;
  tab: PensionTab;
  span: string;
  movements: readonly { id: string; label: string }[];
  rebuild: ReactNode;
  settingsForm: ReactNode;
  valuationButton: ReactNode;
  archiveButton: ReactNode;
  /** The months the chart draws, already cut to the preset or to the range the picker wrote. */
  window: { months: MonthKey[]; value: (Cents | null)[]; paidIn: (Cents | null)[] };
  rangePicker: ReactNode;
}) {
  const t = await getTranslations("funds.pension");
  const tv = await getTranslations("funds");
  const { fund, metrics } = detail;
  const base = `/funds/${fund.id}`;
  const money = (cents: bigint | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat);
  const signed = (cents: bigint | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true });
  const date = (on: string | null) => (on === null ? NULL_DISPLAY : formatDate(on, "long", ctx.locale));
  const month = (key: string | null) =>
    key === null ? NULL_DISPLAY : formatDate(key, "monthYear", ctx.locale);
  const statusBadge = (status: QuarterStatus["status"], reason: string | null = null) => (
    <Badge tone={STATUS_TONE[status]}>
      {t(`statuses.${status}`)}
      {reason ? ` · ${t(`reasons.${reason}` as "reasons.missing_payslip")}` : ""}
    </Badge>
  );
  /** Which of the two Cometa documents is still missing, and what that leaves unknown (§8.4.7). */
  const missing = missingImports({
    operations: detail.operations.length,
    snapshots: detail.snapshots.length,
    documents: detail.documents,
  });
  const blockedNote = (kind: CometaKind) => t(`kpiReasons.${kind}` as "kpiReasons.cometa_operations");
  const valueBlocked = kpiBlockedBy("value", missing);
  const paidInBlocked = kpiBlockedBy("paidIn", missing);
  /**
   * With no operations export the fund has confirmed nothing, but the payslips and the transfer
   * schedule together say what has left: the quarters past their deadline. That takes the place of
   * "Paid in" rather than a dash (owner, 2026-09-20) — the whole accrued would count money that
   * the next transfer has not carried yet. The quantities stay distinct (GC §1), and the first
   * imported operation wins the real figure back.
   */
  const paidInFromPayslips = paidInBlocked !== null && metrics.accruedCents !== 0n;

  const { months: chartMonths, value: chartValue, paidIn: chartPaid } = window;

  const overview = (
    <>
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={t("kpis.value")}
          value={money(metrics.value?.cents ?? null)}
          note={
            metrics.value
              ? t("kpis.valueNote", { date: date(metrics.value.on) })
              : valueBlocked
                ? blockedNote(valueBlocked)
                : t("kpis.noValue")
          }
        />
        <KpiTile
          label={t("kpis.paidIn")}
          value={
            paidInFromPayslips
              ? money(metrics.transferredCents)
              : paidInBlocked
                ? NULL_DISPLAY
                : money(metrics.paidInCents)
          }
          note={
            paidInFromPayslips
              ? // The figure needs no provenance under it: it is the fund's paid-in like any
                // other, and the owner asked for the caption to go (2026-09-20).
                undefined
              : paidInBlocked
                ? blockedNote(paidInBlocked)
                : t("kpis.paidInNote", { enrollment: money(metrics.enrollmentCents) })
          }
        />
        <KpiTile
          label={t("kpis.gain")}
          value={signed(metrics.gainCents)}
          valueTone={toneOfSign(metrics.gainCents)}
          note={
            metrics.gainCents === null
              ? t(`gainReasons.${metrics.gainReason ?? "no_value"}` as "gainReasons.no_value")
              : t("kpis.gainNote", {
                  percent: formatPercent(metrics.gainFraction, ctx.numberFormat, { signed: true }),
                })
          }
        />
        <KpiTile
          label={t("kpis.pending")}
          value={money(metrics.pendingCents)}
          note={
            metrics.pending.length === 0
              ? t("kpis.pendingNone")
              : t("kpis.pendingNote", { date: date(metrics.pending[0].due) })
          }
        />
      </div>

      {(metrics.pending.length > 0 || detail.valueOlderThanOperations) && (
        <p
          data-testid="pension-notice"
          className="rounded-card border border-border bg-card px-3 py-2 text-sm"
        >
          {metrics.pending.length > 0 &&
            t("notice.pending", {
              amount: money(metrics.pendingCents),
              quarter: quarterLabel(metrics.pending[0].year, metrics.pending[0].quarter),
              date: date(metrics.pending[0].due),
            })}{" "}
          {metrics.value && t("notice.dated", { date: date(metrics.value.on) })}
        </p>
      )}

      <Card className="flex flex-col gap-3" data-testid="pension-chart">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
            <p className="text-sm text-muted">{t("chart.hint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rangePicker}
            <LinkTabs
              label={t("chart.title")}
              path={base}
              params={{ tab }}
              name="span"
              current={span}
              options={SPANS}
            />
          </div>
        </div>
        <MultiLine
          series={[
            // Both step: neither quantity creeps up through a month. The value moves the day a
            // document or a valuation says so, the paid-in the day the money leaves.
            { values: asNumbers(chartValue), color: "var(--accent)", step: true },
            { values: asNumbers(chartPaid), color: "var(--muted)", dashed: true, step: true },
          ]}
          yLabels={axisLabels([...chartValue, ...chartPaid], ctx.numberFormat)}
          xLabels={monthLabels(chartMonths, ctx.locale, Math.min(chartMonths.length, 12))}
          summary={t("chart.summary", { name: fund.name, value: money(metrics.value?.cents ?? null) })}
          height={220}
          hover={chartMonths.map((month, index) => ({
            label: formatDate(month, "monthYear", ctx.locale),
            value: money(chartValue[index] ?? null),
            note: t("chart.hoverPaidIn", { paidIn: money(chartPaid[index] ?? null) }),
          }))}
        />
        <p className="text-sm text-muted">{t("chart.steps")}</p>
      </Card>

      {/* How it did, and where it is heading: the same pair the PAC page has (spec §7.7). The
          tracks are `minmax(0,…)` and the cards may narrow: a grid item is sized by its content
          unless told otherwise, and a wide table inside one pushed the whole row past a phone's
          screen (owner, 2026-09-20). */}
      <div className="grid min-w-0 gap-4 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ReturnsCard
          ctx={ctx}
          periods={detail.periods}
          stats={detail.stats}
          href={`${base}/returns` as Route}
          testId="pension-returns"
        />
        <ForecastCard ctx={ctx} forecast={detail.forecast} testId="pension-forecast" />
      </div>

      <Card padded={false} data-testid="pension-operations">
        <CardHeader
          title={t("operations.title")}
          actions={
            <span className="text-sm text-muted">
              {t("operations.hint", { count: detail.operations.length })}
            </span>
          }
        />
        {detail.operations.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("operations.empty")}</p>
        ) : (
          <>
            {/* Eight columns do not fit a phone: below `md` the same operations are a list, with the
              same figures and the same "Remove" (plan F9 §3.3). */}
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("operations.competence")}</Th>
                  <Th>{t("operations.date")}</Th>
                  <Th align="right">{t("operations.worker")}</Th>
                  <Th align="right">{t("operations.employer")}</Th>
                  <Th align="right">{t("operations.tfr")}</Th>
                  <Th align="right">{t("operations.fees")}</Th>
                  <Th align="right">{t("operations.net")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("operations.remove")}</span>
                  </Th>
                </THead>
                <TBody>
                  {detail.operations.map((operation) => {
                    return (
                      <Tr key={operation.id} data-testid="operation-row">
                        <Td>
                          <span className="flex flex-col">
                            <span className="font-medium">
                              {operation.competenceYear && operation.competenceQuarter
                                ? quarterLabel(operation.competenceYear, operation.competenceQuarter)
                                : t(`classes.${operation.classification}`)}
                            </span>
                            <span className="text-sm text-muted">
                              {operation.originalType}
                              {operation.originalState ? ` · ${operation.originalState}` : ""}
                            </span>
                          </span>
                        </Td>
                        <Td muted>{date(operation.operationDate)}</Td>
                        <Td align="right">{money(operation.workerCents)}</Td>
                        <Td align="right">{money(operation.employerCents)}</Td>
                        <Td align="right">{money(operation.tfrCents)}</Td>
                        <Td align="right" className="text-neg">
                          {operation.feesCents === 0n ? NULL_DISPLAY : money(-operation.feesCents)}
                        </Td>
                        <Td align="right" className="font-semibold">
                          {money(operation.netCents)}
                        </Td>
                        <Td align="right">
                          {operation.source === "manual" && (
                            <span className="flex justify-end gap-1">
                              <DeleteOperationButton
                                fundId={fund.id}
                                operationId={operation.id}
                                label={t("operations.remove")}
                                toast={t("operations.removed")}
                              />
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                  <TotalRow label={t("operations.total")}>
                    <Td />
                    <Td align="right">{money(sum(detail.operations, (one) => one.workerCents))}</Td>
                    <Td align="right">{money(sum(detail.operations, (one) => one.employerCents))}</Td>
                    <Td align="right">{money(sum(detail.operations, (one) => one.tfrCents))}</Td>
                    <Td align="right" className="text-neg">
                      {money(-metrics.feesCents)}
                    </Td>
                    <Td align="right">{money(metrics.investedCents)}</Td>
                    <Td align="right">{metrics.units ?? NULL_DISPLAY}</Td>
                    <Td />
                    <Td />
                  </TotalRow>
                </TBody>
              </Table>
            </div>

            <ul className="flex flex-col md:hidden">
              {detail.operations.map((operation) => (
                <li
                  key={operation.id}
                  data-testid="operation-item"
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {operation.competenceYear && operation.competenceQuarter
                          ? quarterLabel(operation.competenceYear, operation.competenceQuarter)
                          : t(`classes.${operation.classification}`)}
                      </span>
                      <span className="text-sm text-muted">
                        {operation.originalType}
                        {operation.originalState ? ` · ${operation.originalState}` : ""} ·{" "}
                        {date(operation.operationDate)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(operation.netCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span>
                      {t("operations.worker")} {money(operation.workerCents)}
                    </span>
                    <span>
                      {t("operations.employer")} {money(operation.employerCents)}
                    </span>
                    <span>
                      {t("operations.tfr")} {money(operation.tfrCents)}
                    </span>
                    <span className="text-neg">
                      {t("operations.fees")}{" "}
                      {operation.feesCents === 0n ? NULL_DISPLAY : money(-operation.feesCents)}
                    </span>
                  </div>
                  {operation.source === "manual" && (
                    <div className="flex">
                      <DeleteOperationButton
                        fundId={fund.id}
                        operationId={operation.id}
                        label={t("operations.remove")}
                        toast={t("operations.removed")}
                      />
                    </div>
                  )}
                </li>
              ))}
              <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
                <span>{t("operations.total")}</span>
                <span className="tabular-nums">{money(metrics.investedCents)}</span>
              </li>
            </ul>
          </>
        )}
      </Card>

      {/* Side by side and the same height: two cards of a pair that end at different lines read as
          one unfinished (owner, 2026-09-20). The grid stretches them, the card fills its cell. */}
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <Card className="flex h-full flex-col gap-3" data-testid="pension-bridge">
          <h2 className="text-lg font-semibold">{t("bridge.title")}</h2>
          {detail.bridge === null ? (
            <p className="text-sm text-muted">{t("bridge.noValue")}</p>
          ) : (
            <dl className="flex flex-col gap-1 text-sm">
              {detail.bridge.map((line) => (
                <div
                  key={line.key}
                  className={cn(
                    "flex items-baseline justify-between gap-3",
                    line.total && "border-t border-border pt-1 font-semibold",
                  )}
                >
                  <dt>{t(`bridge.lines.${line.key}` as "bridge.lines.accrued")}</dt>
                  <dd className="tabular-nums">{line.total ? money(line.cents) : signed(line.cents)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-sm text-muted">{t("bridge.note")}</p>
        </Card>

        <Card className="flex h-full flex-col gap-3" data-testid="pension-position">
          <h2 className="text-lg font-semibold">{t("position.title")}</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Line
              label={t("position.fees")}
              value={money(metrics.feesCents)}
              note={t("position.feesSplit", {
                enrollment: money(metrics.feesEnrollmentCents),
                association: money(metrics.feesAssociationCents),
              })}
            />
            <Line
              label={t("position.management")}
              value={
                detail.tariffs.find(
                  (row) => row.item === `management_${(fund.compartment ?? "").toLowerCase()}`,
                )?.rate
                  ? formatPercent(
                      Number(
                        detail.tariffs.find(
                          (row) => row.item === `management_${(fund.compartment ?? "").toLowerCase()}`,
                        )!.rate,
                      ),
                      ctx.numberFormat,
                    )
                  : NULL_DISPLAY
              }
              note={t("position.managementNote")}
            />
            <Line
              label={t("position.rule")}
              value={
                detail.contributionRules[0]
                  ? `${detail.contributionRules[0].workerPct ?? "—"} / ${detail.contributionRules[0].employerPct ?? "—"} %`
                  : NULL_DISPLAY
              }
              note={detail.contributionRules[0]?.ccnl ?? t("position.noRule")}
            />
            <Line
              label={t("position.covered")}
              value={month(metrics.coveredUntil)}
              note={t("position.coveredNote")}
            />
          </dl>
        </Card>
      </div>
    </>
  );

  const contributions = (
    <>
      <Card padded={false} data-testid="pension-months">
        <CardHeader
          title={t("months.title")}
          actions={<span className="text-sm text-muted">{t("months.hint")}</span>}
        />
        {detail.months.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("months.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{t("months.period")}</Th>
                <Th>{t("months.quarter")}</Th>
                <Th align="right">{t("months.worker")}</Th>
                <Th align="right">{t("months.employer")}</Th>
                <Th align="right">{t("months.tfr")}</Th>
                <Th align="right">{t("months.total")}</Th>
                <Th>{t("months.status")}</Th>
              </THead>
              <TBody>
                {detail.months.map(({ competence, quarter }) => {
                  const total =
                    (competence.workerCents ?? 0n) +
                    (competence.employerCents ?? 0n) +
                    (competence.tfrCents ?? 0n);
                  const payslip = detail.payslipDocuments.get(competence.payslipId) ?? null;
                  return (
                    <Tr key={competence.id} data-testid="competence-row">
                      <Td>
                        {/* The payslip's corrections are not flagged: accepting the payslip was the
                            decision, and the row's totals already carry them (owner, 2026-09-20).
                            What stays is the way back to the payslip itself. */}
                        <span className="flex items-center gap-2">
                          {competence.payrollPeriod
                            ? formatDate(competence.payrollPeriod, "monthYear", ctx.locale)
                            : t(`payslipTypes.${competence.payslipType}` as "payslipTypes.thirteenth")}
                          {competence.payrollPeriod === null && (
                            <Badge tone="accent">{t("months.thirteenth")}</Badge>
                          )}
                          {payslip !== null && (
                            <Link
                              href={`/payroll/${payslip}` as Route}
                              className="inline-flex h-6 items-center text-sm font-medium text-accent hover:underline"
                            >
                              {t("months.openPayslip")}
                            </Link>
                          )}
                        </span>
                      </Td>
                      <Td muted>{quarterLabel(competence.year, competence.quarter)}</Td>
                      <Td align="right">{money(competence.workerCents)}</Td>
                      <Td align="right">{money(competence.employerCents)}</Td>
                      <Td align="right">{money(competence.tfrCents)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(total)}
                      </Td>
                      <Td>{quarter ? statusBadge(quarter.status, quarter.reason) : NULL_DISPLAY}</Td>
                    </Tr>
                  );
                })}
                <TotalRow label={t("months.totalRow")}>
                  <Td />
                  <Td align="right">{money(sumNullable(detail.competences, (one) => one.workerCents))}</Td>
                  <Td align="right">{money(sumNullable(detail.competences, (one) => one.employerCents))}</Td>
                  <Td align="right">{money(sumNullable(detail.competences, (one) => one.tfrCents))}</Td>
                  <Td align="right">{money(metrics.accruedCents)}</Td>
                  <Td />
                </TotalRow>
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card padded={false} data-testid="pension-quarters">
        <CardHeader
          title={t("quarters.title")}
          actions={
            <span className="text-sm text-muted">
              {t("quarters.hint", { days: detail.schedule?.toleranceDays ?? 15 })}
            </span>
          }
        />
        {detail.quarters.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("quarters.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {[...detail.quarters].reverse().map((quarter) => (
              <li key={`${quarter.year}-${quarter.quarter}`} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {quarterLabel(quarter.year, quarter.quarter)}
                    {statusBadge(quarter.status, quarter.reason)}
                  </span>
                  <span className="text-sm text-muted">
                    {t("quarters.due", { date: date(quarter.due) })}
                    {quarter.operationDates.length > 0 &&
                      ` · ${t("quarters.credited", { date: date(quarter.operationDates.at(-1) ?? null) })}`}
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
                        quarter={quarter}
                        component={component}
                        labels={{
                          component: t(`components.${component.component}`),
                          accrued: t("quarters.accrued"),
                          credited: t("quarters.credited2"),
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

      {/* `min-w-0` everywhere: below `@4xl` this is one `auto` track, and a table's min-content
          would size it — which is how the deductibility card pushed the row 9 px past a phone. */}
      <div className="grid min-w-0 gap-4 @4xl:grid-cols-2">
        <Card className="flex h-full min-w-0 flex-col items-start gap-3" data-testid="pension-voluntary">
          <h2 className="text-lg font-semibold">{t("voluntary.title")}</h2>
          <p className="text-sm text-muted">{t("voluntary.description")}</p>
          <AddVoluntaryButton
            fundId={fund.id}
            today={detail.chart.months.at(-1)?.slice(0, 10) ?? fund.startOn}
            movements={movements}
            label={t("voluntary.add")}
          />
        </Card>

        <Card className="flex h-full min-w-0 flex-col gap-3" data-testid="pension-tax">
          <h2 className="text-lg font-semibold">{t("tax.title")}</h2>
          {detail.taxYears.length === 0 ? (
            <p className="text-sm text-muted">{t("tax.empty")}</p>
          ) : (
            <>
              {/* Five columns of money are 9 px too wide for a phone: below `md`, a list. */}
              <Table className="max-md:hidden">
                <THead>
                  <Th>{t("tax.year")}</Th>
                  <Th align="right">{t("tax.worker")}</Th>
                  <Th align="right">{t("tax.employer")}</Th>
                  <Th align="right">{t("tax.total")}</Th>
                  <Th align="right">{t("tax.limit")}</Th>
                </THead>
                <TBody>
                  {detail.taxYears.map((year) => (
                    <Tr key={year.year}>
                      <Td>{year.year}</Td>
                      <Td align="right">{money(year.workerCents)}</Td>
                      <Td align="right">{money(year.employerCents)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(year.totalCents)}
                      </Td>
                      <Td align="right" muted>
                        {money(year.limitCents)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <ul className="flex flex-col gap-2 md:hidden">
                {detail.taxYears.map((year) => (
                  <li key={year.year} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{year.year}</span>
                      <span className="font-semibold tabular-nums">{money(year.totalCents)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                      <span>
                        {t("tax.worker")} {money(year.workerCents)}
                      </span>
                      <span>
                        {t("tax.employer")} {money(year.employerCents)}
                      </span>
                      <span className="text-muted">
                        {t("tax.limit")} {money(year.limitCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-sm text-muted">{t("tax.note")}</p>
        </Card>
      </div>
    </>
  );

  const valuations = (
    <>
      {/* The value points recorded by hand. For a fund fed by payslips they are the only ones
          there are, so they are listed here and can be corrected, exactly as on a PAC. */}
      <Card padded={false} data-testid="pension-valuations">
        <CardHeader title={tv("valuations.title")} actions={valuationButton} />
        {detail.valuations.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{tv("valuations.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{tv("valuations.date")}</Th>
                <Th align="right">{tv("valuations.value")}</Th>
                <Th align="right">{tv("valuations.paidIn")}</Th>
                <Th align="right">{tv("valuations.gain")}</Th>
                <Th>{tv("valuations.note")}</Th>
                <Th align="right">
                  <span className="sr-only">{tv("valuations.edit")}</span>
                </Th>
              </THead>
              <TBody>
                {detail.valuations.map((row) => (
                  <Tr key={row.id} data-testid="pension-valuation-row">
                    <Td muted>{date(row.on)}</Td>
                    <Td align="right" className="font-semibold">
                      {money(row.valueCents)}
                    </Td>
                    <Td align="right" muted>
                      {money(row.paidInCents)}
                    </Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(row.valueCents - row.paidInCents)]}>
                      {signed(row.valueCents - row.paidInCents)}
                    </Td>
                    <Td muted className="max-w-[240px] truncate">
                      {row.note ?? ""}
                    </Td>
                    <Td align="right">
                      <span className="flex justify-end gap-1">
                        <EditValuationButton
                          fundId={fund.id}
                          draft={valuationDraft(row, ctx.numberFormat)}
                          today={detail.chart.months.at(-1)?.slice(0, 10) ?? fund.startOn}
                          label={tv("valuations.edit")}
                        />
                        <DeleteValuation
                          fundId={fund.id}
                          valuationId={row.id}
                          label={tv("valuations.delete")}
                          toast={tv("toasts.valuationDeleted")}
                        />
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card padded={false} data-testid="pension-statements">
        <CardHeader title={t("statements.title")} actions={valuationButton} />
        {detail.snapshots.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("statements.empty")}</p>
        ) : (
          <>
            {/* Eight columns of money do not fit a phone: below `md` the same statements are a list
              carrying all eight figures (plan F9 §3.3). */}
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("statements.date")}</Th>
                  <Th align="right">{t("statements.value")}</Th>
                  <Th align="right">{t("statements.worker")}</Th>
                  <Th align="right">{t("statements.employer")}</Th>
                  <Th align="right">{t("statements.tfr")}</Th>
                  <Th align="right">{t("statements.inflows")}</Th>
                  <Th align="right">{t("statements.outflows")}</Th>
                  <Th align="right">{t("statements.gain")}</Th>
                </THead>
                <TBody>
                  {detail.snapshots.map((snapshot) => (
                    <Tr key={snapshot.id} data-testid="statement-row">
                      <Td muted>{date(snapshot.valuationDate)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(snapshot.valueCents)}
                      </Td>
                      <Td align="right">{money(snapshot.workerCents)}</Td>
                      <Td align="right">{money(snapshot.employerCents)}</Td>
                      <Td align="right">{money(snapshot.tfrCents)}</Td>
                      <Td align="right">{money(snapshot.inflowsCents)}</Td>
                      <Td align="right">{money(snapshot.outflowsCents)}</Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(snapshot.reportedGainCents)]}>
                        {signed(snapshot.reportedGainCents)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>

            <ul className="flex flex-col md:hidden">
              {detail.snapshots.map((snapshot) => (
                <li
                  key={snapshot.id}
                  data-testid="statement-item"
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted">{date(snapshot.valuationDate)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(snapshot.valueCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span>
                      {t("statements.worker")} {money(snapshot.workerCents)}
                    </span>
                    <span>
                      {t("statements.employer")} {money(snapshot.employerCents)}
                    </span>
                    <span>
                      {t("statements.tfr")} {money(snapshot.tfrCents)}
                    </span>
                    <span>
                      {t("statements.inflows")} {money(snapshot.inflowsCents)}
                    </span>
                    <span>
                      {t("statements.outflows")} {money(snapshot.outflowsCents)}
                    </span>
                    <span className={TONE_TEXT[toneOfSign(snapshot.reportedGainCents)]}>
                      {t("statements.gain")} {signed(snapshot.reportedGainCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card padded={false} data-testid="pension-documents">
        <CardHeader
          title={t("documents.title")}
          actions={<ImportCometaButton fundId={fund.id} label={t("documents.import")} />}
        />
        {detail.documents.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("documents.empty")}</p>
        ) : (
          <>
            {/* A file name and three columns do not fit a phone: below `md`, the same list. */}
            <Table className="max-md:hidden">
              <THead>
                <Th>{t("documents.file")}</Th>
                <Th>{t("documents.kind")}</Th>
                <Th>{t("documents.received")}</Th>
                <Th>{t("documents.state")}</Th>
              </THead>
              <TBody>
                {detail.documents.map((document) => (
                  <Tr key={document.id} data-testid="document-row">
                    <Td>
                      <Link
                        href={`${base}/documents/${document.id}` as Route}
                        className="focus-ring inline-flex min-h-6 items-center rounded-[2px] font-medium hover:underline"
                      >
                        {document.fileName}
                      </Link>
                    </Td>
                    <Td muted>
                      {t(`documents.kinds.${document.kind}` as "documents.kinds.cometa_operations")}
                    </Td>
                    <Td muted>
                      {formatDate(document.receivedAt.toISOString().slice(0, 10), "long", ctx.locale)}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          document.state === "applied"
                            ? "pos"
                            : document.state === "failed"
                              ? "neg"
                              : "neutral"
                        }
                      >
                        {t(`documentStates.${document.state}` as "documentStates.applied")}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>

            <ul className="flex flex-col md:hidden">
              {detail.documents.map((document) => (
                <li
                  key={document.id}
                  data-testid="document-item"
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`${base}/documents/${document.id}` as Route}
                      className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-[2px] font-medium break-all hover:underline"
                    >
                      {document.fileName}
                    </Link>
                    <Badge
                      tone={
                        document.state === "applied" ? "pos" : document.state === "failed" ? "neg" : "neutral"
                      }
                    >
                      {t(`documentStates.${document.state}` as "documentStates.applied")}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted">
                    {t(`documents.kinds.${document.kind}` as "documents.kinds.cometa_operations")} ·{" "}
                    {formatDate(document.receivedAt.toISOString().slice(0, 10), "long", ctx.locale)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );

  const rhythm = transferRhythm(detail.schedule?.schedule ?? []);
  const tariffOf = (item: string) => detail.tariffs.find((row) => row.item === item) ?? null;
  const tariffAmount = (item: string) => {
    const row = tariffOf(item);
    return row?.amountCents === null || row === null ? NULL_DISPLAY : money(row.amountCents);
  };
  const managementTariff = tariffOf(`management_${(fund.compartment ?? "").toLowerCase()}`);
  const newest = detail.tariffs[0] ?? null;

  /**
   * Settings (spec §8.2): short sections two by two as soon as the column allows it, tables across
   * the whole width. The order pairs them by height — the two forms, then the two lists of figures,
   * then the two one-line sections — so no card is left half empty beside a tall neighbour.
   */
  const settings = (
    <SettingsGrid>
      <SettingsSection title={t("settings.general")} description={t("settings.generalDescription")}>
        {settingsForm}
      </SettingsSection>

      <SettingsSection title={t("settings.payroll")} description={t("settings.payrollDescription")}>
        <p className="text-sm">{fund.receivesPayroll ? t("settings.payrollOn") : t("settings.payrollOff")}</p>
        <div className="flex flex-wrap gap-2">
          {!fund.receivesPayroll && (
            <ReceivesPayrollButton
              fundId={fund.id}
              label={t("settings.takePayroll")}
              toast={t("settings.saved")}
            />
          )}
          {fund.receivesPayroll && rebuild}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium">{t("settings.codesTitle")}</span>
          <dl className="flex flex-col gap-1 text-sm">
            {CODE_GROUPS.map((group) => {
              const codes = group.roles.flatMap((role) => detail.codes[role] ?? []);
              return (
                <Line
                  key={group.key}
                  label={t(`settings.codeGroups.${group.key}` as "settings.codeGroups.worker")}
                  value={codes.length > 0 ? codes.join(", ") : NULL_DISPLAY}
                />
              );
            })}
          </dl>
          <p className="text-sm text-muted">{t("settings.codes")}</p>
          <Link
            href={"/settings/data" as Route}
            className="inline-flex h-6 items-center self-start text-sm font-medium text-accent hover:underline"
          >
            {t("settings.openCodeMap")}
          </Link>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.transfers")} description={t("settings.transfersDescription")}>
        {detail.schedule === null ? (
          <p className="text-sm text-muted">{t("settings.noSchedule")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2 text-sm">
              <Line
                label={t("settings.frequency")}
                value={t(`settings.frequencies.${rhythm.frequency}` as "settings.frequencies.quarterly")}
              />
              <Line
                label={t("settings.dueDay")}
                value={rhythm.day === null ? NULL_DISPLAY : String(rhythm.day)}
                note={t("settings.schedule", {
                  dates: (detail.schedule.schedule ?? [])
                    .map((entry) => `${entry.day}/${entry.month}${entry.nextYear ? "+1" : ""}`)
                    .join(" · "),
                })}
              />
            </dl>
            {detail.schedule.source && (
              <p className="text-sm text-muted">
                {t("settings.source", {
                  source: detail.schedule.source,
                  date: date(detail.schedule.verifiedOn),
                })}
              </p>
            )}
          </>
        )}
        <p className="text-sm text-muted">{t("settings.ruleOnly")}</p>
        <ToleranceForm fundId={fund.id} days={detail.schedule?.toleranceDays ?? 15} />
      </SettingsSection>

      <SettingsSection title={t("settings.fees")} description={t("settings.feesDescription")}>
        {detail.tariffs.length === 0 ? (
          <p className="text-sm text-muted">{t("settings.noTariff")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2 text-sm">
              <Line
                label={t("settings.feeItems.enrollmentWorker")}
                value={tariffAmount("enrollment_worker")}
                note={t("settings.feeUnits.once")}
              />
              <Line
                label={t("settings.feeItems.enrollmentEmployer")}
                value={tariffAmount("enrollment_employer")}
                note={t("settings.feeUnits.once")}
              />
              <Line
                label={t("settings.feeItems.association")}
                value={tariffAmount("association")}
                note={t("settings.feeUnits.year")}
              />
              <Line
                label={t("settings.feeItems.management")}
                value={
                  managementTariff?.rate
                    ? formatPercent(Number(managementTariff.rate), ctx.numberFormat)
                    : NULL_DISPLAY
                }
                note={fund.compartment ?? t("settings.feeUnits.yearOfAssets")}
              />
            </dl>
            {newest && (
              <p className="text-sm text-muted">
                {t("settings.tariffFrom", {
                  provider: fund.provider ?? newest.provider,
                  date: date(newest.validFrom),
                })}
              </p>
            )}
          </>
        )}
        <p className="text-sm text-muted">{t("settings.feesActual")}</p>
      </SettingsSection>

      <SettingsSection title={t("settings.rules")} description={t("settings.rulesDescription")}>
        {detail.contributionRules.length > 0 && (
          <Table>
            <THead>
              <Th>{t("settings.from")}</Th>
              <Th>{t("settings.ccnl")}</Th>
              <Th align="right">{t("settings.worker")}</Th>
              <Th align="right">{t("settings.employer")}</Th>
              <Th align="right">{t("settings.tfrShare")}</Th>
              <Th>{t("settings.sourceColumn")}</Th>
              <Th align="right">
                <span className="sr-only">{t("settings.removeRule")}</span>
              </Th>
            </THead>
            <TBody>
              {detail.contributionRules.map((rule) => (
                <Tr key={rule.id} data-testid="rule-row">
                  <Td muted>{date(rule.validFrom)}</Td>
                  <Td>{rule.ccnl ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.workerPct ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.employerPct ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.tfrPct ?? NULL_DISPLAY}</Td>
                  <Td muted className="max-w-[240px] truncate">
                    {rule.source ?? NULL_DISPLAY}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      <DeleteRuleButton fundId={fund.id} ruleId={rule.id} label={t("settings.removeRule")} />
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-accent">
            {t("settings.addRule")}
          </summary>
          <div className="pt-3">
            <ContributionRuleForm
              fundId={fund.id}
              today={detail.chart.months.at(-1)?.slice(0, 10) ?? fund.startOn}
            />
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        title={t("settings.valuationAccount")}
        description={t("settings.valuationDescription")}
      >
        <Link
          href={`/accounts/${fund.valuationAccountId}?tab=settings` as Route}
          className="inline-flex h-6 items-center self-start font-medium text-accent hover:underline"
        >
          {t("settings.openAccount", { account: detail.accountName })}
        </Link>
      </SettingsSection>

      <SettingsSection title={t("settings.danger")} description={t("settings.dangerDescription")}>
        {/* A button is as wide as its label: a section's children stretch, and an «Archive fund»
            drawn across the whole card reads as a banner, not as a command. */}
        <div className="flex">{archiveButton}</div>
      </SettingsSection>
    </SettingsGrid>
  );

  return (
    <>
      {tab === "overview" && overview}
      {tab === "contributions" && contributions}
      {tab === "valuations" && valuations}
      {tab === "settings" && settings}
    </>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="flex flex-col items-end">
        <span className="font-medium tabular-nums">{value}</span>
        {note && <span className="text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function ComponentLine({
  fundId,
  quarter,
  component,
  labels,
  money,
  signed,
}: {
  fundId: string;
  quarter: QuarterStatus;
  component: ComponentStatus;
  labels: Record<"component" | "accrued" | "credited" | "difference" | "accept" | "clear", string>;
  money: (cents: bigint | null) => string;
  signed: (cents: bigint | null) => string;
}) {
  const open = component.status === "discrepancy";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="w-24 shrink-0 font-medium">{labels.component}</span>
      <span className="text-muted">
        {labels.accrued} {money(component.accruedCents)} · {labels.credited} {money(component.creditedCents)}
      </span>
      {component.differenceCents !== null && component.differenceCents !== 0n && (
        <span className={cn("font-medium", TONE_TEXT[toneOfSign(component.differenceCents)])}>
          {labels.difference} {signed(component.differenceCents)}
        </span>
      )}
      {open && (
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
          <ClearDecisionButton
            fundId={fundId}
            year={quarter.year}
            quarter={quarter.quarter}
            component={component.component}
            label={labels.clear}
          />
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

function sum<T>(rows: readonly T[], pick: (row: T) => bigint): bigint {
  return rows.reduce<bigint>((total, row) => total + pick(row), 0n);
}

function sumNullable<T>(rows: readonly T[], pick: (row: T) => bigint | null): bigint {
  return rows.reduce<bigint>((total, row) => total + (pick(row) ?? 0n), 0n);
}
