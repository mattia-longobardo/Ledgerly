"use client";

import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import type { Contributions } from "./contribution-setup";
import { STATUS_TONE } from "./pension-present";
import { AcceptDifferenceButton, ClearDecisionButton } from "./reconciliation-buttons";
import type { Say } from "@/platform/say";
import { frequencyText } from "./source-text";
import { cents } from "./wire-forms";

type Payroll = NonNullable<Contributions["payroll"]>;
type Period = Payroll["periods"][number];
type Component = Period["components"][number];
type Payslip = Contributions["payslips"][number];
type Money = (amount: string | null) => string;

/** The payslip types the messages name; the wire's type is a string. */
const PAYSLIP_TYPES = ["ordinary", "thirteenth", "fourteenth", "fifteenth", "bonus", "settlement"] as const;
const payslipTypeOf = (type: string) => PAYSLIP_TYPES.find((one) => one === type) ?? "ordinary";

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline";

/** The components a period always shows; the enrolment only when the fund credited it. */
const MAIN_COMPONENTS: readonly Component["component"][] = ["worker", "employer", "tfr"];

function StatusBadge({ status, reason }: Pick<Period, "status" | "reason">) {
  const pension = useTranslations("funds.pension");
  return (
    <Badge tone={STATUS_TONE[status]}>
      {pension(`statuses.${status}`)}
      {reason ? ` · ${pension(`reasons.${reason}`)}` : ""}
    </Badge>
  );
}

function PayslipLink({ documentId }: { documentId: string | null }) {
  const text = useTranslations("funds.fund.contributions");
  return documentId === null ? null : (
    <Link href={`/payroll/${documentId}`} className={LINK}>
      {text("payslips.open")}
    </Link>
  );
}

const payslipStatus = (one: Payslip) =>
  one.status === null ? null : <StatusBadge status={one.status} reason={one.reason} />;

interface PayslipsProps {
  payslips: Contributions["payslips"];
  totals: Contributions["payslipTotals"];
  label: (year: number, index: number) => string;
  money: Money;
  monthName: (one: Payslip) => string;
}

/** The payslips of the period (§5.3): one line per competence, with its period and its state. */
export function PayslipsCard({
  contributions,
  when,
  say,
  label,
  money,
}: {
  contributions: Contributions;
  when: string;
  say: Say;
  label: (year: number, index: number) => string;
  money: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const pension = useTranslations("funds.pension");
  const { payslips, payslipTotals: totals } = contributions;
  const monthName = (one: Payslip) =>
    one.month
      ? formatDate(one.month, "monthYear", say.locale)
      : pension(`payslipTypes.${payslipTypeOf(one.payslipType)}`);
  const props = { payslips, totals, label, money, monthName };
  return (
    <Card padded={false} className="min-w-0" data-testid="fund-payslips">
      <CardHeader
        title={text("payslips.title")}
        actions={<span className="text-sm text-muted">{text("payslips.hint")}</span>}
      />
      {payslips.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted" data-testid="payslips-empty">
          {text("payslips.empty", { when })}
        </p>
      ) : (
        <>
          <PayslipsTable {...props} />
          <PayslipsList {...props} />
        </>
      )}
    </Card>
  );
}

function PayslipsTable({ payslips, totals, label, money, monthName }: PayslipsProps) {
  const text = useTranslations("funds.fund.contributions");
  return (
    <div className="hidden overflow-x-auto @5xl:block">
      <Table>
        <THead>
          <Th>{text("payslips.month")}</Th>
          <Th>{text("payslips.period")}</Th>
          <Th align="right">{text("components.worker")}</Th>
          <Th align="right">{text("components.employer")}</Th>
          <Th align="right">{text("components.tfr")}</Th>
          <Th align="right">{text("total")}</Th>
          <Th>{text("payslips.status")}</Th>
        </THead>
        <TBody>
          {payslips.map((one) => (
            <Tr key={one.competenceId} data-testid="payslip-line">
              <Td>
                <span className="flex flex-wrap items-center gap-2">
                  {monthName(one)}
                  <PayslipLink documentId={one.documentId} />
                </span>
              </Td>
              <Td muted>{label(one.year, one.index)}</Td>
              <Td align="right">{money(one.worker)}</Td>
              <Td align="right">{money(one.employer)}</Td>
              <Td align="right">{money(one.tfr)}</Td>
              <Td align="right" className="font-semibold">
                {money(one.total)}
              </Td>
              <Td>{payslipStatus(one) ?? NULL_DISPLAY}</Td>
            </Tr>
          ))}
          <TotalRow label={text("total")}>
            <Td />
            <Td align="right">{money(totals.worker)}</Td>
            <Td align="right">{money(totals.employer)}</Td>
            <Td align="right">{money(totals.tfr)}</Td>
            <Td align="right">{money(totals.total)}</Td>
            <Td />
          </TotalRow>
        </TBody>
      </Table>
    </div>
  );
}

function PayslipsList({ payslips, totals, label, money, monthName }: PayslipsProps) {
  const text = useTranslations("funds.fund.contributions");
  return (
    <ul className="flex flex-col @5xl:hidden">
      {payslips.map((one) => (
        <li
          key={one.competenceId}
          data-testid="payslip-item"
          className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{monthName(one)}</span>
              <span className="text-sm text-muted">{label(one.year, one.index)}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{money(one.total)}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
            <span>
              {text("components.worker")} {money(one.worker)}
            </span>
            <span>
              {text("components.employer")} {money(one.employer)}
            </span>
            <span>
              {text("components.tfr")} {money(one.tfr)}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {payslipStatus(one) ?? <span />}
            <PayslipLink documentId={one.documentId} />
          </div>
        </li>
      ))}
      <li className="flex items-center justify-between gap-2 px-4 py-3 font-medium">
        <span>{text("total")}</span>
        <span className="tabular-nums">{money(totals.total)}</span>
      </li>
    </ul>
  );
}

/** The periods of the payslip source, newest first, each component against what the fund credited. */
export function PeriodsCard({
  contributions,
  payroll,
  archived,
  when,
  say,
  label,
  money,
  signed,
}: {
  contributions: Contributions;
  payroll: Payroll;
  archived: boolean;
  when: string;
  say: Say;
  label: (year: number, index: number) => string;
  money: Money;
  signed: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const { fund } = contributions;
  // The server answers them oldest first; the page reads the newest first.
  const periods = [...payroll.periods].reverse();
  return (
    <Card padded={false} className="min-w-0" data-testid="fund-quarters">
      <CardHeader
        title={text("quarters.title")}
        actions={
          <span className="text-sm text-muted">{text("quarters.hint", { days: payroll.toleranceDays })}</span>
        }
      />
      {periods.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted" data-testid="quarters-empty">
          {text("quarters.empty", { when })}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {periods.map((period) => (
            <PeriodLine
              key={`${period.year}-${period.index}`}
              fundId={fund.id}
              archived={archived}
              period={period}
              say={say}
              label={label}
              money={money}
              signed={signed}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PeriodLine({
  fundId,
  archived,
  period,
  say,
  label,
  money,
  signed,
}: {
  fundId: string;
  archived: boolean;
  period: Period;
  say: Say;
  label: (year: number, index: number) => string;
  money: Money;
  signed: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const long = (date: string | null) => (date === null ? NULL_DISPLAY : formatDate(date, "long", say.locale));
  return (
    <li data-testid="quarter-line" className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {label(period.year, period.index)}
          <StatusBadge status={period.status} reason={period.reason} />
        </span>
        <span className="text-sm text-muted">
          {text("quarters.due", { date: long(period.due) })}
          {period.lastCreditedOn !== null &&
            ` · ${text("quarters.credited", { date: long(period.lastCreditedOn) })}`}
        </span>
      </div>
      <div className="grid gap-1 text-sm @2xl:grid-cols-2">
        {period.components
          .filter((one) => MAIN_COMPONENTS.includes(one.component) || one.credited !== null)
          .map((one) => (
            <ComponentLine
              key={one.component}
              fundId={fundId}
              archived={archived}
              period={period}
              component={one}
              money={money}
              signed={signed}
            />
          ))}
      </div>
      {period.missingMonths.length > 0 && (
        <p className="text-sm text-warn">
          {text("quarters.missing", {
            months: period.missingMonths.map((one) => formatDate(one, "monthYear", say.locale)).join(", "),
          })}
        </p>
      )}
    </li>
  );
}

function ComponentLine({
  fundId,
  archived,
  period,
  component,
  money,
  signed,
}: {
  fundId: string;
  archived: boolean;
  period: Period;
  component: Component;
  money: Money;
  signed: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const name = text(`components.${component.component}`);
  const difference = cents(component.difference);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-24 shrink-0 font-medium">{name}</span>
      <span className="text-muted">
        {text("quarters.accrued")} {money(component.accrued)} · {text("quarters.inFund")}{" "}
        {money(component.credited)}
      </span>
      {difference !== null && difference !== 0n && (
        <span className={cn("font-medium", TONE_TEXT[toneOfSign(difference)])}>
          {text("quarters.difference")} {signed(component.difference)}
        </span>
      )}
      {component.status === "discrepancy" && !archived && (
        <AcceptDifferenceButton
          fundId={fundId}
          label={text("quarters.accept")}
          target={{
            year: period.year,
            quarter: period.index,
            component: component.component,
            componentLabel: name,
            difference: signed(component.difference),
          }}
        />
      )}
      {component.decision && (
        <>
          <span className="text-sm text-muted">{component.decision.note}</span>
          {!archived && (
            <ClearDecisionButton
              fundId={fundId}
              year={period.year}
              quarter={period.index}
              component={component.component}
              label={text("quarters.clear")}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Every recurring debit, active or paused, with the way to its section of Settings. */
export function DebitCards({
  debits,
  settingsHref,
  money,
}: {
  debits: Contributions["debits"];
  settingsHref: string;
  money: Money;
}) {
  const text = useTranslations("funds.fund.contributions");
  const sources = useTranslations("funds.sources");
  if (debits.length === 0) return null;
  return (
    <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2">
      {debits.map((debit) => {
        const frequency = frequencyText(sources, debit.frequency.count, debit.frequency.unit);
        return (
          <Card key={debit.sourceId} className="flex min-w-0 flex-col gap-2" data-testid="fund-deposit-rule">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {sources("debit.kpi")}
              <Badge tone={debit.state === "active" ? "pos" : "neutral"}>
                {text(debit.state === "active" ? "debit.active" : "debit.paused")}
              </Badge>
            </h2>
            <p className="text-sm">
              {[
                debit.amount === null
                  ? frequency
                  : text("debit.amount", { amount: money(debit.amount), frequency }),
                debit.day === null ? null : text("debit.day", { day: debit.day }),
                debit.accountName
                  ? text("debit.account", { account: debit.accountName })
                  : text("debit.anyAccount"),
                debit.payeeMatch ? text("debit.match", { match: debit.payeeMatch }) : null,
              ]
                .filter((one) => one !== null)
                .join(" · ")}
            </p>
            <Link href={`${settingsHref}#sources`} className={cn(LINK, "min-w-6 self-start")}>
              {text("debit.edit")}
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
