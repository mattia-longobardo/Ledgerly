import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccount } from "@/modules/accounts/queries";
import { asNumbers, axisLabels, monthLabels } from "@/modules/accounts/ui/display";
import { type HoldingRow, type OperationRow, serviceDetail } from "@/modules/investments/queries";
import { productLabel } from "@/modules/investments/ui/labels";
import { ensureAssetSeed } from "@/modules/investments/service";
import {
  AddAssetButton,
  ConfirmZeroButton,
  ConversionButton,
  type HoldingSummary,
  HoldingMenu,
  OperationButton,
  OperationMenu,
  type OperationSummary,
  ReconcileButton,
  type ServiceContext,
  ServiceUrlForm,
} from "@/modules/investments/ui/dialogs";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { parseDecimal } from "@/modules/investments/rules";

const priceCents = (text: string) => parseDecimal(text, 2);
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { MultiLine } from "@/ui/chart";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata({ params }: PageProps<"/investments/[accountId]">): Promise<Metadata> {
  const ctx = await requireSession();
  const { accountId } = await params;
  const account = await getAccount(ctx, accountId);
  return { title: account?.name ?? (await getTranslations("investments"))("title") };
}

/**
 * A service (docs/design/investments.md §4.3): its value, what went in, the positions, the
 * operations grouped by event, the readings and adjustments of a synced account, and the settings
 * with the mode conversions.
 */
export default async function InvestmentServicePage({ params }: PageProps<"/investments/[accountId]">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const t = await getTranslations("investments");
  // The editable seed of the asset catalog (§1.4), written once, before the dialogs list it.
  await ensureAssetSeed(ctx);
  const detail = await serviceDetail(ctx, accountId);
  if (!detail) notFound();
  const { summary, day } = detail;
  const account = summary.account;
  const currency = detail.currency;
  const own = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat, { currency });
  const signed = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true, currency });
  const long = (on: string | null) => formatDate(on, "long", ctx.locale);
  const synced = summary.origin === "synced";
  const mode = summary.mode;
  const url = summary.investment.url ?? summary.provider?.url ?? null;
  const latestReading = detail.readings[0] ?? null;
  const tp = (key: "products.spot") => t(key);

  const context: ServiceContext = {
    accountId,
    name: account.name,
    currency,
    numberFormat: ctx.numberFormat,
    locale: ctx.locale,
    today: today(ctx.timeZone),
    mode,
    synced,
    valueCents: summary.valueCents,
    assets: detail.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      class: asset.class,
      symbol: asset.symbol,
      isin: asset.isin,
      currency: asset.currency,
    })),
    coveredProducts: detail.coveredProducts,
    linkOptions: detail.linkOptions,
  };

  const holdingOf = (row: HoldingRow): HoldingSummary => ({
    id: row.id,
    name: row.asset.name,
    currency: row.asset.currency,
    origin: row.origin,
    product: row.product,
    byValue: row.state.quantity === null,
    quantityText: row.quantityText,
    conflict: row.conflict,
    readingId: latestReading?.id ?? null,
    readingOn: latestReading?.on ?? null,
  });
  const operationOf = (row: OperationRow): OperationSummary => ({
    id: row.id,
    kind: row.kind,
    on: row.on,
    origin: row.origin,
    note: row.note,
    amountCents: row.legs[0]?.amountCents ?? 0n,
    validUntil: row.legs[0]?.validUntil ?? null,
    transactionId: row.transactionId,
    holdingId: row.legs[0]?.holdingId ?? null,
    holdingName: row.legs[0]?.holdingName ?? null,
    unitPriceText: row.legs[0]?.priceText ?? null,
  });

  const flows = summary.performance;
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {mode === "assets" && <AddAssetButton context={context} />}
      {mode === "total" && !synced && (
        <OperationButton kind="account_valuation" context={context} variant="primary" />
      )}
      <OperationButton kind="deposit" context={context} />
      <OperationButton kind="withdrawal" context={context} />
      {mode === "total" && !synced && <ConversionButton context={context} />}
      {synced && <OperationButton kind="adjustment" context={context} />}
    </div>
  );

  const priceCell = (row: HoldingRow) =>
    row.priceText === null ? (
      <span className="text-muted">{t("assets.byValue")}</span>
    ) : (
      <span className="inline-flex flex-col items-end">
        <span>
          {priceCents(row.priceText) === 0n
            ? `${row.priceText} ${row.asset.currency}`
            : formatMoney(priceCents(row.priceText), ctx.numberFormat, { currency: row.asset.currency })}
        </span>
        <span className="text-xs text-muted">
          {row.state.pricedOn ? formatDate(row.state.pricedOn, "dayMonth", ctx.locale) : ""}
          {row.state.staleRate && ` · ${t("assets.staleRate")}`}
        </span>
      </span>
    );
  const gainCell = (row: HoldingRow) => (
    <span className="inline-flex flex-col items-end">
      <span className={TONE_TEXT[toneOfSign(row.gainCents)]}>{signed(row.gainCents)}</span>
      {row.state.fxEffectCents !== 0n && (
        <span className="text-xs text-muted">
          {t("assets.fx", { amount: signed(row.state.fxEffectCents) })}
        </span>
      )}
    </span>
  );
  const holdingActions = (row: HoldingRow) => (
    <span className="flex items-center justify-end gap-1">
      {row.conflict && <ReconcileButton holding={holdingOf(row)} context={context} />}
      <HoldingMenu holding={holdingOf(row)} context={context} />
    </span>
  );
  const legText = (row: OperationRow) =>
    row.legs
      .map((leg) =>
        [
          leg.leg !== "main" ? t(`operations.legs.${leg.leg}` as "operations.legs.fee") : null,
          leg.holdingName,
          leg.quantityText,
          leg.priceText ? `@ ${leg.priceText} ${leg.priceCurrency ?? ""}`.trim() : null,
          leg.validUntil
            ? t("operations.until", { date: formatDate(leg.validUntil, "dayMonth", ctx.locale) })
            : null,
          leg.leg !== "main" ? own(leg.amountCents) : null,
        ]
          .filter(Boolean)
          .join(" "),
      )
      .filter((text) => text !== "")
      .join(" · ");
  const linkedText = (row: OperationRow) =>
    row.linked
      ? [row.linked.payee, formatMoney(row.linked.cents, ctx.numberFormat)].filter(Boolean).join(" · ")
      : null;
  const kindCell = (row: OperationRow) => (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={row.origin === "conversion" ? "neutral" : "accent"}>
        {t(`kinds.${row.kind}` as "kinds.deposit")}
      </Badge>
      {row.origin === "conversion" && (
        <span className="text-xs text-muted">{t("operations.conversion")}</span>
      )}
      {row.revisions > 0 && (
        <span className="text-xs text-muted">{t("operations.revisions", { count: row.revisions })}</span>
      )}
    </span>
  );

  return (
    <Page title={account.name} parent={{ href: "/investments" as Route, label: t("title") }}>
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{t(`categories.${summary.investment.category}`)}</span>
          <span aria-hidden>·</span>
          <span>{summary.origin ? t(`origins.${summary.origin}`) : NULL_DISPLAY}</span>
          {mode && (
            <>
              <span aria-hidden>·</span>
              <span>{t(`modes.${mode}`)}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{t("detail.since", { date: long(summary.investment.managedSince) })}</span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("actions.openSite", { name: account.name })}
              className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-[4px] text-accent hover:underline"
            >
              {t("actions.openSiteShort")}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : (
            <span>{t("detail.noUrl")}</span>
          )}
        </p>
        <h1 className="text-title font-semibold tracking-[-0.02em]">{account.name}</h1>
        <p className="flex flex-wrap items-baseline gap-3">
          <span className="text-hero-sm font-semibold tracking-[-0.02em]" data-testid="service-value">
            {own(summary.valueCents)}
          </span>
          {currency !== ctx.displayCurrency && summary.valueCents !== null && (
            <span className="text-sm text-muted">
              ≈ {formatMoney(summary.displayCents, ctx.numberFormat, { currency: ctx.displayCurrency })}
            </span>
          )}
        </p>
        {summary.valueCents === null && <p className="text-sm text-warn">{t("detail.noValue")}</p>}
        {mode === "assets" && !synced && day.cashCents < 0n && (
          <p className="text-sm text-warn">{t("detail.negativeCash")}</p>
        )}
        {day.conflicts.length > 0 && <p className="text-sm text-warn">{t("detail.conflictNote")}</p>}
      </header>

      {toolbar}

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile label={t("detail.kpis.value")} value={own(summary.valueCents)} />
        <KpiTile
          label={t("detail.kpis.invested")}
          value={own(flows.investedCents)}
          note={t("kpis.investedNote")}
        />
        <KpiTile
          label={t("detail.kpis.gain")}
          value={signed(flows.gainCents)}
          valueTone={toneOfSign(flows.gainCents)}
          delta={
            flows.simpleReturn === null
              ? undefined
              : formatPercent(flows.simpleReturn, ctx.numberFormat, { signed: true })
          }
          deltaTone={toneOfSign(flows.simpleReturn)}
          note={t("kpis.gainNote")}
        />
        {mode === "assets" && !synced ? (
          <KpiTile
            label={t("detail.kpis.cash")}
            value={own(day.cashCents)}
            valueTone={day.cashCents < 0n ? "warn" : "fg"}
            note={t("detail.kpis.cashNote", { amount: own(day.assetsCents) })}
          />
        ) : (
          <KpiTile
            label={t("services.change30")}
            value={signed(summary.change30Cents)}
            valueTone={toneOfSign(summary.change30Cents)}
          />
        )}
      </div>

      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("chart.title")}</h2>
          <span className="flex gap-3 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-accent" /> {t("chart.value")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t border-dashed border-muted" /> {t("chart.invested")}
            </span>
          </span>
        </div>
        {detail.history.value.every((value) => value === null) ? (
          <p className="text-sm text-muted">{t("chart.empty")}</p>
        ) : (
          <MultiLine
            series={[
              { values: asNumbers(detail.history.value), color: "var(--accent)" },
              { values: asNumbers(detail.history.invested), color: "var(--muted)", dashed: true, step: true },
            ]}
            yLabels={axisLabels(
              [...detail.history.value, ...detail.history.invested],
              ctx.numberFormat,
              4,
              currency,
            )}
            xLabels={monthLabels(detail.months, ctx.locale)}
            hover={detail.months.map((month, index) => ({
              label: formatDate(month, "monthYear", ctx.locale),
              value: own(detail.history.value[index]),
              note: t("chart.hoverInvested", { amount: own(detail.history.invested[index]) }),
            }))}
            summary={t("chart.summary", {
              value: own(summary.valueCents),
              invested: own(flows.investedCents),
            })}
            height={180}
          />
        )}
      </Card>

      {(mode === "assets" || detail.holdings.length > 0) && (
        <Card padded={false} className="min-w-0">
          <CardHeader
            title={t("assets.title")}
            actions={mode === "assets" ? <AddAssetButton context={context} variant="secondary" /> : undefined}
          />
          {detail.holdings.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t("assets.empty")}</p>
          ) : (
            <>
              <div className="overflow-x-auto max-md:hidden">
                <Table>
                  <THead>
                    <Th>{t("assets.asset")}</Th>
                    <Th>{t("assets.class")}</Th>
                    <Th>{t("assets.product")}</Th>
                    <Th align="right">{t("assets.quantity")}</Th>
                    <Th align="right">{t("assets.price")}</Th>
                    <Th align="right">{t("assets.value")}</Th>
                    <Th align="right">{t("assets.weight")}</Th>
                    <Th align="right">{t("assets.gain")}</Th>
                    <Th>{t("assets.origin")}</Th>
                    <Th align="right">
                      <span className="sr-only">{t("assets.actions")}</span>
                    </Th>
                  </THead>
                  <TBody>
                    {detail.holdings.map((row) => (
                      <Tr key={row.id} data-testid="holding-row">
                        <Td className="max-w-64">
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="max-w-full truncate font-medium">{row.asset.name}</span>
                            {row.conflict && <Badge tone="warn">{t("assets.conflict")}</Badge>}
                          </span>
                        </Td>
                        <Td muted>{t(`classes.${row.asset.class}`)}</Td>
                        <Td muted>{productLabel(row.product, tp)}</Td>
                        <Td align="right">{row.quantityText ?? NULL_DISPLAY}</Td>
                        <Td align="right" className="py-1">
                          {priceCell(row)}
                        </Td>
                        <Td align="right">{own(row.state.valueCents)}</Td>
                        <Td align="right">{formatPercent(row.weight, ctx.numberFormat)}</Td>
                        <Td align="right" className="py-1">
                          {gainCell(row)}
                        </Td>
                        <Td muted>{t(`assets.origins.${row.origin}`)}</Td>
                        <Td align="right">{holdingActions(row)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="flex flex-col md:hidden">
                {detail.holdings.map((row) => (
                  <li
                    key={row.id}
                    data-testid="holding-item"
                    className="flex flex-col gap-1.5 border-t border-border px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{row.asset.name}</span>
                      {holdingActions(row)}
                    </div>
                    {row.conflict && <Badge tone="warn">{t("assets.conflict")}</Badge>}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
                      <dt className="text-muted">{t("assets.class")}</dt>
                      <dd className="text-right">{t(`classes.${row.asset.class}`)}</dd>
                      <dt className="text-muted">{t("assets.product")}</dt>
                      <dd className="text-right">{productLabel(row.product, tp)}</dd>
                      <dt className="text-muted">{t("assets.quantity")}</dt>
                      <dd className="text-right">{row.quantityText ?? NULL_DISPLAY}</dd>
                      <dt className="text-muted">{t("assets.price")}</dt>
                      <dd className="text-right">{priceCell(row)}</dd>
                      <dt className="text-muted">{t("assets.value")}</dt>
                      <dd className="text-right">{own(row.state.valueCents)}</dd>
                      <dt className="text-muted">{t("assets.weight")}</dt>
                      <dd className="text-right">{formatPercent(row.weight, ctx.numberFormat)}</dd>
                      <dt className="text-muted">{t("assets.gain")}</dt>
                      <dd className="text-right">{gainCell(row)}</dd>
                      <dt className="text-muted">{t("assets.origin")}</dt>
                      <dd className="text-right">{t(`assets.origins.${row.origin}`)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {mode === "total" && !synced && <p className="text-sm text-muted">{t("detail.totalModeNote")}</p>}

      <Card padded={false} className="min-w-0">
        <CardHeader
          title={t("operations.title")}
          actions={
            <span className="text-muted">{t("operations.count", { count: detail.operations.length })}</span>
          }
        />
        {detail.operations.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("operations.empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("operations.date")}</Th>
                  <Th>{t("operations.kind")}</Th>
                  <Th>{t("operations.detail")}</Th>
                  <Th align="right">{t("operations.amount")}</Th>
                  <Th>{t("operations.linked")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("assets.actions")}</span>
                  </Th>
                </THead>
                <TBody>
                  {detail.operations.map((row) => (
                    <Tr key={row.id} data-testid="operation-row">
                      <Td muted>{long(row.on)}</Td>
                      <Td>{kindCell(row)}</Td>
                      <Td className="max-w-80 truncate text-muted">
                        {[legText(row), row.note].filter(Boolean).join(" · ") || NULL_DISPLAY}
                      </Td>
                      <Td align="right" className="font-medium">
                        {own(row.legs[0]?.amountCents ?? null)}
                      </Td>
                      <Td className="max-w-56 truncate text-muted">
                        {row.kind === "deposit" || row.kind === "withdrawal"
                          ? (linkedText(row) ?? t("operations.notLinked"))
                          : NULL_DISPLAY}
                      </Td>
                      <Td align="right">
                        <OperationMenu operation={operationOf(row)} context={context} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="flex flex-col md:hidden">
              {detail.operations.map((row) => (
                <li
                  key={row.id}
                  data-testid="operation-item"
                  className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    {kindCell(row)}
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="font-medium tabular-nums">
                        {own(row.legs[0]?.amountCents ?? null)}
                      </span>
                      <OperationMenu operation={operationOf(row)} context={context} />
                    </span>
                  </div>
                  <span className="text-muted">{long(row.on)}</span>
                  {(legText(row) || row.note) && (
                    <span className="truncate text-muted">
                      {[legText(row), row.note].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {(row.kind === "deposit" || row.kind === "withdrawal") && (
                    <span className="truncate text-muted">
                      {linkedText(row) ?? t("operations.notLinked")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {synced && (
        <div className="grid items-start gap-4 @4xl:grid-cols-2">
          <Card padded={false} className="min-w-0">
            <CardHeader title={t("readings.title")} />
            {latestReading?.status === "pending_zero" && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <p className="text-sm text-warn">{t("readings.pendingZero")}</p>
                <ConfirmZeroButton
                  accountId={accountId}
                  readingId={latestReading.id}
                  dateLabel={long(latestReading.on)}
                />
              </div>
            )}
            {detail.readings.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t("readings.empty")}</p>
            ) : (
              <ul className="flex flex-col">
                {detail.readings.map((reading) => (
                  <li
                    key={reading.id}
                    className="flex flex-col gap-0.5 border-t border-border px-4 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">{long(reading.on)}</span>
                      <span className="font-medium tabular-nums">{own(reading.totalCents)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          reading.status === "complete" || reading.status === "confirmed_zero"
                            ? "neutral"
                            : "warn"
                        }
                      >
                        {t(`readings.statuses.${reading.status}` as "readings.statuses.complete")}
                      </Badge>
                      <span className="truncate text-muted">
                        {t("readings.products")}:{" "}
                        {reading.products.map((one) => productLabel(one, tp)).join(", ") || NULL_DISPLAY}
                      </span>
                      {reading.missingPrices > 0 && (
                        <span className="text-warn">
                          {t("readings.missing", { count: reading.missingPrices })}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card padded={false} className="min-w-0">
            <CardHeader
              title={t("adjustments.title")}
              actions={<OperationButton kind="adjustment" context={context} />}
            />
            {detail.adjustments.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t("adjustments.empty")}</p>
            ) : (
              <ul className="flex flex-col">
                {detail.adjustments.map((adjustment) => (
                  <li
                    key={adjustment.eventId}
                    className="flex flex-col gap-0.5 border-t border-border px-4 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{adjustment.note ?? NULL_DISPLAY}</span>
                      <span
                        className={cn(
                          "shrink-0 font-medium tabular-nums",
                          TONE_TEXT[toneOfSign(adjustment.amountCents)],
                        )}
                      >
                        {signed(adjustment.amountCents)}
                      </span>
                    </div>
                    <span className="text-muted">
                      {long(adjustment.on)} →{" "}
                      {adjustment.validUntil ? long(adjustment.validUntil) : t("adjustments.openEnded")}
                    </span>
                    {adjustment.stale && <span className="text-warn">{t("adjustments.stale")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card className="flex min-w-0 flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">
            {t("settings.mode", { mode: mode ? t(`modes.${mode}`) : NULL_DISPLAY })}
          </p>
          {!synced && <p className="text-sm text-muted">{t("settings.convertNote")}</p>}
          {mode === "assets" && <ConversionButton context={context} />}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{t("settings.periods")}</h3>
          <ul className="flex flex-col text-sm text-muted">
            {detail.periods.map((period) => (
              <li key={`${period.fromOn}-${period.reason}-${period.mode}`}>
                {t("settings.period", {
                  mode: t(`modes.${period.mode}`),
                  origin: t(`origins.${period.origin}`),
                  date: long(period.fromOn),
                })}
              </li>
            ))}
          </ul>
        </div>
        <ServiceUrlForm accountId={accountId} url={summary.investment.url} />
        <p className="text-sm text-muted">
          {t("settings.flags")}{" "}
          <Link
            href={`/accounts/${accountId}?tab=settings` as Route}
            className="focus-ring inline rounded-[4px] text-accent hover:underline"
          >
            {t("actions.accountSettings")}
          </Link>
        </p>
      </Card>
    </Page>
  );
}
