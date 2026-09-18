import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { accountsView } from "@/modules/accounts/queries";
import { asNumbers, axisLabels, changeBetween, monthLabels } from "@/modules/accounts/ui/display";
import { LinkTabs, RANGE_OPTIONS, type RangeKey, rangeMonths } from "@/modules/accounts/ui/controls";
import { MonthRangePicker } from "@/modules/accounts/ui/month-range-picker";
import { monthRange } from "@/modules/accounts/ui/range";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { ButtonLink } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { AreaLine } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const ctx = await requireSession();
  const t = await getTranslations("overview");
  const ta = await getTranslations("accounts");
  const now = new Date();
  const query = await searchParams;
  const thisMonth = monthKey(today(ctx.timeZone, now));
  const custom = monthRange(query, thisMonth);
  const range: RangeKey = RANGE_OPTIONS.find((option) => option.value === query.range)?.value ?? "1y";
  // The hero, the KPIs and the table always speak of today; only the chart follows the preset or
  // the range the picker wrote (spec §7.1, F2.5). One reading for both used to let a past range
  // print an old net worth under today's date, and made "YTD" blank whenever the chart was 3M.
  const view = await accountsView(ctx, { now });
  const chart = await accountsView(
    ctx,
    custom ? { now, months: custom.months, through: custom.to } : { now, months: rangeMonths(range) },
  );

  if (view.rows.length === 0) {
    return (
      <Page title={t("title")}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={
            <ButtonLink href="/accounts/new" variant="primary">
              {t("empty.cta")}
            </ButtonLink>
          }
        />
      </Page>
    );
  }

  // "All" (or a range reaching back past the history) asks for more months than there are: the
  // months before the first known balance would be an empty stretch of chart, so they are dropped
  // rather than drawn as a gap.
  const firstKnown = chart.netWorth.findIndex((point) => point.total !== null);
  const from = firstKnown < 0 ? 0 : firstKnown;
  const months = chart.months.slice(from);
  const series = chart.netWorth.slice(from).map((point) => point.total);
  // Months that stand on a month end rebuilt from the movements (spec §7.1, F2.5): drawn dashed.
  const estimated = chart.netWorthEstimated.slice(from);

  const monthly = changeBetween(view.total, view.previousTotal);
  const yearStart = view.months.indexOf(`${thisMonth.slice(0, 4)}-01-01`);
  const ytd = changeBetween(view.total, yearStart > 0 ? view.netWorth[yearStart - 1].total : null);

  const kpis = [
    { key: "cash", bucket: view.buckets.cash },
    { key: "savings", bucket: view.buckets.savings },
    { key: "investments", bucket: view.buckets.investments },
  ] as const;

  return (
    <Page
      title={t("title")}
      actions={
        <ButtonLink href="/accounts/new" variant="primary" size="sm">
          {ta("add")}
        </ButtonLink>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm font-medium text-muted">
            {t("netWorth.on", { date: formatDate(today(ctx.timeZone, now), "long", ctx.locale) })}
          </h1>
          <p className="text-hero font-semibold tracking-[-0.02em]">
            {formatMoney(view.total, ctx.numberFormat)}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("font-medium", TONE_TEXT[toneOfSign(monthly.cents)])}>
              {formatMoney(monthly.cents, ctx.numberFormat, { signed: true })}
              {monthly.fraction !== null &&
                ` (${formatPercent(monthly.fraction, ctx.numberFormat, { signed: true })})`}
            </span>
            <span className="text-muted">{t("netWorth.vsLastMonth")}</span>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <span className="text-muted">
              {t("netWorth.ytd", {
                value: formatMoney(ytd.cents, ctx.numberFormat, { signed: true }),
              })}
            </span>
          </p>
        </div>
        <p className="text-sm text-muted">
          {view.lastSnapshot
            ? t("lastSnapshot", {
                date: formatDate(view.lastSnapshot.month, "monthYear", ctx.locale),
              })
            : t("noSnapshot")}
        </p>
      </div>

      {view.totalPartial && <p className="text-sm text-warn">{t("partial")}</p>}

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-3">
        {kpis.map(({ key, bucket }) => (
          <KpiTile
            key={key}
            label={t(`kpis.${key}`)}
            value={formatMoney(bucket.total, ctx.numberFormat)}
            note={ta("countAccounts", { count: bucket.count })}
          />
        ))}
      </div>

      {/* Past the wide threshold the chart and the accounts sit side by side (spec §8.2, F2.5). */}
      <div className="grid items-start gap-4 @wide:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card padded={false} className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <MonthRangePicker
                from={months[0]}
                to={months[months.length - 1]}
                path="/"
                params={{}}
                locale={ctx.locale}
              />
              {/* A preset link carries no `from`/`to`: picking one leaves the custom range. */}
              <LinkTabs
                label={t("chart.range")}
                path="/"
                params={{}}
                name="range"
                current={custom ? "" : range}
                options={RANGE_OPTIONS}
              />
            </div>
          </div>
          <AreaLine
            hover={months.map((month, index) => ({
              label: formatDate(month, "monthYear", ctx.locale),
              value: formatMoney(series[index], ctx.numberFormat),
              note: estimated[index] ? ta("estimated.short") : undefined,
            }))}
            estimated={estimated}
            values={asNumbers(series)}
            yLabels={axisLabels(series, ctx.numberFormat)}
            xLabels={monthLabels(months, ctx.locale)}
            summary={t("chart.summary", {
              from: formatDate(months[0], "monthYear", ctx.locale),
              to: formatDate(months[months.length - 1], "monthYear", ctx.locale),
              value: formatMoney(series[series.length - 1] ?? null, ctx.numberFormat),
            })}
          />
          {estimated.some(Boolean) && <p className="text-sm text-muted">{ta("estimated.note")}</p>}
        </Card>

        <Card padded={false}>
          <CardHeader
            title={ta("title")}
            actions={
              <Link href="/accounts" className="focus-ring rounded-[2px] text-accent hover:underline">
                {t("manageAccounts")}
              </Link>
            }
          />
          <Table>
            <THead>
              <Th>{ta("columns.name")}</Th>
              <Th>{ta("columns.type")}</Th>
              <Th align="right">{ta("columns.balance")}</Th>
              <Th align="right">{ta("columns.monthlyChange")}</Th>
            </THead>
            <TBody>
              {view.rows.map((row) => {
                const change = changeBetween(row.balance, row.previous);
                return (
                  <Tr key={row.account.id}>
                    <Td>
                      <Link
                        href={`/accounts/${row.account.id}`}
                        className="focus-ring rounded-[2px] font-medium hover:underline"
                      >
                        {row.account.name}
                      </Link>
                    </Td>
                    <Td muted>{ta(`types.${row.account.type}`)}</Td>
                    <Td align="right">{formatMoney(row.balance, ctx.numberFormat)}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(change.cents)]}>
                      {change.cents === null
                        ? NULL_DISPLAY
                        : formatMoney(change.cents, ctx.numberFormat, { signed: true })}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </div>
    </Page>
  );
}
