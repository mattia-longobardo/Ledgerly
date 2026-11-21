"use client";

import { useTranslations } from "next-intl";
import type { RouteOutput } from "@ledgerly/api-client";
import type { funds } from "@ledgerly/api-contract/funds";
import { PALETTE } from "@ledgerly/design-tokens";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { CompositionCard } from "@ledgerly/ui/composition-card";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Link } from "@ledgerly/ui/router";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { money } from "./home-funds-card";
import type { Say } from "./say";
import { cents } from "./wire-forms";

export { FundsCard } from "./home-funds-card";

export type Home = RouteOutput<typeof funds.getFunds>;
export type HomeFund = Home["funds"][number];

/** What the cards of the home share: the person's format, the period in words, the links. */
export interface HomeWords {
  say: Say;
  when: string;
  fundHref: (id: string, tab?: string) => string;
  yearHref: (year: number) => string;
  colorOf: (id: string) => string;
}

/** The KPIs of the home (§5.3): paid in, market, fees, and what the payslips accrued or what is on the way. */
export function HomeKpis({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  const { summary } = home;
  const payslipsOnly = summary.state === "payslips_only";
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        payslipsOnly || home.awaitsPayslips ? "@4xl:grid-cols-4" : "@4xl:grid-cols-3",
      )}
    >
      <PaidTile home={home} say={say} />
      <KpiTile
        testId="kpi-market"
        wrapNote
        label={homeText("kpis.market")}
        value={summary.market === null ? NULL_DISPLAY : money(say, summary.market, true)}
        valueTone={toneOfSign(cents(summary.market))}
        note={summary.market === null ? homeText("kpis.marketNeedsValue") : homeText("kpis.marketNote")}
      />
      <FeesTile home={home} say={say} />
      <AccruedTile home={home} say={say} />
    </div>
  );
}

/** What was paid in the period, and where it came from. */
function PaidTile({ home, say }: { home: Home; say: Say }) {
  const homeText = useTranslations("funds.home");
  const { summary, period } = home;
  const paidLabel =
    period.kind === "year"
      ? homeText("kpis.paidInYear", { year: period.year ?? 0 })
      : period.kind === "all"
        ? homeText("kpis.paidIn")
        : homeText("kpis.paidInPeriod");
  const paidIn = cents(summary.paidIn) ?? 0n;
  const paidNote =
    paidIn === 0n
      ? home.firstPaidOn !== null && home.firstPaidOn > period.to
        ? homeText("kpis.paidInFirst", { date: formatDate(home.firstPaidOn, "long", say.locale) })
        : homeText("kpis.nothingPaid")
      : summary.originShares
          .map((part) => homeText(`kpis.originParts.${part.key}`, { amount: money(say, part.amount) }))
          .join(" · ");
  return (
    <KpiTile
      testId="kpi-paid"
      wrapNote
      label={paidLabel}
      value={money(say, summary.paidIn)}
      note={paidNote}
    />
  );
}

/** The fees of the period. */
function FeesTile({ home, say }: { home: Home; say: Say }) {
  const homeText = useTranslations("funds.home");
  const { summary } = home;
  const paidIn = cents(summary.paidIn) ?? 0n;
  const fees = cents(summary.fees) ?? 0n;
  return (
    <KpiTile
      testId="kpi-fees"
      wrapNote
      label={homeText("kpis.fees")}
      value={formatMoney(-fees, say.format, { signed: fees !== 0n })}
      note={
        summary.feesPartial
          ? homeText("kpis.feesUnknown")
          : paidIn === 0n && fees === 0n
            ? homeText("kpis.nothingPaid")
            : homeText("kpis.feesNote")
      }
    />
  );
}

/** What the payslips accrued (payslips only) or what is on the way. */
function AccruedTile({ home, say }: { home: Home; say: Say }) {
  const homeText = useTranslations("funds.home");
  const { summary } = home;
  const accruedFund = home.accrued && home.funds.find((one) => one.id === home.accrued?.fundId);
  if (summary.state === "payslips_only")
    return (
      <KpiTile
        testId="kpi-accrued"
        wrapNote
        label={homeText("kpis.accrued")}
        value={money(say, summary.accrued)}
        note={
          accruedFund && home.accrued?.dueOn
            ? homeText("kpis.accruedNote", {
                name: accruedFund.name,
                date: formatDate(home.accrued.dueOn, "monthYear", say.locale),
              })
            : undefined
        }
      />
    );
  if (!home.awaitsPayslips) return null;
  return (
    <KpiTile
      testId="kpi-on-the-way"
      wrapNote
      label={homeText("kpis.onTheWay")}
      value={money(say, home.onTheWay)}
      note={homeText("kpis.onTheWayNote")}
    />
  );
}

/** Year by year, under All (§6, a-04): the server's years, newest first, and the period's total. */
export function YearsCard({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  if (home.years.length === 0) return null;
  return (
    <Card padded={false} className="min-w-0">
      <CardHeader title={homeText("years.title")} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{homeText("years.note")}</p>
      <YearsTable home={home} words={words} />
      <YearsList home={home} words={words} />
    </Card>
  );
}

const percent = (say: Say, value: number | null) => formatPercent(value, say.format, { signed: true });

/** The fees of a year, as a cost. */
function feesText(say: Say, amount: string) {
  const value = cents(amount) ?? 0n;
  return formatMoney(-value, say.format, { signed: value !== 0n });
}

/** The gain of a year, or «undetermined». */
function YearGain({ amount, say }: { amount: string | null; say: Say }) {
  const homeText = useTranslations("funds.home");
  return amount === null ? (
    <span className="text-muted">{homeText("years.undetermined")}</span>
  ) : (
    money(say, amount, true)
  );
}

/** The year, as the link to its period. */
function YearLink({ year, words }: { year: number; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  return (
    <Link
      href={words.yearHref(year)}
      aria-label={homeText("years.open", { year })}
      className="focus-ring inline-flex min-h-6 items-center rounded-sm font-medium hover:underline"
    >
      {year}
    </Link>
  );
}

/** The years as a table, on a wide screen. */
function YearsTable({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  const { years } = home;
  const thisYear = Number(say.todayOn.slice(0, 4));
  return (
    <div className="overflow-x-auto @max-3xl:hidden">
      <Table>
        <THead>
          <Th>{homeText("years.year")}</Th>
          <Th align="right">{homeText("years.paidIn")}</Th>
          <Th align="right">{homeText("years.market")}</Th>
          <Th align="right">{homeText("years.fees")}</Th>
          <Th align="right">{homeText("years.gain")}</Th>
          <Th align="right">{homeText("years.rate")}</Th>
          <Th align="right">{homeText("years.value")}</Th>
        </THead>
        <TBody>
          {years.map(({ year, summary: row }) => (
            <Tr
              key={year}
              data-testid="year-row"
              data-year={year}
              data-cents={row.gain === null ? "" : String(cents(row.gain))}
            >
              <Td>
                <YearLink year={year} words={words} />
                {year === thisYear && (
                  <span className="ml-2 text-xs text-muted">{homeText("years.ytd")}</span>
                )}
              </Td>
              <Td align="right">{money(say, row.paidIn)}</Td>
              <Td align="right" className={TONE_TEXT[toneOfSign(cents(row.market))]}>
                {money(say, row.market, true)}
              </Td>
              {/* A year with no measure has no fees here: they wait for the next value, as its gain does. */}
              <Td align="right">{row.gain === null ? NULL_DISPLAY : feesText(say, row.fees)}</Td>
              <Td align="right" className={cn("font-semibold", TONE_TEXT[toneOfSign(cents(row.gain))])}>
                <YearGain amount={row.gain} say={say} />
              </Td>
              <Td align="right" className={TONE_TEXT[toneOfSign(row.rate)]}>
                {percent(say, row.rate)}
              </Td>
              <Td align="right">{money(say, row.value)}</Td>
            </Tr>
          ))}
          <YearsTotal home={home} say={say} />
        </TBody>
      </Table>
    </div>
  );
}

/** The total row of the years' table: the period's summary. */
function YearsTotal({ home, say }: { home: Home; say: Say }) {
  const homeText = useTranslations("funds.home");
  const { summary } = home;
  return (
    <TotalRow label={homeText("years.total")}>
      <Td align="right">{money(say, summary.paidIn)}</Td>
      <Td align="right" className={TONE_TEXT[toneOfSign(cents(summary.market))]}>
        {money(say, summary.market, true)}
      </Td>
      <Td align="right">{feesText(say, summary.fees)}</Td>
      <Td align="right" className={TONE_TEXT[toneOfSign(cents(summary.gain))]}>
        {money(say, summary.gain, true)}
      </Td>
      <Td />
      <Td align="right">{money(say, summary.value)}</Td>
    </TotalRow>
  );
}

/** The years as a list, on a narrow screen. */
function YearsList({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  const { years, summary } = home;
  return (
    <ul className="flex flex-col @3xl:hidden">
      {years.map(({ year, summary: row }) => (
        <li
          key={year}
          data-testid="year-item"
          className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <YearLink year={year} words={words} />
            <span className="text-xs text-muted tabular-nums">
              {homeText("years.paidIn")} {money(say, row.paidIn)}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
            <span className={cn("font-semibold", TONE_TEXT[toneOfSign(cents(row.gain))])}>
              <YearGain amount={row.gain} say={say} />
            </span>
            <span className="text-xs text-muted">{money(say, row.value)}</span>
          </span>
        </li>
      ))}
      <li className="flex justify-between gap-3 border-t border-border bg-bg px-4 py-2.5 font-semibold">
        <span>{homeText("years.total")}</span>
        <span className={cn("tabular-nums", TONE_TEXT[toneOfSign(cents(summary.gain))])}>
          {money(say, summary.gain, true)}
        </span>
      </li>
    </ul>
  );
}

/** Who paid in (§5.3, a-01), in the palette of Accounts and Expenses. */
export function WhoPaidCard({ home, words }: { home: Home; words: HomeWords }) {
  const homeText = useTranslations("funds.home");
  const { say } = words;
  const ORIGIN_COLOR = {
    you: PALETTE[0],
    employer: PALETTE[1],
    tfr: PALETTE[6],
    voluntary: PALETTE[4],
    other: PALETTE[11],
  };
  // The parts and their shares of what was paid in are the server's (`originShares`).
  const parts = home.summary.originShares.map((part) => ({
    key: part.key,
    label: homeText(`who.${part.key}`),
    color: ORIGIN_COLOR[part.key],
    share: part.share,
    cells: [money(say, part.amount), formatPercent(part.share, say.format, { signed: false })] as const,
    data: { "data-origin": part.key, "data-cents": String(cents(part.amount)) },
  }));
  return (
    <CompositionCard
      data-testid="who-paid"
      title={homeText("who.title", { when: words.when })}
      parts={parts}
      empty={homeText("who.empty")}
    />
  );
}
