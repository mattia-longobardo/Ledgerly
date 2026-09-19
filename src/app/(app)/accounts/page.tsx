import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { accountsView } from "@/modules/accounts/queries";
import {
  asNumbers,
  axisLabels,
  changeBetween,
  colorFor,
  monthLabels,
  shareOf,
  since,
} from "@/modules/accounts/ui/display";
import { LinkTabs, PeriodStepper } from "@/modules/accounts/ui/controls";
import { type Grain, periodEnd } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { ButtonLink } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { CompositionBar, Sparkline, StackedArea } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accounts"))("title") };
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const ctx = await requireSession();
  const t = await getTranslations("accounts");
  const now = new Date();

  const query = await searchParams;
  const grain: Grain = query.grain === "year" ? "year" : "month";
  const offset = Math.max(0, Number(query.off ?? 0) || 0);
  const params = { grain: grain === "month" ? undefined : grain, off: offset ? String(offset) : undefined };
  const end = periodEnd(grain, offset, today(ctx.timeZone, now));
  const periodShort = grain === "year" ? end.slice(0, 4) : formatDate(end, "monthShort", ctx.locale);
  const periodLong =
    (grain === "year" ? end.slice(0, 4) : formatDate(end, "monthYear", ctx.locale)) +
    (offset === 0 ? ` · ${grain === "year" ? t("period.ytd") : t("period.today")}` : "");

  const view = await accountsView(ctx, { now, through: end });

  const add = (
    <ButtonLink href="/accounts/new" variant="primary" size="sm">
      {t("add")}
    </ButtonLink>
  );

  if (view.rows.length === 0) {
    return (
      <Page title={t("title")} actions={add}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={
            <ButtonLink href="/accounts/new" variant="primary">
              {t("add")}
            </ButtonLink>
          }
        />
      </Page>
    );
  }

  const rows = view.rows.map((row, index) => {
    const yearAgo = row.series.at(-13) ?? null;
    return {
      ...row,
      color: colorFor(row.account, index),
      change: changeBetween(row.balance, row.previous),
      yoy: changeBetween(row.balance, yearAgo),
      share: shareOf(row.balance, view.total),
      synced: since(row.account.lastSyncedAt, now),
    };
  });

  const kpis = [
    { key: "total" as const, total: view.total, count: view.rows.length },
    { key: "cash" as const, total: view.buckets.cash.total, count: view.buckets.cash.count },
    { key: "savings" as const, total: view.buckets.savings.total, count: view.buckets.savings.count },
    {
      key: "investments" as const,
      total: view.buckets.investments.total,
      count: view.buckets.investments.count,
    },
  ];
  const totalChange = changeBetween(view.total, view.previousTotal);

  /**
   * The chart, drawn like Overview's: one band per account in the net worth, the largest at the end
   * of the window at the bottom of the pile, and the net worth as the line on top.
   */
  const layers = rows
    .filter((row) => row.account.inNetWorth)
    .sort((a, b) => {
      const difference = (b.held.at(-1) ?? 0n) - (a.held.at(-1) ?? 0n);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    });
  const netWorth = view.netWorth.map((point) => point.total);
  /** What the accounts below zero add up to each month: the bottom of the chart's scale. */
  const negatives = view.months.map((_, index) =>
    layers.reduce<Cents>((sum, row) => {
      const value = row.held[index];
      return value !== null && value < 0n ? sum + value : sum;
    }, 0n),
  );

  return (
    <Page title={t("title")} actions={add}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-[-0.02em]">{t("title")}</h1>
        <p className="text-muted">
          {t("summary", {
            total: formatMoney(view.total, ctx.numberFormat),
            count: view.rows.length,
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={t("period.grain")}
          path="/accounts"
          params={params}
          name="grain"
          current={grain}
          options={[
            { value: "month", label: t("period.grains.month") },
            { value: "year", label: t("period.grains.year") },
          ]}
        />
        <PeriodStepper
          label={t("period.label")}
          path="/accounts"
          params={params}
          offset={offset}
          periodLabel={periodLong}
          previousLabel={t("period.previous")}
          nextLabel={t("period.next")}
          latestLabel={t("period.latest")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            label={t(`kpis.${kpi.key}`)}
            value={formatMoney(kpi.total, ctx.numberFormat)}
            note={t("countAccounts", { count: kpi.count })}
          />
        ))}
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Th>{t("columns.name")}</Th>
              <Th>{t("columns.type")}</Th>
              <Th align="right">{t("columns.balanceOn", { period: periodShort })}</Th>
              <Th align="right">{t("columns.monthlyChange")}</Th>
              <Th align="right">{t("columns.yoy")}</Th>
              <Th align="right">{t("columns.share")}</Th>
              <Th>{t("columns.lastSynced")}</Th>
              <Th>{t("columns.history")}</Th>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.account.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: row.color }}
                      />
                      <Link
                        href={`/accounts/${row.account.id}`}
                        className="focus-ring rounded-[2px] font-medium hover:underline"
                      >
                        {row.account.name}
                      </Link>
                      {row.account.state === "unavailable" && (
                        <Badge tone="warn">{t("states.unavailable")}</Badge>
                      )}
                      {row.stale && <Badge tone="warn">{t("stale")}</Badge>}
                    </div>
                  </Td>
                  <Td muted>{t(`types.${row.account.type}`)}</Td>
                  <Td align="right">{formatMoney(row.balance, ctx.numberFormat)}</Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.change.cents)]}>
                    {row.change.cents === null
                      ? NULL_DISPLAY
                      : formatMoney(row.change.cents, ctx.numberFormat, { signed: true })}
                  </Td>
                  <Td align="right" className={TONE_TEXT[toneOfSign(row.yoy.cents)]}>
                    {formatPercent(row.yoy.fraction, ctx.numberFormat, { signed: true })}
                  </Td>
                  <Td align="right">{formatPercent(row.share, ctx.numberFormat)}</Td>
                  <Td muted>
                    {row.account.origin === "manual"
                      ? t("origins.manual")
                      : row.synced.unit === "never"
                        ? t("synced.never")
                        : t(`synced.${row.synced.unit}`, { count: row.synced.count })}
                  </Td>
                  <Td>
                    <Sparkline values={asNumbers(row.series)} tone={row.color} />
                  </Td>
                </Tr>
              ))}
              <TotalRow label={t("total")}>
                <Td />
                <Td align="right">{formatMoney(view.total, ctx.numberFormat)}</Td>
                <Td align="right" className={TONE_TEXT[toneOfSign(totalChange.cents)]}>
                  {totalChange.cents === null
                    ? NULL_DISPLAY
                    : formatMoney(totalChange.cents, ctx.numberFormat, { signed: true })}
                </Td>
                <Td />
                <Td align="right">{formatPercent(view.total === null ? null : 1, ctx.numberFormat)}</Td>
                <Td />
                <Td />
              </TotalRow>
            </TBody>
          </Table>
        </div>
      </Card>

      {view.totalPartial && <p className="text-sm text-warn">{t("partial")}</p>}

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card padded={false} className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">{t("chart.title", { count: view.months.length })}</h2>
          <StackedArea
            layers={layers.map((row) => ({
              label: row.account.name,
              color: row.color,
              values: asNumbers(row.held),
            }))}
            total={asNumbers(netWorth)}
            estimated={view.netWorthEstimated}
            hover={view.months.map((month, index) => ({
              label: formatDate(month, "monthYear", ctx.locale),
              value: formatMoney(netWorth[index], ctx.numberFormat),
              note: view.netWorthEstimated[index] ? t("estimated.short") : undefined,
              // Top of the pile first, as the eye reads the chart.
              rows: [...layers]
                .reverse()
                .filter((row) => row.held[index] !== null)
                .map((row) => ({
                  label: row.account.name,
                  value: formatMoney(row.held[index], ctx.numberFormat),
                  color: row.color,
                })),
            }))}
            yLabels={axisLabels([...netWorth, ...negatives], ctx.numberFormat)}
            xLabels={monthLabels(view.months, ctx.locale)}
            summary={t("chart.summary", { count: layers.length })}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
            {[...layers].reverse().map((row) => (
              <li key={row.account.id} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: row.color }} />
                {row.account.name}
              </li>
            ))}
          </ul>
          {view.netWorthEstimated.some(Boolean) && (
            <p className="text-sm text-muted">{t("estimated.note")}</p>
          )}
        </Card>

        <Card padded={false} className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">{t("composition.title")}</h2>
          <CompositionBar
            parts={rows.map((row) => ({
              label: row.account.name,
              share: row.share ?? 0,
              color: row.color,
            }))}
          />
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((row) => (
              <li key={row.account.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="truncate">{row.account.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {formatPercent(row.share, ctx.numberFormat)}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(row.balance, ctx.numberFormat)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="text-muted">{t("composition.liquid")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(view.buckets.cash.total, ctx.numberFormat)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("composition.invested")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(view.buckets.investments.total, ctx.numberFormat)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </Page>
  );
}
