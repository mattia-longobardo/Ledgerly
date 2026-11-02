import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import type { FundFlow, FundPeriod } from "../period";
import type { PensionDetail } from "../pension/queries";
import { type ComponentStatus, MAIN_COMPONENTS, type QuarterStatus } from "../pension/reconcile";
import { competenceOn, deductibleYears, inPeriod, quarterInPeriod } from "../tabs";
import {
  AcceptDifferenceButton,
  AddVoluntaryButton,
  ClearDecisionButton,
  DeleteOperationButton,
} from "./pension-forms";
import { quarterLabel, STATUS_TONE } from "./pension-present";

/**
 * The Contributions tab of a pension fund (docs/design/funds-ux.md §5.3, §6, F4): payslips, quarters,
 * operations and the deductible by year, all in the period. The tables have a list on a narrow page, with the same
 * figures and the same controls (§4, n. 10). The switch is at the width of the page and not at `md`: with the
 * sidebar, these columns do not fit a tablet.
 */
export async function PensionContributions({
  ctx,
  detail,
  flows,
  archived,
  period,
  when,
  todayOn,
  movements,
}: {
  ctx: Ctx;
  detail: PensionDetail;
  flows: readonly FundFlow[];
  archived: boolean;
  period: FundPeriod;
  when: string;
  todayOn: CivilDate;
  movements: readonly { id: string; label: string }[];
}) {
  const t = await getTranslations("funds.fund.contributions");
  const tp = await getTranslations("funds.pension");
  const { fund } = detail;
  const money = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat);
  const signed = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true });
  const long = (on: string | null) => (on === null ? NULL_DISPLAY : formatDate(on, "long", ctx.locale));
  const add = <T,>(rows: readonly T[], pick: (row: T) => Cents | null) =>
    rows.reduce<Cents>((sum, row) => sum + (pick(row) ?? 0n), 0n);

  const months = detail.months.filter(({ competence }) => inPeriod(competenceOn(competence), period));
  const monthTotal = (competence: (typeof months)[number]["competence"]) =>
    (competence.workerCents ?? 0n) + (competence.employerCents ?? 0n) + (competence.tfrCents ?? 0n);
  const monthName = (competence: (typeof months)[number]["competence"]) =>
    competence.payrollPeriod
      ? formatDate(competence.payrollPeriod, "monthYear", ctx.locale)
      : tp(`payslipTypes.${competence.payslipType}` as "payslipTypes.thirteenth");
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
        <Link
          href={`/payroll/${document}` as Route}
          className="focus-ring inline-flex min-h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {t("payslips.open")}
        </Link>
      )
    );
  };

  const quarters = [...detail.quarters].reverse().filter((quarter) => quarterInPeriod(quarter, period));
  const operations = detail.operations.filter((one) => inPeriod(one.operationDate, period));
  const operationName = (operation: (typeof operations)[number]) =>
    operation.competenceYear && operation.competenceQuarter
      ? quarterLabel(operation.competenceYear, operation.competenceQuarter)
      : tp(`classes.${operation.classification}`);
  const hasOther = operations.some((one) => one.otherCents !== 0n);
  const remove = (operation: (typeof operations)[number]) =>
    operation.source === "manual" && !archived ? (
      <span className="flex justify-end gap-1">
        <DeleteOperationButton
          fundId={fund.id}
          operationId={operation.id}
          label={t("operations.remove")}
          toast={tp("operations.removed")}
        />
      </span>
    ) : null;

  const years = deductibleYears(flows, period, todayOn);

  return (
    <>
      <Card padded={false} className="min-w-0" data-testid="fund-operations">
        <CardHeader
          title={t("operations.title")}
          actions={
            <span className="text-sm text-muted">{t("operations.count", { count: operations.length })}</span>
          }
        />
        {operations.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted" data-testid="operations-empty">
            {t("operations.empty", { when })}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto @5xl:block">
              <Table>
                <THead>
                  <Th>{t("operations.quarter")}</Th>
                  <Th>{t("operations.date")}</Th>
                  <Th align="right">{t("you")}</Th>
                  <Th align="right">{t("employer")}</Th>
                  <Th align="right">{t("tfr")}</Th>
                  {hasOther && <Th align="right">{t("other")}</Th>}
                  <Th align="right">{t("operations.fees")}</Th>
                  <Th align="right">{t("operations.net")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("operations.remove")}</span>
                  </Th>
                </THead>
                <TBody>
                  {operations.map((operation) => (
                    <Tr key={operation.id} data-testid="operation-line" data-on={operation.operationDate}>
                      <Td>
                        <span className="font-medium">{operationName(operation)}</span>
                      </Td>
                      <Td muted>{long(operation.operationDate)}</Td>
                      <Td align="right">{money(operation.workerCents)}</Td>
                      <Td align="right">{money(operation.employerCents)}</Td>
                      <Td align="right">{money(operation.tfrCents)}</Td>
                      {hasOther && <Td align="right">{money(operation.otherCents)}</Td>}
                      <Td align="right" className="text-neg">
                        {operation.feesCents === 0n ? NULL_DISPLAY : money(-operation.feesCents)}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {money(operation.netCents)}
                      </Td>
                      <Td align="right">{remove(operation)}</Td>
                    </Tr>
                  ))}
                  <TotalRow label={t("total")}>
                    <Td />
                    <Td align="right">{money(add(operations, (one) => one.workerCents))}</Td>
                    <Td align="right">{money(add(operations, (one) => one.employerCents))}</Td>
                    <Td align="right">{money(add(operations, (one) => one.tfrCents))}</Td>
                    {hasOther && <Td align="right">{money(add(operations, (one) => one.otherCents))}</Td>}
                    <Td align="right" className="text-neg">
                      {money(-add(operations, (one) => one.feesCents))}
                    </Td>
                    <Td align="right">{money(add(operations, (one) => one.netCents))}</Td>
                    <Td />
                  </TotalRow>
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col @5xl:hidden">
              {operations.map((operation) => (
                <li
                  key={operation.id}
                  data-testid="operation-line-item"
                  data-on={operation.operationDate}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{operationName(operation)}</span>
                      <span className="text-sm text-muted">{long(operation.operationDate)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(operation.netCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span>
                      {t("you")} {money(operation.workerCents)}
                    </span>
                    <span>
                      {t("employer")} {money(operation.employerCents)}
                    </span>
                    <span>
                      {t("tfr")} {money(operation.tfrCents)}
                    </span>
                    {hasOther && (
                      <span>
                        {t("other")} {money(operation.otherCents)}
                      </span>
                    )}
                    <span className="text-neg">
                      {t("operations.fees")}{" "}
                      {operation.feesCents === 0n ? NULL_DISPLAY : money(-operation.feesCents)}
                    </span>
                  </div>
                  {remove(operation)}
                </li>
              ))}
              <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
                <span>{t("total")}</span>
                <span className="tabular-nums">{money(add(operations, (one) => one.netCents))}</span>
              </li>
            </ul>
          </>
        )}
      </Card>

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
                  <Th>{t("payslips.quarter")}</Th>
                  <Th align="right">{t("you")}</Th>
                  <Th align="right">{t("employer")}</Th>
                  <Th align="right">{t("tfr")}</Th>
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
                      <Td muted>{quarterLabel(competence.year, competence.quarter)}</Td>
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
                      <span className="text-sm text-muted">
                        {quarterLabel(competence.year, competence.quarter)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {money(monthTotal(competence))}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                    <span>
                      {t("you")} {money(competence.workerCents)}
                    </span>
                    <span>
                      {t("employer")} {money(competence.employerCents)}
                    </span>
                    <span>
                      {t("tfr")} {money(competence.tfrCents)}
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

      <Card padded={false} className="min-w-0" data-testid="fund-quarters">
        <CardHeader
          title={t("quarters.title")}
          actions={
            <span className="text-sm text-muted">
              {t("quarters.hint", { days: detail.schedule?.toleranceDays ?? 15 })}
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
                    {quarterLabel(quarter.year, quarter.quarter)}
                    {statusBadge(quarter)}
                  </span>
                  <span className="text-sm text-muted">
                    {tp("quarters.due", { date: long(quarter.due) })}
                    {quarter.operationDates.length > 0 &&
                      ` · ${tp("quarters.credited", { date: long(quarter.operationDates.at(-1) ?? null) })}`}
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
                          component: t(`components.${component.component}` as "components.worker"),
                          accrued: tp("quarters.accrued"),
                          credited: tp("quarters.credited2"),
                          difference: tp("quarters.difference"),
                          accept: tp("quarters.accept"),
                          clear: tp("quarters.clear"),
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

      <div className="grid min-w-0 gap-4 @4xl:grid-cols-2">
        <Card className="flex h-full min-w-0 flex-col gap-3" data-testid="fund-deductible">
          <h2 className="text-lg font-semibold">{t("deductible.title")}</h2>
          {years.length === 0 ? (
            <p className="text-sm text-muted">{t("deductible.empty", { when })}</p>
          ) : (
            <>
              <Table className="hidden @5xl:table">
                <THead>
                  <Th>{t("deductible.year")}</Th>
                  <Th align="right">{t("you")}</Th>
                  <Th align="right">{t("employer")}</Th>
                  <Th align="right">{t("deductible.used")}</Th>
                  <Th align="right">{t("deductible.limit")}</Th>
                </THead>
                <TBody>
                  {years.map((year) => (
                    <Tr key={year.year} data-testid="deductible-line" data-cents={String(year.usedCents)}>
                      <Td>{year.year}</Td>
                      <Td align="right">{money(year.youCents)}</Td>
                      <Td align="right">{money(year.employerCents)}</Td>
                      <Td align="right" className="font-semibold">
                        {money(year.usedCents)}
                      </Td>
                      <Td align="right" muted>
                        {money(year.limitCents)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <ul className="flex flex-col gap-2 @5xl:hidden">
                {years.map((year) => (
                  <li key={year.year} data-testid="deductible-item" className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{year.year}</span>
                      <span className="font-semibold tabular-nums">{money(year.usedCents)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
                      <span>
                        {t("you")} {money(year.youCents)}
                      </span>
                      <span>
                        {t("employer")} {money(year.employerCents)}
                      </span>
                      <span className="text-muted">
                        {t("deductible.limit")} {money(year.limitCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-sm text-muted" data-testid="deductible-note">
            {t("deductible.note")}
          </p>
        </Card>

        <Card className="flex h-full min-w-0 flex-col items-start gap-3" data-testid="fund-voluntary">
          <h2 className="text-lg font-semibold">{t("voluntary.title")}</h2>
          <p className="text-sm text-muted">{t("voluntary.description")}</p>
          {!archived && (
            <AddVoluntaryButton
              fundId={fund.id}
              today={todayOn}
              movements={movements}
              label={t("voluntary.add")}
            />
          )}
        </Card>
      </div>
    </>
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
