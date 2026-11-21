"use client";

import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
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
type Money = (amount: string | null) => string;

export const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm font-medium text-accent hover:underline";

/** The components a period always shows; the enrolment only when the fund credited it. */
const MAIN_COMPONENTS: readonly Component["component"][] = ["worker", "employer", "tfr"];

export function StatusBadge({ status, reason }: Pick<Period, "status" | "reason">) {
  const pension = useTranslations("funds.pension");
  return (
    <Badge tone={STATUS_TONE[status]}>
      {pension(`statuses.${status}`)}
      {reason ? ` · ${pension(`reasons.${reason}`)}` : ""}
    </Badge>
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
