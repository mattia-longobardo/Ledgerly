"use client";

import { useTranslations } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import type { RouteOutput } from "@ledgerly/api-client";
import type { funds } from "@ledgerly/api-contract/funds";
import { formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Link } from "@ledgerly/ui/router";
import { toneOfSign } from "@ledgerly/ui/tone";
import { wireMonthPill } from "./present";
import type { Say } from "./say";
import { frequencyText } from "./source-text";
import { cents } from "./wire-forms";

export type Overview = RouteOutput<typeof funds.getFund>;
type Debit = NonNullable<Overview["debit"]>;
type Share = Overview["summary"]["originShares"][number];

const LINK = "focus-ring inline-flex min-h-6 items-center rounded-xs text-sm text-accent hover:underline";

/** Of whom the money is, the parts the server answered: "you 80,00 € · employer 60,00 €". */
function useOriginText(say: Say) {
  const home = useTranslations("funds.home");
  return (parts: readonly Pick<Share, "key" | "amount">[]) =>
    parts
      .map((part) => home(`kpis.originParts.${part.key}`, { amount: formatMoney(cents(part.amount), say.format) }))
      .join(" · ");
}

/** The parts of one contribution of the register, the empty ones left out. */
const operationParts = (operation: Operation) =>
  (["worker", "employer", "tfr", "other"] as const)
    .map((field) => ({ key: field === "worker" ? ("you" as const) : field, amount: operation[field] }))
    .filter((part) => cents(part.amount) !== 0n);

/** A recurring debit not found, always as of today (§5.2), with the way to Expenses. */
export function MissingDebit({ debit, say, prefix }: { debit: Debit; say: Say; prefix?: ReactNode }) {
  const text = useTranslations("funds");
  return (
    <div
      data-testid="fund-alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-neg/30 bg-neg-bg px-3 py-2 text-sm"
    >
      <p>
        {prefix}
        {text("alert.missing", {
          date: formatDate(debit.by, "long", say.locale),
          amount: formatMoney(cents(debit.amount), say.format),
        })}
      </p>
      <Link
        href="/expenses"
        className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-xs font-medium text-accent hover:underline"
      >
        {text("alert.cta")}
      </Link>
    </div>
  );
}

/** On the way, always as of today (§5.3): what the payslips accrued and the fund has not received. */
export function OnTheWay({
  overview,
  say,
  href,
  label,
}: {
  overview: Overview;
  say: Say;
  href: string;
  label: (year: number, index: number) => string;
}) {
  const fundText = useTranslations("funds.fund");
  const pension = useTranslations("funds.pension");
  const { onTheWay } = overview;
  if (!overview.hasCalendar || onTheWay.periods.length === 0) return null;
  const money = (amount: string) => formatMoney(cents(amount), say.format);
  return (
    <p
      data-testid="fund-on-the-way"
      data-cents={String(cents(onTheWay.amount))}
      className="rounded-card border border-border bg-card px-3 py-2 text-sm"
    >
      {pension("notice.pending", {
        amount: money(onTheWay.amount),
        quarters: onTheWay.periods
          .map((pending) =>
            pension("notice.pendingQuarter", {
              quarter: label(pending.year, pending.index),
              amount: money(pending.amount),
              date: formatDate(pending.due, "long", say.locale),
            }),
          )
          .join("; "),
      })}{" "}
      <Link
        href={href}
        className="focus-ring inline-flex min-h-6 items-center rounded-sm font-medium text-accent hover:underline"
      >
        {fundText("onTheWay.link")}
      </Link>
    </p>
  );
}

/** The note of the recurring debit's tile: its frequency, its day and this month's state. */
function useDebitNote(debit: Debit, say: Say) {
  const fundText = useTranslations("funds.fund");
  const sources = useTranslations("funds.sources");
  const text = useTranslations("funds");
  const pill = wireMonthPill(debit, say.locale, {
    found: (date) => text("month.found", { date }),
    awaited: text("month.awaited"),
    missing: text("month.missing"),
    none: text("month.none"),
  });
  const frequency = frequencyText(sources, debit.frequency.count, debit.frequency.unit);
  if (debit.day !== null && debit.status !== "none")
    return sources("debit.kpiNote", { frequency, day: debit.day, status: pill.text });
  if (debit.day !== null) return fundText("kpis.debitDay", { frequency, day: debit.day });
  return debit.status === "none" ? frequency : `${frequency} · ${pill.text}`;
}

function DebitTile({ debit, say }: { debit: Debit; say: Say }) {
  const sources = useTranslations("funds.sources");
  const note = useDebitNote(debit, say);
  return (
    <KpiTile
      testId="kpi-debit"
      wrapNote
      label={sources("debit.kpi")}
      value={
        debit.amount === null ? NULL_DISPLAY : formatMoney(cents(debit.amount), say.format, { signed: false })
      }
      note={note}
    />
  );
}

/** The notes of the paid-in and the fees tiles. */
function useSummaryNotes(overview: Overview, say: Say) {
  const home = useTranslations("funds.home");
  const originText = useOriginText(say);
  const { summary, line, period } = overview;
  const fees = cents(summary.fees) ?? 0n;
  const nothingPaid =
    overview.firstPaidOn !== null && overview.firstPaidOn > period.to
      ? home("kpis.paidInFirst", { date: formatDate(overview.firstPaidOn, "long", say.locale) })
      : home("kpis.nothingPaid");
  const paidNote = cents(line.paidIn) === 0n ? nothingPaid : originText(summary.originShares);
  let feesNote = home("kpis.feesNote");
  if (summary.feesPartial) feesNote = home("kpis.feesUnknown");
  else if (cents(summary.paidIn) === 0n && fees === 0n) feesNote = home("kpis.nothingPaid");
  return { fees, paidNote, feesNote };
}

/** The KPIs of a fund (§5.3): paid in, market, fees, the recurring debit and what the payslips accrued. */
export function OverviewKpis({
  overview,
  say,
  paidLabel,
}: {
  overview: Overview;
  say: Say;
  paidLabel: string;
}) {
  const home = useTranslations("funds.home");
  const { summary, debit } = overview;
  const { fees, paidNote, feesNote } = useSummaryNotes(overview, say);
  const money = (amount: string | null, signed = false) => formatMoney(cents(amount), say.format, { signed });
  const tiles = [
    <KpiTile
      key="paid"
      testId="kpi-paid"
      wrapNote
      label={paidLabel}
      value={money(summary.paidIn)}
      note={paidNote}
    />,
    <KpiTile
      key="market"
      testId="kpi-market"
      wrapNote
      label={home("kpis.market")}
      value={summary.market === null ? NULL_DISPLAY : money(summary.market, true)}
      valueTone={toneOfSign(cents(summary.market))}
      note={summary.market === null ? home("kpis.marketNeedsValue") : home("kpis.marketNote")}
    />,
    <KpiTile
      key="fees"
      testId="kpi-fees"
      wrapNote
      label={home("kpis.fees")}
      value={formatMoney(-fees, say.format, { signed: fees !== 0n })}
      note={feesNote}
    />,
    debit && <DebitTile key="debit" debit={debit} say={say} />,
    summary.state === "payslips_only" && (
      <KpiTile
        key="accrued"
        testId="kpi-accrued"
        wrapNote
        label={home("kpis.accrued")}
        value={money(summary.accrued)}
      />
    ),
  ].filter((tile) => tile !== null && tile !== false);
  return <KpiGrid tiles={tiles} />;
}

// Three tiles in three columns, four in four; five wrap as two and three. On a phone they are two by
// two, and the last of an odd number takes the whole row (§5.2, §11.1).
function KpiGrid({ tiles }: { tiles: ReactElement[] }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        tiles.length === 3 && "@4xl:grid-cols-3",
        tiles.length === 4 && "@4xl:grid-cols-4",
        tiles.length === 5 && "@4xl:grid-cols-6",
      )}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.key}
          className={cn(
            "grid min-w-0",
            tiles.length % 2 === 1 && index === tiles.length - 1 && "col-span-2",
            tiles.length === 3 && "@4xl:col-span-1",
            tiles.length === 5 && (index < 2 ? "@4xl:col-span-3" : "@4xl:col-span-2"),
          )}
        >
          {tile}
        </div>
      ))}
    </div>
  );
}

type Operation = Overview["recent"][number];

/** The money of the period (§6): the last lines of the register, newest first, as the server picked them. */
export function RecentCard({
  overview,
  say,
  href,
  firstStep,
  label,
}: {
  overview: Overview;
  say: Say;
  href: string;
  /** "Record contribution", for a fund with nothing in it yet. */
  firstStep: ReactNode;
  label: (year: number, index: number) => string;
}) {
  const fundText = useTranslations("funds.fund");
  const { recent } = overview;
  return (
    <Card padded={false} className="min-w-0" data-testid="fund-recent">
      <CardHeader
        title={fundText("recent.title")}
        actions={
          <Link href={href} className={LINK}>
            {fundText("recent.allContributions")}
          </Link>
        }
      />
      {recent.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 pb-4 text-sm">
          <p className="text-muted">{fundText("recent.empty")}</p>
          {firstStep}
        </div>
      ) : (
        <ul className="flex flex-col">
          {recent.map((operation) => (
            <RecentLine key={operation.id} operation={operation} say={say} label={label} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentLine({
  operation,
  say,
  label,
}: {
  operation: Operation;
  say: Say;
  label: (year: number, index: number) => string;
}) {
  const fundText = useTranslations("funds.fund");
  const pension = useTranslations("funds.pension");
  const originText = useOriginText(say);
  const day = (date: string) => formatDate(date, "dayMonth", say.locale);
  const money = (amount: string) => formatMoney(cents(amount), say.format);
  const competence =
    operation.competence === null ? null : label(operation.competence.year, operation.competence.index);
  const fee = cents(operation.fee);
  return (
    <li
      data-testid="recent-flow"
      className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{competence ?? day(operation.on)}</span>
          <Badge tone="neutral">{fundText(`contributions.register.origins.${operation.origin}`)}</Badge>
        </span>
        <span className="text-sm text-muted tabular-nums">
          {[
            competence ? day(operation.on) : null,
            operation.classification === "contribution"
              ? originText(operationParts(operation))
              : operation.classification === "voluntary"
                ? null
                : pension(`classes.${operation.classification}`),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
        <span className="font-semibold">{money(operation.gross)}</span>
        {fee !== null && fee !== 0n && (
          <span className="text-sm text-muted">
            {fundText("recent.fee", { amount: formatMoney(-fee, say.format) })}
          </span>
        )}
      </span>
    </li>
  );
}

/** «From accrued to value» (§5.2), for a fund with a payslip source. */
export function BridgeCard({ overview, say }: { overview: Overview; say: Say }) {
  const fundText = useTranslations("funds.fund");
  const pension = useTranslations("funds.pension");
  const { bridge } = overview;
  if (bridge === null) return null;
  return (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="fund-bridge">
      <h2 className="text-lg font-semibold">{fundText("bridge.title")}</h2>
      {bridge.lines === null ? (
        <p className="text-sm text-muted">{fundText("bridgeNoValue")}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            {bridge.lines.map((line) => (
              <div
                key={line.key}
                className={cn(
                  "flex items-baseline justify-between gap-3",
                  line.total && "border-t border-border pt-1 font-semibold",
                )}
              >
                <dt>
                  {line.key === "value" ? fundText("bridgeValue") : pension(`bridge.lines.${line.key}`)}
                </dt>
                <dd className="tabular-nums">
                  {formatMoney(cents(line.amount), say.format, { signed: !line.total })}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            {fundText("bridge.note", { date: formatDate(bridge.on, "long", say.locale) })}
          </p>
        </>
      )}
    </Card>
  );
}
