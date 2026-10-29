import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { asNumbers, axisLabels, colorFor, dayLabels } from "@/modules/accounts/ui/display";
import { describeEvent } from "@/modules/investments/activity";
import { legacyPeriodQuery, periodQuery, type Query } from "@/modules/investments/period";
import { contributionsOf, convertedCurrencies, otherIsGap } from "@/modules/investments/positions";
import { serviceActivity, servicePnlView } from "@/modules/investments/queries";
import { bestAndWorst, runningTotal, sampled, toCents } from "@/modules/investments/ui/chart-data";
import { periodText } from "@/modules/investments/ui/period-control";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { StackedArea, StackedBars, stackLayers } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { withParams } from "@/ui/url";
import { loadService } from "./service-data";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * A service's Overview (docs/design/investments-ux.md §3.3, U3): the P&L of the period — the very
 * number of its row on the home, in the display currency, with the bridge from its own currency —
 * then how far it can be trusted, its parts, the chart, the main positions and the latest activity.
 * The diagnostics live in Connection, never here.
 */
export default async function InvestmentServiceOverview({
  params,
  searchParams,
}: PageProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const query = (await searchParams) as Query;
  const todayOn = today(ctx.timeZone);
  const base = `/investments/${accountId}`;

  // The old chart address of this page (`range`, months, `grain`) goes to the new one, once (§1.2).
  const legacy = legacyPeriodQuery(query, todayOn);
  if (legacy) permanentRedirect(withParams(base, {}, legacy));

  const t = await getTranslations("investments");
  const tp = await getTranslations("investments.period");
  const ta = await getTranslations("investments.activity");
  const view = one(query.view) === "value" ? "value" : "pnl";
  const [detail, pnl] = await Promise.all([
    loadService(accountId),
    servicePnlView(ctx, accountId, { period: one(query.period), from: one(query.from), to: one(query.to) }),
  ]);
  if (!detail || !pnl) notFound();
  const service = pnl.portfolio.services[0];
  const { summary } = detail;
  const { period, span } = pnl;
  const own = detail.currency;
  const display = pnl.currency;
  const money = (cents: Cents | null, signed = false, code = own) =>
    formatMoney(cents, ctx.numberFormat, { currency: code, signed });
  const percent = (value: number | null) => formatPercent(value, ctx.numberFormat, { signed: true });
  const name = periodText(period, span, todayOn, ctx.locale, tp);
  const periodParams = periodQuery(period, todayOn);
  const tab = (path: string, extra: Record<string, string | undefined> = {}) =>
    withParams(`${base}${path}`, {}, { ...periodParams, ...extra });

  const activity = await serviceActivity(ctx, accountId, {
    from: span.from,
    to: span.to,
    family: null,
    q: null,
    assetId: null,
    page: 1,
  });

  // ——— Hero: the home's number, its state, and the bridge from the account's currency (§3.3, §4.5) ——
  const heroCents = service.display?.pnlCents ?? null;
  const local = service.local;
  const rate = service.displayReturn?.dietz ?? null;
  const bridge =
    own !== display && local && service.display && service.status !== "undetermined"
      ? t("service.bridge", {
          local: money(local.pnlCents, true),
          date: formatDate(service.to, "long", ctx.locale),
          converted: money(service.display.pnlCents - service.display.fxCents, true, display),
          fx: money(service.display.fxCents, true, display),
        })
      : null;
  const statusBadge =
    service.status === "undetermined" ? (
      <Badge tone="warn">{t("home.status.undetermined")}</Badge>
    ) : service.partial && service.from ? (
      <Badge tone="accent">
        {t("home.status.from", { date: formatDate(service.from, "dayMonth", ctx.locale) })}
      </Badge>
    ) : service.status === "estimated" ? (
      <Badge tone="neutral">{t("home.status.estimated")}</Badge>
    ) : null;
  const valueLine =
    summary.valueCents !== null &&
    own !== display &&
    summary.displayCents !== null &&
    summary.valueCents !== 0n
      ? t.rich("service.valueOther", {
          value: money(summary.valueCents),
          display: money(summary.displayCents, false, display),
          strong: (chunks) => (
            <strong data-testid="service-value" className="font-semibold text-fg tabular-nums">
              {chunks}
            </strong>
          ),
        })
      : t.rich("service.value", {
          value: summary.valueCents === null ? t("services.noValue") : money(summary.valueCents),
          strong: (chunks) => (
            <strong data-testid="service-value" className="font-semibold text-fg tabular-nums">
              {chunks}
            </strong>
          ),
        });

  // ——— The chart, one service (§3.3): bars, the running total, the band before the data, markers ———
  const series = pnl.chart[0];
  const color = colorFor(summary.account, pnl.colorIndex.get(accountId) ?? 0);
  const bars = series?.bars ?? [];
  const cumulative = runningTotal(bars);
  const missingSlots =
    service.from === null ? bars.length : pnl.intervals.filter((one) => one.to < service.from!).length;
  const markers = pnl.intervals.map((interval) => {
    const flows = service.flows.filter((flow) => flow.on >= interval.from && flow.on <= interval.to);
    const into = flows.some((flow) => flow.cents > 0n);
    const out = flows.some((flow) => flow.cents < 0n);
    return into && out ? "both" : into ? "in" : out ? "out" : null;
  });
  const deposits = pnl.intervals.filter((_, index) => markers[index] === "in" || markers[index] === "both");
  const withdrawals = pnl.intervals.filter(
    (_, index) => markers[index] === "out" || markers[index] === "both",
  );
  const intervalName = (index: number) => {
    const interval = pnl.intervals[index];
    if (pnl.barGrain === "year") return interval.from.slice(0, 4);
    if (pnl.barGrain === "month") return formatDate(interval.from, "monthYear", ctx.locale);
    return `${formatDate(interval.from, "dayMonth", ctx.locale)} – ${formatDate(interval.to, "dayMonth", ctx.locale)}`;
  };
  const best = bestAndWorst(bars);
  const summaryText = [
    t("home.chart.summary", {
      period: name,
      total: heroCents === null ? NULL_DISPLAY : money(heroCents, true, display),
      best: best ? `${intervalName(best.best)} (${money(bars[best.best], true, display)})` : NULL_DISPLAY,
      worst: best ? `${intervalName(best.worst)} (${money(bars[best.worst], true, display)})` : NULL_DISPLAY,
      services: summary.account.name,
    }),
    deposits.length + withdrawals.length > 0
      ? t("service.chart.summaryFlows", {
          deposits:
            deposits.map((interval) => intervalName(pnl.intervals.indexOf(interval))).join(", ") ||
            NULL_DISPLAY,
          withdrawals:
            withdrawals.map((interval) => intervalName(pnl.intervals.indexOf(interval))).join(", ") ||
            NULL_DISPLAY,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const stack = stackLayers([asNumbers(bars)], pnl.intervals.length);

  // ——— The main contributions to the period, open or sold (§3.3, PERS-113 · 9): the position that
  // explains the P&L is here even when it was sold or is small today ——————————————————————————————
  const assetOf = new Map(detail.assets.map((asset) => [asset.id, asset]));
  const top = (contributionsOf(service)?.rows ?? []).slice(0, 5);

  // ——— The latest activity of the period, in words, with what a sale realized (§3.3, §3.5) ————————
  const realizedOf = new Map<string, Cents>();
  for (const exit of service.exits) {
    if (exit.realizedCents === null) continue;
    realizedOf.set(exit.eventId, (realizedOf.get(exit.eventId) ?? 0n) + exit.realizedCents);
  }
  const latest = (activity?.rows ?? []).slice(0, 5).map((row) => ({
    row,
    text: describeEvent(
      { leg: row.leg, note: row.note, counterpart: row.transfer?.accountName ?? row.linked?.payee ?? null },
      (key, values) => ta(key as "sentence", values as { label: string; detail: string }),
      ctx.numberFormat,
    ).sentence,
    realized: realizedOf.get(row.id) ?? null,
  }));

  const parts = local;
  const converted = convertedCurrencies(service);
  const gap = otherIsGap(service);
  const etoro = summary.investment.provider === "etoro";
  const closing = parts
    ? [
        { key: "corrections", cents: parts.correctionsCents },
        { key: "unattributed", cents: parts.unattributedCents },
      ].filter((row) => row.cents !== 0n)
    : [];

  return (
    <>
      <section aria-labelledby="pnl-title" className="flex flex-col gap-1">
        <h2 id="pnl-title" className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
          {t("home.hero.title", { period: name })}
          {statusBadge}
        </h2>
        <p
          data-testid="pnl-hero"
          data-cents={heroCents === null ? "" : String(heroCents)}
          data-local-cents={local === null ? "" : String(local.pnlCents)}
          className="flex flex-wrap items-baseline gap-x-3"
        >
          <span
            className={cn(
              "text-[2rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
              TONE_TEXT[toneOfSign(heroCents)],
            )}
          >
            {heroCents === null ? t("home.hero.undetermined") : money(heroCents, true, display)}
          </span>
          {rate !== null && (
            <span className={cn("text-lg font-semibold tabular-nums", TONE_TEXT[toneOfSign(rate)])}>
              {percent(rate)}
            </span>
          )}
        </p>
        {bridge && (
          <p data-testid="pnl-bridge" className="text-sm text-muted tabular-nums">
            {bridge}
          </p>
        )}
        <p className="text-sm text-muted">
          {valueLine}
          {period.to < todayOn && service.endCents !== null && (
            <>
              {" · "}
              {t("service.valueAt", {
                date: formatDate(period.to, "long", ctx.locale),
                value: money(service.endCents),
              })}
            </>
          )}
        </p>
        {service.status === "undetermined" && (
          <p className="text-sm text-warn">{t("service.undetermined")}</p>
        )}
        {service.status !== "undetermined" && service.display === null && (
          <p className="text-sm text-warn">{t("service.noRate", { currency: display })}</p>
        )}
        {pnl.firstOn !== null && period.to < pnl.firstOn && (
          <p className="text-sm text-muted">
            {t("home.hero.noData", { date: formatDate(pnl.firstOn, "long", ctx.locale) })}
          </p>
        )}
      </section>

      {service.partial && service.from && (
        <p
          data-testid="partial-strip"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] border border-border bg-soft px-3 py-2 text-sm"
        >
          <Badge tone="accent">
            {t("home.status.from", { date: formatDate(service.from, "dayMonth", ctx.locale) })}
          </Badge>
          <span>
            {t("service.partial", {
              date: formatDate(service.from, "long", ctx.locale),
              name: summary.account.name,
            })}
          </span>
          <Link
            href={tab("/connection")}
            className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
          >
            {t("service.partialLink")} →
          </Link>
        </p>
      )}
      {service.status === "estimated" && service.reasons.includes("estimated_history") && (
        <p className="text-sm text-muted">{t("service.estimated")}</p>
      )}

      {parts && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
            <KpiTile
              label={t("service.kpis.realized")}
              value={money(parts.realizedCents, true)}
              valueTone={toneOfSign(parts.realizedCents)}
              note={t("service.kpis.realizedNote")}
            />
            <KpiTile
              label={t("service.kpis.unrealized")}
              value={money(parts.unrealizedChangeCents, true)}
              valueTone={toneOfSign(parts.unrealizedChangeCents)}
              note={
                parts.unrealizedChangeCents === null
                  ? t("service.kpis.unrealizedUnknown")
                  : t("service.kpis.unrealizedNote")
              }
            />
            {etoro && parts.incomeCents === 0n ? (
              // eToro sums dividends into the value: a KPI it cannot give says why (S2).
              <KpiTile
                label={t("service.kpis.income")}
                value={t("service.kpis.incomeIncluded")}
                note={t("service.kpis.incomeIncludedNote", { name: summary.account.name })}
              />
            ) : (
              <KpiTile
                label={t("service.kpis.income")}
                value={money(parts.incomeCents, true)}
                valueTone={toneOfSign(parts.incomeCents)}
                note={t("service.kpis.incomeNote")}
              />
            )}
            <KpiTile
              label={t("service.kpis.fees")}
              value={money(parts.feesCents, true)}
              valueTone={toneOfSign(parts.feesCents)}
              note={t("service.kpis.feesNote")}
            />
          </div>
          {closing.length > 0 && (
            <p data-testid="pnl-closing" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {closing.map((row) => (
                <span key={row.key} data-cents={String(row.cents)}>
                  {t(
                    `home.kpis.${row.key === "unattributed" && !gap ? "valuation" : row.key}` as "home.kpis.corrections",
                  )}{" "}
                  <strong className={cn("font-semibold tabular-nums", TONE_TEXT[toneOfSign(row.cents)])}>
                    {money(row.cents, true)}
                  </strong>
                  {row.key === "unattributed" && converted.length > 0 && (
                    <span data-testid="converted-note" className="ml-1">
                      {t("service.convertedNote", {
                        from: converted.join(", "),
                        to: own,
                        name: summary.account.name,
                      })}
                    </span>
                  )}
                  {row.key === "unattributed" && gap && (
                    <>
                      {" "}
                      <Link
                        href={tab("/connection")}
                        className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-accent hover:underline"
                      >
                        {t("service.partialLink")}
                      </Link>
                    </>
                  )}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-lg font-semibold">{t("home.chart.title")}</h2>
            <p className="text-sm text-muted">
              {view === "pnl"
                ? t(`home.chart.pnlNote.${pnl.barGrain}`, { period: name })
                : t(`home.chart.valueNote.${pnl.valueGrain}`)}
            </p>
          </div>
          <LinkTabs
            label={t("home.chart.view")}
            path={base}
            params={{ ...periodParams }}
            name="view"
            current={view}
            options={[
              { value: "pnl", label: t("home.chart.pnl") },
              { value: "value", label: t("home.chart.value") },
            ]}
          />
        </div>
        {view === "pnl" ? (
          bars.every((cents) => cents === null) ? (
            <p className="text-sm text-muted">{t("chart.empty")}</p>
          ) : (
            <StackedBars
              layers={[
                {
                  key: accountId,
                  label: summary.account.name,
                  color,
                  values: asNumbers(bars),
                  estimated: series?.barsEstimated,
                },
              ]}
              line={asNumbers(cumulative)}
              yLabels={axisLabels(
                [...cumulative, ...stack.top.map(toCents), ...stack.bottom.map(toCents)],
                ctx.numberFormat,
                4,
                display,
              )}
              xLabels={sampled(pnl.intervals.length).map((index) =>
                pnl.barGrain === "year"
                  ? pnl.intervals[index].from.slice(0, 4)
                  : pnl.barGrain === "month"
                    ? formatDate(pnl.intervals[index].from, "monthShort", ctx.locale)
                    : formatDate(pnl.intervals[index].from, "dayMonth", ctx.locale),
              )}
              hover={pnl.intervals.map((_, index) => ({
                label: intervalName(index),
                value: money(bars[index], true, display),
                note: t("home.chart.cumulative", { amount: money(cumulative[index], true, display) }),
              }))}
              unavailable={
                service.from !== null && missingSlots > 0
                  ? {
                      slots: missingSlots,
                      label: t("service.chart.unavailable", {
                        date: formatDate(service.from, "dayMonth", ctx.locale),
                      }),
                    }
                  : undefined
              }
              markers={markers}
              summary={summaryText}
            />
          )
        ) : (series?.values ?? []).every((cents) => cents === null) ? (
          <p className="text-sm text-muted">{t("chart.empty")}</p>
        ) : (
          <StackedArea
            layers={[
              { key: accountId, label: summary.account.name, color, values: asNumbers(series?.values ?? []) },
            ]}
            total={asNumbers(series?.values ?? [])}
            estimated={series?.valuesEstimated ?? []}
            yLabels={axisLabels(series?.values ?? [], ctx.numberFormat, 4, display)}
            xLabels={
              pnl.valueGrain === "day"
                ? dayLabels(pnl.valueDays, ctx.locale)
                : sampled(pnl.valueDays.length).map((index) =>
                    formatDate(pnl.valueDays[index], "monthShort", ctx.locale),
                  )
            }
            hover={pnl.valueDays.map((day, index) => ({
              label: formatDate(day, "long", ctx.locale),
              value: money(series?.values[index] ?? null, false, display),
            }))}
            summary={t("home.chart.valueSummary", {
              value: money(series?.values.at(-1) ?? null, false, display),
            })}
            height={200}
          />
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {view === "pnl" && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-fg" /> {t("home.chart.line")}
            </span>
          )}
          {view === "pnl" && markers.some(Boolean) && <span>{t("service.chart.markers")}</span>}
          {(view === "pnl" ? series?.barsEstimated.some(Boolean) : series?.valuesEstimated.some(Boolean)) && (
            <span>{t("home.chart.estimated")}</span>
          )}
        </p>
      </Card>

      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <Card padded={false} className="min-w-0">
          <CardHeader
            title={t("service.top.title")}
            actions={
              <Link
                href={tab("/positions")}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-sm text-accent hover:underline"
              >
                {t("service.top.all")} →
              </Link>
            }
          />
          {top.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("service.top.empty")}</p>
          ) : (
            <ul className="flex flex-col" data-testid="top-positions">
              {top.map((row) => {
                const asset = row.assetId === null ? null : (assetOf.get(row.assetId) ?? null);
                return (
                  <li
                    key={row.key}
                    data-testid="top-position"
                    className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
                  >
                    <span className="flex min-w-0 flex-col">
                      <Link
                        href={tab("/activity", { asset: row.assetId ?? undefined })}
                        className="focus-ring inline-flex min-h-6 min-w-0 items-center rounded-[4px] font-medium hover:underline"
                      >
                        <span className="truncate">{asset?.name ?? t("positions.unknownAsset")}</span>
                      </Link>
                      <span className="text-xs text-muted">
                        {[
                          asset?.symbol,
                          row.costUnknown
                            ? t("positions.contributions.noCost")
                            : row.open && row.sold
                              ? t("positions.contributions.partlySold")
                              : row.open
                                ? t("positions.contributions.open")
                                : t("positions.contributions.sold"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[toneOfSign(row.cents)])}
                    >
                      {money(row.cents, true)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card padded={false} className="min-w-0">
          <CardHeader
            title={t("service.latest.title")}
            actions={
              <Link
                href={tab("/activity")}
                className="focus-ring inline-flex min-h-6 items-center rounded-[4px] text-sm text-accent hover:underline"
              >
                {t("service.latest.all")} →
              </Link>
            }
          />
          {latest.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("service.latest.empty")}</p>
          ) : (
            <ul className="flex flex-col" data-testid="latest-activity">
              {latest.map(({ row, text, realized }) => (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{text}</span>
                    <span className="text-xs text-muted">
                      {formatDate(row.on, "long", ctx.locale)}
                      {realized !== null && (
                        <>
                          {" · "}
                          <span className={TONE_TEXT[toneOfSign(realized)]}>{money(realized, true)}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {money(row.leg.amountCents, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
