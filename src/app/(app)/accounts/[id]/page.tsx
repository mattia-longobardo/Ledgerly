import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { accountsView, listBalanceEntries } from "@/modules/accounts/queries";
import {
  asNumbers,
  axisLabels,
  changeBetween,
  colorFor,
  dayLabels,
  monthLabels,
  shareOf,
  since,
  symmetricAxisLabels,
} from "@/modules/accounts/ui/display";
import { BalanceEntries, type EntryRow } from "@/modules/accounts/ui/balance-entries";
import { AccountSettingsForm } from "@/modules/accounts/ui/settings-form";
import { accountDailyBalances } from "@/modules/accounts/service";
import { LinkTabs, type SpanKey, SPAN_OPTIONS, spanMonths } from "@/modules/accounts/ui/controls";
import { MonthRangePicker } from "@/modules/accounts/ui/month-range-picker";
import { monthRange } from "@/modules/accounts/ui/range";
import { pocketsOnAccount } from "@/modules/pockets/queries";
import { subscriptionsOnAccount } from "@/modules/subscriptions/queries";
import { rulesOnAccount } from "@/modules/interests/queries";
import { tierChips } from "@/modules/interests/ui/present";
import { requireSession } from "@/platform/auth/session";
import { getAccount } from "@/modules/accounts/queries";
import { lastDayOfMonth, monthKey, today } from "@/platform/dates";
import { centsToDecimal } from "@/platform/money";
import { formatAmountInput, formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { AreaLine, Bars } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

const TABS = ["overview", "transactions", "entries", "settings"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const account = await getAccount(ctx, (await params).id);
  return { title: account?.name ?? (await getTranslations("accounts"))("title") };
}

export default async function AccountDetailPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const ctx = await requireSession();
  const t = await getTranslations("accounts");
  const td = await getTranslations("accounts.detail");
  const { id } = await params;
  const now = new Date();

  const query = await searchParams;
  const thisMonth = monthKey(today(ctx.timeZone, now));
  const custom = monthRange(query, thisMonth);
  const span: SpanKey = SPAN_OPTIONS.find((option) => option.value === query.span)?.value ?? "1y";
  const chart = {
    mode: query.mode === "bars" ? ("bars" as const) : ("line" as const),
    // Month ends, or every day of the window (F2.5).
    grain: query.grain === "day" ? ("day" as const) : ("month" as const),
    span,
    custom: custom !== null,
  };
  const width = custom ? custom.months : spanMonths(span, Number(thisMonth.slice(5, 7)));

  // The header and the KPIs speak of today whatever window the chart shows (spec §7.1, F2.5): one
  // reading for both used to put the balance at the end of a past range under "this month", and
  // left "Year over year" blank on any span shorter than thirteen months.
  const view = await accountsView(ctx, { now });
  const index = view.rows.findIndex((row) => row.account.id === id);
  if (index < 0) notFound();
  const row = view.rows[index];
  const account = row.account;
  const window = await accountsView(ctx, { now, months: width, through: custom?.to ?? thisMonth });
  const windowRow = window.rows.find((one) => one.account.id === id) ?? row;

  const requested = query.tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "overview";
  const tabs = TABS.map((key) => ({
    href: (key === "overview" ? `/accounts/${id}` : `/accounts/${id}?tab=${key}`) as Route,
    label: td(`tabs.${key}`),
    active: key === tab,
  }));

  // Day grain: every day of the window up to today, read only when the chart shows it.
  const todayOn = today(ctx.timeZone, now);
  const windowEnd = lastDayOfMonth(window.months[window.months.length - 1]);
  const daily =
    tab === "overview" && chart.grain === "day"
      ? await accountDailyBalances(ctx, id, {
          from: window.months[0],
          to: windowEnd < todayOn ? windowEnd : todayOn,
        })
      : null;

  const change = changeBetween(row.balance, row.previous);
  const yoy = changeBetween(row.balance, row.series.at(-13) ?? null);
  const share = shareOf(row.balance, view.total);
  const synced = since(account.lastSyncedAt, now);
  const color = colorFor(account, index);

  return (
    <Page title={account.name} parent={{ href: "/accounts", label: t("title") }}>
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
          <span>{t(`types.${account.type}`)}</span>
          <span aria-hidden>·</span>
          <span>
            {account.origin === "manual"
              ? t("origins.manual")
              : t("origins.syncedWith", { provider: account.provider ?? "" })}
          </span>
          {account.origin === "synced" && (
            <>
              <span aria-hidden>·</span>
              <span>
                {synced.unit === "never"
                  ? t("synced.never")
                  : t(`synced.${synced.unit}`, { count: synced.count })}
              </span>
            </>
          )}
          {account.state !== "active" && <Badge tone="warn">{t(`states.${account.state}`)}</Badge>}
          {row.stale && <Badge tone="warn">{t("stale")}</Badge>}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{account.name}</h1>
        <p className="flex flex-wrap items-baseline gap-3">
          <span className="text-hero-sm font-semibold tracking-[-0.02em]">
            {formatMoney(row.balance, ctx.numberFormat)}
          </span>
          <span className={`text-sm font-medium ${TONE_TEXT[toneOfSign(change.cents)]}`}>
            {change.cents === null
              ? NULL_DISPLAY
              : formatMoney(change.cents, ctx.numberFormat, { signed: true })}{" "}
            {td("thisMonth")}
          </span>
          <span className="text-sm text-muted">
            {td("shareOfNetWorth", { value: formatPercent(share, ctx.numberFormat) })}
          </span>
        </p>
      </header>

      <TabLinks label={td("tabs.label")} tabs={tabs} />

      {tab === "overview" && (
        <OverviewTab
          ctx={ctx}
          row={row}
          windowRow={windowRow}
          months={window.months}
          daily={daily}
          range={custom}
          yoy={yoy}
          share={share}
          color={color}
          id={id}
          chart={chart}
        />
      )}

      {tab === "transactions" && (
        <EmptyState title={td("transactions.title")} description={td("transactions.description")} />
      )}

      {tab === "entries" && (
        <BalanceEntries
          accountId={id}
          today={today(ctx.timeZone, now)}
          synced={account.origin === "synced"}
          entries={await entryRows(ctx, id)}
        />
      )}

      {tab === "settings" && (
        <AccountSettingsForm
          today={today(ctx.timeZone, now)}
          // The place the account holds in the list, so the colour control shows the colour the
          // charts and the list really draw it with (`colorFor`) rather than a fixed blue.
          index={index}
          account={{
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency,
            provider: account.provider,
            origin: account.origin,
            state: account.state,
            color: account.color,
            reference: account.reference,
            purpose: account.purpose,
            openedOn: account.openedOn,
            notes: account.notes,
            inNetWorth: account.inNetWorth,
            inSnapshot: account.inSnapshot,
            countsAsLiquid: account.countsAsLiquid,
            lowBalance: account.lowBalanceCents === null ? "" : centsToDecimal(account.lowBalanceCents),
            staleAfterHours: account.staleAfterHours,
            reminder: account.reminder,
            betweenEntries: account.betweenEntries,
          }}
        />
      )}
    </Page>
  );
}

type Ctx = Awaited<ReturnType<typeof requireSession>>;
type Row = Awaited<ReturnType<typeof accountsView>>["rows"][number];

async function OverviewTab({
  ctx,
  row,
  windowRow,
  months,
  daily,
  range,
  yoy,
  share,
  color,
  id,
  chart,
}: {
  ctx: Ctx;
  /** The account today: the KPIs and the details. */
  row: Row;
  /** The same account over the chart's window: the chart and the month-end table. */
  windowRow: Row;
  months: string[];
  /** The window day by day, when the chart's grain is the day (F2.5). */
  daily: Awaited<ReturnType<typeof accountDailyBalances>> | null;
  /** The range the picker wrote, or `null` when a span decides the window. */
  range: { from: string; to: string } | null;
  yoy: ReturnType<typeof changeBetween>;
  share: number | null;
  color: string;
  id: string;
  chart: { mode: "line" | "bars"; grain: "month" | "day"; span: SpanKey; custom: boolean };
}) {
  const t = await getTranslations("accounts.detail");
  const ta = await getTranslations("accounts");
  const tp = await getTranslations("pockets.account");
  const ts = await getTranslations("subscriptions.account");
  const ti = await getTranslations("interests");
  const [pockets, paying, rules] = await Promise.all([
    pocketsOnAccount(ctx, id),
    subscriptionsOnAccount(ctx, id),
    rulesOnAccount(ctx, id),
  ]);
  const ruleText = rules
    .flatMap((rule) =>
      tierChips(rule.tiers, ctx.numberFormat, {
        upTo: (amount) => ti("tier.upTo", { amount }),
        to: (amount) => ti("tier.to", { amount }),
        above: ti("tier.above"),
        any: ti("tier.any"),
      }).map((chip) => `${chip.rate} ${chip.range}`),
    )
    .join(" · ");
  const series = windowRow.series;
  /**
   * What the chart draws: the month ends of the window, or — at day grain — every day of it (F2.5).
   * The month-end table below stays monthly either way.
   */
  const plot = daily
    ? {
        labels: daily.days.map((day) => formatDate(day, "long", ctx.locale)),
        values: daily.values,
        estimated: daily.estimated,
        xLabels: dayLabels(daily.days, ctx.locale),
      }
    : {
        labels: months.map((month) => formatDate(month, "monthYear", ctx.locale)),
        values: series,
        estimated: windowRow.estimated,
        xLabels: monthLabels(months, ctx.locale),
      };
  const steps = plot.values.map((value, i) =>
    i === 0 ? null : changeBetween(value, plot.values[i - 1]).cents,
  );
  /** Everything the chart's links carry, so switching one control keeps the others. */
  const carried = {
    mode: chart.mode === "line" ? undefined : chart.mode,
    grain: chart.grain === "month" ? undefined : chart.grain,
    span: range ? undefined : chart.span,
    from: range?.from.slice(0, 7),
    to: range?.to.slice(0, 7),
  };
  const monthRows = months
    .map((month, index) => ({
      month,
      value: series[index],
      change: changeBetween(series[index], index > 0 ? series[index - 1] : null),
    }))
    .filter((entry) => entry.value !== null)
    .reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile
          label={t("kpis.balance")}
          value={formatMoney(row.balance, ctx.numberFormat)}
          note={ta(`types.${row.account.type}`)}
        />
        <KpiTile
          label={t("kpis.yoy")}
          value={formatPercent(yoy.fraction, ctx.numberFormat, { signed: true })}
          valueTone={toneOfSign(yoy.cents)}
        />
        <KpiTile
          label={t("kpis.share")}
          value={formatPercent(share, ctx.numberFormat)}
          note={t("kpis.shareNote")}
        />
        <KpiTile
          label={t("kpis.opened")}
          value={row.account.openedOn ? formatDate(row.account.openedOn, "long", ctx.locale) : NULL_DISPLAY}
        />
      </div>

      {/* Past the wide threshold the chart takes the left and the month-end table and the details
          stack on the right (spec §8.2, F2.5). */}
      <div className="grid items-start gap-4 @wide:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card padded={false} className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("chart.title", { count: months.length })}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <LinkTabs
                label={t("chart.span")}
                path={`/accounts/${id}`}
                params={{ mode: carried.mode, grain: carried.grain }}
                name="span"
                current={chart.custom ? "" : chart.span}
                options={SPAN_OPTIONS}
              />
              <MonthRangePicker
                from={months[0]}
                to={months[months.length - 1]}
                path={`/accounts/${id}`}
                params={{ mode: carried.mode, grain: carried.grain }}
                locale={ctx.locale}
              />
              <LinkTabs
                label={t("chart.grain")}
                path={`/accounts/${id}`}
                params={carried}
                name="grain"
                current={chart.grain}
                options={[
                  { value: "month", label: t("chart.grains.month") },
                  { value: "day", label: t("chart.grains.day") },
                ]}
              />
              <LinkTabs
                label={t("chart.mode")}
                path={`/accounts/${id}`}
                params={carried}
                name="mode"
                current={chart.mode}
                options={[
                  { value: "line", label: t("chart.modes.line") },
                  { value: "bars", label: t("chart.modes.bars") },
                ]}
              />
            </div>
          </div>
          {chart.mode === "bars" ? (
            <Bars
              values={steps.map((step) => (step === null ? null : Number(step)))}
              yLabels={symmetricAxisLabels(steps, ctx.numberFormat)}
              xLabels={plot.xLabels}
              summary={t(daily ? "chart.dayBarsSummary" : "chart.barsSummary", { name: row.account.name })}
            />
          ) : (
            <AreaLine
              hover={plot.labels.map((label, i) => ({
                label,
                value: formatMoney(plot.values[i], ctx.numberFormat),
                note:
                  [
                    steps[i] === null
                      ? null
                      : `${formatMoney(steps[i], ctx.numberFormat, { signed: true })} ${t("chart.change")}`,
                    // Rebuilt from the movements rather than read (spec §7.1, F2.5).
                    plot.estimated[i] ? ta("estimated.short") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
              }))}
              estimated={plot.estimated}
              values={asNumbers(plot.values)}
              yLabels={axisLabels(plot.values, ctx.numberFormat)}
              xLabels={plot.xLabels}
              summary={t("chart.summary", {
                name: row.account.name,
                value: formatMoney(plot.values[plot.values.length - 1] ?? null, ctx.numberFormat),
              })}
            />
          )}
          {plot.estimated.some(Boolean) && <p className="text-sm text-muted">{ta("estimated.note")}</p>}
        </Card>

        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @wide:grid-cols-1">
          <Card padded={false} className="flex flex-col">
            <h2 className="px-4 pt-3.5 pb-2.5 text-lg font-semibold">{t("monthEnd.title")}</h2>
            {monthRows.length === 0 ? (
              <p className="px-4 pb-4 text-muted">{t("monthEnd.empty")}</p>
            ) : (
              <Table>
                <THead>
                  <Th>{t("monthEnd.month")}</Th>
                  <Th align="right">{t("monthEnd.balance")}</Th>
                  <Th align="right">{t("monthEnd.change")}</Th>
                  <Th align="right">{t("monthEnd.percent")}</Th>
                </THead>
                <TBody>
                  {monthRows.map((entry) => (
                    <Tr key={entry.month}>
                      <Td>{formatDate(entry.month, "monthYear", ctx.locale)}</Td>
                      <Td align="right">{formatMoney(entry.value, ctx.numberFormat)}</Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                        {entry.change.cents === null
                          ? NULL_DISPLAY
                          : formatMoney(entry.change.cents, ctx.numberFormat, { signed: true })}
                      </Td>
                      <Td align="right" className={TONE_TEXT[toneOfSign(entry.change.cents)]}>
                        {formatPercent(entry.change.fraction, ctx.numberFormat, { signed: true })}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t("details.title")}</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">{t("details.reference")}</dt>
              <dd className="truncate font-mono">{row.account.reference ?? NULL_DISPLAY}</dd>
              <dt className="text-muted">{t("details.purpose")}</dt>
              <dd className="truncate">{row.account.purpose ?? NULL_DISPLAY}</dd>
              <dt className="text-muted">{t("details.currency")}</dt>
              <dd>{row.account.currency}</dd>
              <dt className="text-muted">{t("details.source")}</dt>
              <dd>
                {row.account.origin === "manual"
                  ? ta("origins.manual")
                  : ta("origins.syncedWith", { provider: row.account.provider ?? "" })}
              </dd>
              <dt className="text-muted">{t("details.betweenEntries")}</dt>
              <dd>{t(`details.trends.${row.account.betweenEntries}`)}</dd>
              <dt className="text-muted">{t("details.inNetWorth")}</dt>
              <dd>{row.account.inNetWorth ? t("details.yes") : t("details.no")}</dd>
              <dt className="text-muted">{t("details.inSnapshot")}</dt>
              <dd>{row.account.inSnapshot ? t("details.yes") : t("details.no")}</dd>
              <dt className="text-muted">{tp("label")}</dt>
              <dd className="truncate">
                {pockets.length === 0 ? tp("none") : pockets.map((pocket) => pocket.name).join(", ")}
              </dd>
              <dt className="text-muted">{ti("account.label")}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate">{ruleText === "" ? ti("account.none") : ruleText}</span>
                <Link
                  href={(rules.length === 1 ? `/interests/${rules[0].id}` : "/interests") as Route}
                  className="focus-ring shrink-0 rounded-[2px] text-accent hover:underline"
                >
                  {ti("account.manage")}
                </Link>
              </dd>
              <dt className="text-muted">{ts("label")}</dt>
              <dd className="truncate">
                {paying.count === 0
                  ? ts("none")
                  : ts("value", {
                      count: paying.count,
                      amount: formatMoney(paying.monthlyCents, ctx.numberFormat),
                    })}
              </dd>
            </dl>
            <span aria-hidden className="h-1 rounded-full" style={{ background: color }} />
          </Card>
        </div>
      </div>
    </div>
  );
}

async function entryRows(ctx: Ctx, accountId: string): Promise<EntryRow[]> {
  const entries = await listBalanceEntries(ctx, accountId);
  return entries.map((entry, index) => {
    const earlier = entries[index + 1]?.balanceCents ?? null;
    const change = changeBetween(entry.balanceCents, earlier);
    return {
      id: entry.id,
      on: entry.on,
      onLabel: formatDate(entry.on, "long", ctx.locale),
      balance: formatMoney(entry.balanceCents, ctx.numberFormat),
      change:
        change.cents === null ? NULL_DISPLAY : formatMoney(change.cents, ctx.numberFormat, { signed: true }),
      changeSign: change.cents === null ? 0 : Number(change.cents),
      note: entry.note,
      source: entry.source,
      // What the correction form puts back in its fields, written the way the person types amounts.
      amountInput: formatAmountInput(entry.balanceCents, ctx.numberFormat),
      availableInput: formatAmountInput(entry.availableCents, ctx.numberFormat),
    };
  });
}
