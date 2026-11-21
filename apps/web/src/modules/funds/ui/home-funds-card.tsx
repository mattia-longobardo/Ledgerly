"use client";

import { useTranslations } from "next-intl";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { type DataColumn, DataTable } from "@ledgerly/ui/data-table";
import { SeriesToggle } from "@ledgerly/ui/highlight";
import { Link } from "@ledgerly/ui/router";
import { Td, TotalRow } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { ValuationButton } from "./fund-forms";
import type { Home, HomeFund, HomeWords } from "./home-cards";
import { wireMonthPill } from "./present";
import type { Say } from "@/platform/say";
import { frequencyText } from "./source-text";
import { cents } from "./wire-forms";

export const money = (say: Say, amount: string | null, signed = false) =>
  formatMoney(cents(amount), say.format, { signed });

const percent = (say: Say, value: number | null) => formatPercent(value, say.format, { signed: true });
const day = (say: Say, date: string | null) => formatDate(date, "dayMonth", say.locale);

/** What a fund's sources say as of today: what is on its way, and its recurring debit. */
function useSubline(say: Say) {
  const homeText = useTranslations("funds.home");
  const sources = useTranslations("funds.sources");
  const fundsText = useTranslations("funds");
  return (fund: HomeFund) => {
    const lines: string[] = [];
    if (fund.hasCalendar && cents(fund.onTheWay.amount) !== 0n) {
      lines.push(
        homeText("list.onTheWay", {
          amount: money(say, fund.onTheWay.amount),
          count: fund.onTheWay.periods.length,
        }),
      );
    }
    const { debit } = fund;
    if (debit !== null && debit.state === "active") {
      const values = {
        amount: money(say, debit.amount),
        frequency: frequencyText(sources, debit.frequency.count, debit.frequency.unit),
      };
      const status = wireMonthPill(debit, say.locale, {
        found: (date) => fundsText("month.found", { date }),
        awaited: fundsText("month.awaited"),
        missing: fundsText("month.missing"),
        none: fundsText("month.none"),
      }).text;
      lines.push(
        debit.status === "none"
          ? homeText("list.debit", values)
          : homeText("list.debitStatus", { ...values, status }),
      );
    }
    return lines.length === 0 ? null : lines.join(" · ");
  };
}

interface FundRows {
  home: Home;
  lines: readonly HomeFund[];
  words: HomeWords;
  subline: (fund: HomeFund) => string | null;
  paidHeader: string;
}

/** The funds, as Investments has them (§6, a-01): most gain first, then the total of the period. */
export function FundsCard({
  home,
  lines,
  words,
}: {
  home: Home;
  lines: readonly HomeFund[];
  words: HomeWords;
}) {
  const homeText = useTranslations("funds.home");
  const { period } = home;
  const subline = useSubline(words.say);
  const paidHeader =
    period.kind === "year"
      ? homeText("list.paidInYear", { year: period.year ?? 0 })
      : homeText("list.paidIn");
  const rows: FundRows = { home, lines, words, subline, paidHeader };
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader title={homeText("list.title")} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{homeText("list.note")}</p>
      <FundsTable {...rows} />
    </Card>
  );
}

/** The name of a fund: its highlight toggle, its link and the archived badge. */
function NameCell({ fund, words }: { fund: HomeFund; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SeriesToggle
        seriesKey={fund.id}
        color={words.colorOf(fund.id)}
        label={homeText("list.highlight", { name: fund.name })}
      />
      <Link
        href={words.fundHref(fund.id)}
        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-sm font-medium hover:underline"
      >
        <span className="truncate">{fund.name}</span>
      </Link>
      {fund.state === "archived" && <Badge tone="neutral">{homeText("list.archived")}</Badge>}
    </span>
  );
}

function GainCell({ fund, say }: { fund: HomeFund; say: Say }) {
  const homeText = useTranslations("funds.home");
  return fund.line?.status === "measured" ? (
    <span
      data-testid="fund-gain"
      data-cents={String(cents(fund.line.gain))}
      className={cn("font-semibold", TONE_TEXT[toneOfSign(cents(fund.line.gain))])}
    >
      {money(say, fund.line.gain, true)}
    </span>
  ) : fund.line?.status === "never_valued" ? (
    <span className="text-muted">{NULL_DISPLAY}</span>
  ) : (
    <span className="text-muted">{homeText("list.undetermined")}</span>
  );
}

function RateCell({ fund, say }: { fund: HomeFund; say: Say }) {
  const homeText = useTranslations("funds.home");
  const rate = fund.line?.rate ?? null;
  const xirr = fund.line?.xirr ?? null;
  return (
    <span
      data-testid="fund-rate"
      title={xirr?.status === "ok" ? homeText("list.xirr", { rate: percent(say, xirr.rate) }) : undefined}
      className={TONE_TEXT[rate === null ? "muted" : toneOfSign(rate)]}
    >
      {percent(say, rate)}
    </span>
  );
}

function ActionCell({ fund, say }: { fund: HomeFund; say: Say }) {
  const homeText = useTranslations("funds.home");
  const fundText = useTranslations("funds.fund");
  if (fund.state === "archived") return null;
  return (
    <ValuationButton
      fundId={fund.id}
      fundName={fund.name}
      today={say.todayOn}
      lastLine={null}
      label={fund.line?.status === "never_valued" ? homeText("list.first") : fundText("recordValue")}
      place="row"
    />
  );
}

/** The funds' columns: the name with its highlight toggle, the figures, the last value's day. */
function useFundColumns({ words, subline, paidHeader }: FundRows): DataColumn<HomeFund>[] {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  return [
    {
      key: "fund",
      header: homeText("list.fund"),
      className: "py-1",
      cell: (fund) => (
        <span className="flex flex-col items-start">
          <NameCell fund={fund} words={words} />
          {subline(fund) && <span className="pl-7 text-xs text-muted">{subline(fund)}</span>}
        </span>
      ),
    },
    {
      key: "paid",
      header: paidHeader,
      align: "right",
      cell: (fund) => money(say, fund.line?.paidIn ?? null),
    },
    {
      key: "gain",
      header: homeText("list.gain"),
      align: "right",
      cell: (fund) => <GainCell fund={fund} say={say} />,
    },
    {
      key: "rate",
      header: homeText("list.rate"),
      align: "right",
      cell: (fund) => <RateCell fund={fund} say={say} />,
    },
    {
      key: "value",
      header: homeText("list.value"),
      align: "right",
      className: "font-semibold",
      cell: (fund) => money(say, fund.line?.value ?? null),
    },
    {
      key: "updated",
      header: homeText("list.updated"),
      className: "py-1",
      cell: (fund) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-sm text-muted">{day(say, fund.line?.end?.on ?? null)}</span>
          <ActionCell fund={fund} say={say} />
        </span>
      ),
    },
  ];
}

/** A fund on a phone: its name and value, its gain and rate, what was paid in and its command. */
function FundItem({ fund, rows }: { fund: HomeFund; rows: FundRows }) {
  const homeText = useTranslations("funds.home");
  const { words, subline, paidHeader } = rows;
  const { say } = words;
  return (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <NameCell fund={fund} words={words} />
          <span className="pl-7 text-xs text-muted tabular-nums">
            {money(say, fund.line?.value ?? null)}
            {fund.line?.end && ` · ${homeText("list.updatedShort", { date: day(say, fund.line.end.on) })}`}
          </span>
          {subline(fund) && <span className="pl-7 text-xs text-muted">{subline(fund)}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
          <GainCell fund={fund} say={say} />
          <span className="text-xs">
            <RateCell fund={fund} say={say} />
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 pl-7">
        <span className="text-xs text-muted tabular-nums">
          {paidHeader} {money(say, fund.line?.paidIn ?? null)}
        </span>
        <ActionCell fund={fund} say={say} />
      </span>
    </>
  );
}

/** The funds as a table from `md`, a line each below it (DataTable), then the period's total. */
function FundsTable(rows: FundRows) {
  const homeText = useTranslations("funds.home");
  const { home, lines, words } = rows;
  const { say } = words;
  const { summary } = home;
  return (
    <DataTable
      columns={useFundColumns(rows)}
      rows={lines}
      rowKey={(fund) => fund.id}
      rowProps={(fund) => ({ "data-testid": "fund-home-row", "data-series-row": fund.id })}
      cardProps={(fund) => ({
        "data-testid": "fund-home-item",
        "data-series-row": fund.id,
        className: "flex flex-col gap-1 border-t border-border px-4 py-2.5",
      })}
      card={(fund) => <FundItem fund={fund} rows={rows} />}
      footer={
        <TotalRow label={homeText("list.total")}>
          <Td align="right">{money(say, summary.paidIn)}</Td>
          <Td align="right" className={TONE_TEXT[toneOfSign(cents(summary.gain))]}>
            {money(say, summary.gain, true)}
          </Td>
          <Td align="right">{percent(say, summary.rate)}</Td>
          <Td align="right">{money(say, summary.value)}</Td>
          <Td />
        </TotalRow>
      }
      cardFooter={
        <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
          <span>{homeText("list.total")}</span>
          <span className={cn("tabular-nums", TONE_TEXT[toneOfSign(cents(summary.gain))])}>
            {money(say, summary.gain, true)}
            {summary.rate !== null && ` · ${percent(say, summary.rate)}`}
          </span>
        </li>
      }
    />
  );
}
