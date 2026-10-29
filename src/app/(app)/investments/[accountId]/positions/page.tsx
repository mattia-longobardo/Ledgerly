import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { type HoldingRow } from "@/modules/investments/queries";
import { isUnpricedDust, parseDecimal } from "@/modules/investments/rules";
import { type HoldingSummary, HoldingMenu, ReconcileButton } from "@/modules/investments/ui/dialogs";
import { productLabel } from "@/modules/investments/ui/labels";
import { requireSession } from "@/platform/auth/session";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { loadService, serviceContextOf } from "../service-data";

const priceCents = (text: string) => parseDecimal(text, 2);

/**
 * A service's Positions (docs/design/investments-ux.md §3.4): the positions open today. U4 adds the
 * P&L of the period, the closed positions and the leftovers without a market.
 */
export default async function InvestmentServicePositions({
  params,
}: PageProps<"/investments/[accountId]/positions">) {
  const ctx = await requireSession();
  const { accountId } = await params;
  const t = await getTranslations("investments");
  const detail = await loadService(accountId);
  if (!detail) notFound();
  const context = serviceContextOf(detail, ctx);
  const currency = detail.currency;
  const own = (cents: Cents | null) => formatMoney(cents, ctx.numberFormat, { currency });
  const signed = (cents: Cents | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat, { signed: true, currency });
  const tp = (key: "products.spot") => t(key);
  const latestReading = detail.readings[0] ?? null;
  const { mode } = detail.summary;
  const synced = detail.summary.origin === "synced";

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
  const priceCell = (row: HoldingRow) =>
    row.priceText === null ? (
      <span className="text-muted">
        {row.state.quantity === null
          ? t("assets.byValue")
          : isUnpricedDust(row.state)
            ? t("assets.dust")
            : t("assets.noPrice")}
      </span>
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
  const holdingActions = (row: HoldingRow) =>
    row.origin === "provider" ? null : (
      <span className="flex items-center justify-end gap-1">
        {row.conflict && <ReconcileButton holding={holdingOf(row)} context={context} />}
        <HoldingMenu holding={holdingOf(row)} context={context} />
      </span>
    );
  const nameCell = (row: HoldingRow) => (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="max-w-full truncate font-medium">{row.asset.name}</span>
      <span className="text-xs text-muted">
        {[t(`classes.${row.asset.class}`), productLabel(row.product, tp)].join(" · ")}
      </span>
      {row.origin === "manual" && synced && <Badge tone="neutral">{t("origins.manual")}</Badge>}
      {row.conflict && <Badge tone="warn">{t("assets.conflict")}</Badge>}
    </span>
  );

  return (
    <>
      {mode === "total" && !synced && <p className="text-sm text-muted">{t("detail.totalModeNote")}</p>}
      <Card padded={false} className="min-w-0">
        <CardHeader title={t("tabs.positions")} />
        {detail.holdings.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("assets.empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto max-md:hidden">
              <Table>
                <THead>
                  <Th>{t("assets.asset")}</Th>
                  <Th align="right">{t("assets.quantity")}</Th>
                  <Th align="right">{t("assets.price")}</Th>
                  <Th align="right">{t("assets.value")}</Th>
                  <Th align="right">{t("assets.weight")}</Th>
                  <Th align="right">{t("assets.gain")}</Th>
                  <Th align="right">
                    <span className="sr-only">{t("assets.actions")}</span>
                  </Th>
                </THead>
                <TBody>
                  {detail.holdings.map((row) => (
                    <Tr key={row.id} data-testid="holding-row">
                      <Td className="max-w-64 py-1">{nameCell(row)}</Td>
                      <Td align="right">{row.quantityText ?? NULL_DISPLAY}</Td>
                      <Td align="right" className="py-1">
                        {priceCell(row)}
                      </Td>
                      <Td align="right">{own(row.state.valueCents)}</Td>
                      <Td align="right">{formatPercent(row.weight, ctx.numberFormat)}</Td>
                      <Td align="right" className="py-1">
                        {gainCell(row)}
                      </Td>
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
                  <div className="flex items-start justify-between gap-2">
                    {nameCell(row)}
                    {holdingActions(row)}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
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
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {mode === "assets" && !synced && detail.day.cashCents < 0n && (
        <p className="text-sm text-warn">{t("detail.negativeCash")}</p>
      )}
      {detail.day.conflicts.length > 0 && <p className="text-sm text-warn">{t("detail.conflictNote")}</p>}
    </>
  );
}
