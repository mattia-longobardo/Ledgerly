import "server-only";
import { cache } from "react";
import { accountTypeOf, connectableProvider } from "@/modules/investments/catalog";
import { type ServiceDetail, serviceDetail } from "@/modules/investments/queries";
import { ensureAssetSeed } from "@/modules/investments/service";
import type { ConnectableProvider, OperationSummary, ServiceContext } from "@/modules/investments/ui/dialogs";
import type { ActivityRow } from "@/modules/investments/queries";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { civilDateIn, type CivilDate, today } from "@/platform/dates";
import { formatDate } from "@/platform/format";

/**
 * The service as its layout and its tabs read it, once per request: the layout and the page of a
 * tab render in the same request, and `cache` keeps them from loading the book twice.
 */
export const loadService = cache(async (accountId: string): Promise<ServiceDetail | null> => {
  const ctx = await requireSession();
  // The editable seed of the asset catalog (§1.4), written once, before the dialogs list it.
  await ensureAssetSeed(ctx);
  return serviceDetail(ctx, accountId);
});

/** What every dialog of the service needs to know about it. */
export function serviceContextOf(detail: ServiceDetail, ctx: Ctx): ServiceContext {
  const { summary } = detail;
  return {
    accountId: summary.account.id,
    name: summary.account.name,
    currency: detail.currency,
    numberFormat: ctx.numberFormat,
    locale: ctx.locale,
    today: today(ctx.timeZone),
    mode: summary.mode,
    synced: summary.origin === "synced",
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
}

/** The provider of a synced service, as the key dialogs take it; `null` for a manual one. */
export function providerOf(detail: ServiceDetail): ConnectableProvider | null {
  const one = detail.sync ? connectableProvider(detail.sync.provider) : null;
  if (!one) return null;
  return {
    id: one.id,
    name: one.name,
    accountType: accountTypeOf(one.category),
    ipWhitelist: one.ipWhitelist,
    credentialFields: one.credentialFields,
    currencies: one.currencies,
    defaultCurrency: one.defaultCurrency,
    url: one.url,
    revokeUrl: one.revokeUrl,
  };
}

/** The first day the service has something: where "All" starts and the stepper stops (§2.1). */
export function firstDayOf(detail: ServiceDetail): CivilDate | null {
  const days = [...detail.periods.map((period) => period.fromOn), ...detail.operations.map((row) => row.on)];
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

/** The things to check with an action (§3.2): the badge of the Connection tab, the home's count. */
export function alertsOf(detail: ServiceDetail): number {
  const { warnings } = detail.summary;
  return [
    warnings.conflicts > 0,
    warnings.pendingZero,
    warnings.missingPrices > 0,
    warnings.openAdjustments > 0,
  ].filter(Boolean).length;
}

/** An instant in words: "today 07:30", or "27 Oct 2026, 22:30". */
export function instantText(
  at: Date,
  ctx: Pick<Ctx, "timeZone" | "locale">,
  todayWords: (time: string) => string,
): string {
  const time = new Intl.DateTimeFormat(ctx.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ctx.timeZone,
  }).format(at);
  const day = civilDateIn(at, ctx.timeZone);
  return day === today(ctx.timeZone) ? todayWords(time) : `${formatDate(day, "long", ctx.locale)}, ${time}`;
}

/** An Activity row as the operation dialogs take it. */
export function operationOf(row: ActivityRow): OperationSummary {
  return {
    id: row.id,
    kind: row.leg.kind,
    on: row.on,
    origin: row.origin,
    note: row.note,
    amountCents: row.leg.amountCents,
    validUntil: row.leg.validUntil,
    transactionId: row.transactionId,
    holdingId: row.leg.holdingId,
    holdingName: row.leg.assetName,
    unitPriceText: row.leg.unitPrice,
    adjustmentClass: row.adjustmentClass,
  };
}
