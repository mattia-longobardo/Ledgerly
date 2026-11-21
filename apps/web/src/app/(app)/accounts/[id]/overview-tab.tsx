"use client";

// The tab «Overview» of an account's page: the KPIs of today, the chart over the period of the page
// (PERS-342) by month or by day (F2.5), the month ends and the details. The chart reads the
// account's months in `GET /net-worth`, or its days in `GET /accounts/{id}/daily-balances`.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { views } from "@ledgerly/api-contract/accounts";
import type { Cents } from "@ledgerly/format/cents";
import { today } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  formatPercent,
  fractionToPercent,
  NULL_DISPLAY,
  type NumberFormat,
  numberSeparators,
} from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { AreaLine } from "@ledgerly/ui/charts/area-line";
import { Bars } from "@ledgerly/ui/charts/bars";
import {
  asNumbers,
  axisLabels,
  dayLabels,
  monthLabels,
  symmetricAxisLabels,
} from "@ledgerly/ui/chart-labels";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { parsePeriodQuery, periodEnd, periodMonths, type PeriodQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { centsOf, ConnectionsSummary } from "@/modules/accounts/client";
import type { AccountPage } from "./account-screen";

/** The chart's choices, from the address: the period, its grain, and line or bars. */
interface ChartQuery {
  period: PeriodQuery;
  mode: "line" | "bars";
}

/** What the chart draws: the month ends of the window, or — at day grain — every day of it (F2.5). */
interface Plot {
  labels: string[];
  values: (Cents | null)[];
  estimated: boolean[];
  /** Each point from the one before, as the API answers it; the first has none. */
  changes: { amount: string | null }[];
  xLabels: string[];
  day: boolean;
}

/** The account over the chart's window: the same row of `GET /net-worth`, for the period's months. */
function useWindow(page: AccountPage, period: PeriodQuery) {
  const span = periodMonths(period.range, today(page.format.timeZone));
  return useApi(views.getNetWorth, {
    query: { months: span.months, through: span.through, includeArchived: "true" },
  });
}

export function OverviewTab({ page }: { page: AccountPage }) {
  const search = useSearchParams();
  const query = Object.fromEntries(search.entries());
  const chart: ChartQuery = {
    period: parsePeriodQuery(query, today(page.format.timeZone)),
    mode: query.mode === "bars" ? "bars" : "line",
  };
  return (
    <div className="flex flex-col gap-4">
      <Kpis page={page} />
      {/* Past the wide threshold the chart takes the left and the month-end table and the details
          stack on the right (spec §8.2, F2.5). */}
      <div className="grid items-start gap-4 @wide:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard page={page} chart={chart} />
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @wide:grid-cols-1">
          <MonthEnds page={page} period={chart.period} />
          <Details page={page} />
        </div>
      </div>
    </div>
  );
}

function Kpis({ page }: { page: AccountPage }) {
  const text = useTranslations("accounts.detail");
  const accountsText = useTranslations("accounts");
  const { account, row, format } = page;
  const yoy = centsOf(row.yoy.amount);
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <KpiTile
        label={text("kpis.balance")}
        value={formatMoney(centsOf(row.balance), format.numberFormat, { currency: account.currency })}
        note={accountsText(`types.${account.type}`)}
      />
      <KpiTile
        label={text("kpis.yoy")}
        value={formatPercent(row.yoy.fraction, format.numberFormat, { signed: true })}
        valueTone={toneOfSign(yoy)}
      />
      <KpiTile
        label={text("kpis.share")}
        value={formatPercent(row.share, format.numberFormat)}
        note={text("kpis.shareNote")}
      />
      <KpiTile
        label={text("kpis.opened")}
        value={account.openedOn ? formatDate(account.openedOn, "long", format.locale) : NULL_DISPLAY}
      />
    </div>
  );
}

function ChartCard({ page, chart }: { page: AccountPage; chart: ChartQuery }) {
  const read = useWindow(page, chart.period);
  const { locale } = page.format;
  return (
    <Card padded={false} className="flex flex-col gap-3 p-4">
      <Loaded state={read}>
        {(window) => (
          <>
            <ChartControls page={page} chart={chart} months={window.months.length} />
            {chart.period.grain === "day" ? (
              <DayChart page={page} chart={chart} />
            ) : (
              <PlotView
                page={page}
                mode={chart.mode}
                plot={{
                  labels: window.months.map((month) => formatDate(month, "monthYear", locale)),
                  values: windowRowOf(page, window.accounts).series.map(centsOf),
                  estimated: windowRowOf(page, window.accounts).estimated,
                  changes: windowRowOf(page, window.accounts).seriesChange,
                  xLabels: monthLabels(window.months, locale),
                  day: false,
                }}
              />
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}

/** The chart's title and its controls: the period, the grain and the mode, as links. */
function ChartControls({ page, chart, months }: { page: AccountPage; chart: ChartQuery; months: number }) {
  const text = useTranslations("accounts.detail");
  const path = `/accounts/${page.account.id}`;
  /** Everything the chart's links carry, so switching one control keeps the others. */
  const carried = { ...chart.period.params, mode: chart.mode === "line" ? undefined : chart.mode };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{text("chart.title", { count: months })}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar
          period={chart.period}
          path={path}
          carry={{ mode: carried.mode }}
          locale={page.format.locale}
        />
        <LinkTabs
          label={text("chart.grain")}
          path={path}
          params={carried}
          name="grain"
          current={chart.period.grain}
          options={[
            { value: "month", label: text("chart.grains.month") },
            { value: "day", label: text("chart.grains.day") },
          ]}
        />
        <LinkTabs
          label={text("chart.mode")}
          path={path}
          params={carried}
          name="mode"
          current={chart.mode}
          options={[
            { value: "line", label: text("chart.modes.line") },
            { value: "bars", label: text("chart.modes.bars") },
          ]}
        />
      </div>
    </div>
  );
}

/** The account's row in the window's answer; its row of today when the window has none. */
function windowRowOf(page: AccountPage, rows: AccountPage["row"][]): AccountPage["row"] {
  return rows.find((one) => one.id === page.account.id) ?? page.row;
}

/** Day grain: every day of the window up to today, read only when the chart shows it. */
function DayChart({ page, chart }: { page: AccountPage; chart: ChartQuery }) {
  const { range } = chart.period;
  const read = useApi(views.getAccountDailyBalances, {
    params: { id: page.account.id },
    query: { from: range.from, to: periodEnd(range, today(page.format.timeZone)) },
  });
  return (
    <Loaded state={read}>
      {(daily) => (
        <PlotView
          page={page}
          mode={chart.mode}
          plot={{
            labels: daily.days.map((day) => formatDate(day, "long", page.format.locale)),
            values: daily.values.map(centsOf),
            estimated: daily.estimated,
            changes: daily.changes,
            xLabels: dayLabels(daily.days, page.format.locale),
            day: true,
          }}
        />
      )}
    </Loaded>
  );
}

function PlotView({ page, mode, plot }: { page: AccountPage; mode: ChartQuery["mode"]; plot: Plot }) {
  const text = useTranslations("accounts.detail");
  const accountsText = useTranslations("accounts");
  const { numberFormat } = page.format;
  /** Everything on this tab is the account's own value, in its own currency. */
  const own = { currency: page.account.currency };
  const money = (value: Cents | null, signed = false) => formatMoney(value, numberFormat, { signed, ...own });
  const steps = plot.changes.map((change) => centsOf(change.amount));
  return (
    <>
      {mode === "bars" ? (
        <Bars
          values={asNumbers(steps)}
          yLabels={symmetricAxisLabels(steps, numberFormat, own.currency)}
          xLabels={plot.xLabels}
          summary={text(plot.day ? "chart.dayBarsSummary" : "chart.barsSummary", { name: page.account.name })}
        />
      ) : (
        <AreaLine
          hover={plot.labels.map((label, index) => ({
            label,
            value: money(plot.values[index]),
            note:
              [
                steps[index] === null ? null : `${money(steps[index], true)} ${text("chart.change")}`,
                // Rebuilt from the movements rather than read (spec §7.1, F2.5).
                plot.estimated[index] ? accountsText("estimated.short") : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          }))}
          estimated={plot.estimated}
          values={asNumbers(plot.values)}
          yLabels={axisLabels(plot.values, numberFormat, 4, own.currency)}
          xLabels={plot.xLabels}
          summary={text("chart.summary", {
            name: page.account.name,
            value: money(plot.values[plot.values.length - 1] ?? null),
          })}
        />
      )}
      {plot.estimated.some(Boolean) && <p className="text-sm text-muted">{accountsText("estimated.note")}</p>}
    </>
  );
}

/** The month ends of the window, newest first; the table stays monthly whatever the chart's grain. */
function MonthEnds({ page, period }: { page: AccountPage; period: PeriodQuery }) {
  const text = useTranslations("accounts.detail");
  const read = useWindow(page, period);
  const { numberFormat, locale } = page.format;
  const own = { currency: page.account.currency };
  return (
    <Card padded={false} className="flex flex-col">
      <h2 className="px-4 pt-3.5 pb-2.5 text-lg font-semibold">{text("monthEnd.title")}</h2>
      <Loaded state={read}>
        {(window) => {
          const row = windowRowOf(page, window.accounts);
          const rows = window.months
            .map((month, index) => ({
              month,
              value: centsOf(row.series[index]),
              change: {
                cents: centsOf(row.seriesChange[index].amount),
                fraction: row.seriesChange[index].fraction,
              },
            }))
            .filter((entry) => entry.value !== null)
            .reverse();
          return rows.length === 0 ? (
            <p className="px-4 pb-4 text-muted">{text("monthEnd.empty")}</p>
          ) : (
            <Table>
              <THead>
                <Th>{text("monthEnd.month")}</Th>
                <Th align="right">{text("monthEnd.balance")}</Th>
                <Th align="right">{text("monthEnd.change")}</Th>
                <Th align="right">{text("monthEnd.percent")}</Th>
              </THead>
              <TBody>
                {rows.map((entry) => (
                  <Tr key={entry.month}>
                    <Td>{formatDate(entry.month, "monthYear", locale)}</Td>
                    <Td align="right">{formatMoney(entry.value, numberFormat, own)}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                      {entry.change.cents === null
                        ? NULL_DISPLAY
                        : formatMoney(entry.change.cents, numberFormat, { signed: true, ...own })}
                    </Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                      {formatPercent(entry.change.fraction, numberFormat, { signed: true })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          );
        }}
      </Loaded>
    </Card>
  );
}

type Tiers = AccountPage["context"]["interestRules"][number]["tiers"];

/** A stored rate as Interests writes it — "2,75 %" in Italian, "2.75%" in English — from the API's fraction. */
function rateText(fraction: string, format: NumberFormat): string {
  const plain = fractionToPercent(fraction).replace(".", numberSeparators(format).decimal);
  const name = typeof format === "string" ? format : format.format;
  return name === "en-US" ? `${plain}%` : `${plain} %`;
}

type InterestsText = ReturnType<typeof useTranslations<"interests">>;

/** The tier chips of Interests, one rule after the other: "2,75 % up to 20.000 €", "1,50 % above", or "any balance". */
function ruleTextOf(
  rules: AccountPage["context"]["interestRules"],
  text: InterestsText,
  format: NumberFormat,
): string {
  const chips = (tiers: Tiers) =>
    tiers.map((tier, index) => {
      const range =
        tier.upTo === null
          ? text(tiers.length === 1 ? "tier.any" : "tier.above")
          : text(index === 0 ? "tier.upTo" : "tier.to", {
              amount: formatMoney(centsOf(tier.upTo), format, { decimals: false }),
            });
      return `${rateText(tier.annualRate, format)} ${range}`;
    });
  return rules.flatMap((rule) => chips(rule.tiers)).join(" · ");
}

/** What hangs off the account, read-only here: it is consulted far more often than edited. */
function Details({ page }: { page: AccountPage }) {
  const text = useTranslations("accounts.detail");
  const pocketsText = useTranslations("pockets.account");
  const subscriptionsText = useTranslations("subscriptions.account");
  const interestsText = useTranslations("interests");
  const { account, context, format } = page;
  const rules = context.interestRules;
  const ruleText = ruleTextOf(rules, interestsText, format.numberFormat);
  const paying = context.subscriptions;
  const yesNo = (value: boolean) => (value ? text("details.yes") : text("details.no"));
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{text("details.title")}</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">{text("details.reference")}</dt>
        <dd className="truncate font-mono">{account.reference ?? NULL_DISPLAY}</dd>
        <dt className="text-muted">{text("details.purpose")}</dt>
        <dd className="truncate">{account.purpose ?? NULL_DISPLAY}</dd>
        <dt className="text-muted">{text("details.currency")}</dt>
        <dd>{account.currency}</dd>
        <dt className="text-muted">{text("details.source")}</dt>
        <dd>{page.source}</dd>
        <dt className="text-muted">{text("details.betweenEntries")}</dt>
        <dd>{text(`details.trends.${account.betweenEntries}`)}</dd>
        <dt className="text-muted">{text("details.inNetWorth")}</dt>
        <dd>{yesNo(account.inNetWorth)}</dd>
        <dt className="text-muted">{text("details.inSnapshot")}</dt>
        <dd>{yesNo(account.inSnapshot)}</dd>
        <dt className="text-muted">{pocketsText("label")}</dt>
        <dd className="truncate">
          {context.pockets.length === 0
            ? pocketsText("none")
            : context.pockets.map((pocket) => pocket.name).join(", ")}
        </dd>
        <dt className="text-muted">{interestsText("account.label")}</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate">{ruleText === "" ? interestsText("account.none") : ruleText}</span>
          <Link
            href={rules.length === 1 ? `/interests/${rules[0].id}` : "/interests"}
            className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-xs text-accent hover:underline"
          >
            {interestsText("account.manage")}
          </Link>
        </dd>
        <dt className="text-muted">{subscriptionsText("label")}</dt>
        <dd className="truncate">
          {paying.count === 0
            ? subscriptionsText("none")
            : subscriptionsText("value", {
                count: paying.count,
                amount: formatMoney(centsOf(paying.monthly), format.numberFormat),
              })}
        </dd>
      </dl>
      <ConnectionsSummary accountId={account.id} />
      <span aria-hidden className="h-1 rounded-full" style={{ background: page.color }} />
    </Card>
  );
}
