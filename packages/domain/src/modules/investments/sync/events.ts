import { addDays, type CivilDate, civilDateIn } from "../../../shared/dates";
import { type Tx } from "../../../platform/db/client";
import { eurPerUnitOn, type RateTable } from "../../../platform/fx/rules";
import { saveRates, storedRange } from "../../../platform/fx/service";
import { fetchEcbRates } from "../../../platform/fx/sources";
import { type ProviderEvent } from "../../../platform/integrations/investments/source";
import { linkExternal } from "../../../platform/integrations/service";
import { type OperationKind, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE } from "../rules";
import { divRound, parseDecimal } from "../../../shared/money";
import { type InvestmentAccount, insertEvent, type LegInput, type WriteCtx } from "../service";
import { assetFor, providerHoldingFor } from "./readings";
import { SyncError } from "./sources";

/**
 * The ECB rates the events of a window need, fetched once when `fx_rates` starts after them: a
 * trade of 2021 is converted at the rate of its own day (§1.8), never at today's.
 */
export async function ensureRatesFrom(day: CivilDate, todayOn: CivilDate): Promise<void> {
  const stored = await storedRange();
  if (stored.earliest !== null && stored.earliest <= day) return;
  const to = stored.earliest === null ? todayOn : addDays(stored.earliest, -1);
  if (to < day) return;
  await saveRates(await fetchEcbRates({ from: day, to }));
}

/** Account units per unit of `from` on `on`, scaled; `null` without a rate. */
export function rateBetween(rates: RateTable, from: string, to: string, on: CivilDate): bigint | null {
  if (from === to) return null;
  const source = eurPerUnitOn(rates, from, on);
  const target = eurPerUnitOn(rates, to, on);
  if (source === null || target === null) return null;
  return divRound(source * 10n ** BigInt(RATE_SCALE), target);
}

/** A rate a source gives, read at the precision of a coin's quantity before it is rounded. */
export const SOURCE_RATE_SCALE = 18;

const SIGN: Record<string, 1n | -1n> = {
  deposit: 1n,
  withdrawal: -1n,
  buy: -1n,
  sell: 1n,
  close: 1n,
  income: 1n,
  fee: -1n,
};

/**
 * The provider's events as events of the account (A6): new ones only — an id already linked is the
 * same event — each with its legs and its link in the same transaction, the amounts converted to
 * the account's currency at the ECB rate of their day. Returns the oldest day written.
 */
export async function writeEvents(
  ctx: WriteCtx,
  tx: Tx,
  investment: InvestmentAccount,
  currency: string,
  events: readonly ProviderEvent[],
  known: ReadonlySet<string>,
  rates: RateTable,
  now: Date,
  cutoff: CivilDate | null = null,
): Promise<{ created: number; oldest: CivilDate | null }> {
  let created = 0;
  let oldest: CivilDate | null = null;
  for (const event of events) {
    if (known.has(event.externalId)) continue;
    const on = civilDateIn(event.occurredAt, ctx.timeZone);
    // Nothing older than the 12 months of the service (PERS-145): it is in the opening.
    if (cutoff !== null && on < cutoff) continue;
    const legs: LegInput[] = [];
    for (const leg of event.legs) {
      const native = parseDecimal(leg.nativeAmount, PRICE_SCALE);
      const nativeCents = divRound(native, 10n ** BigInt(PRICE_SCALE - 2));
      // A leg the source priced itself (a coin at the exchange's close, §1.8): its own rate, at
      // full precision — a fee of 0.0001 BNB is cents, not zero; "unpriced" counts no amount.
      const sourced = leg.fxSource !== undefined && leg.fxSource !== null;
      const sourcedRate =
        sourced && leg.fxRate !== null && leg.fxRate !== undefined
          ? parseDecimal(leg.fxRate, SOURCE_RATE_SCALE)
          : null;
      const fxRate = sourced
        ? sourcedRate === null
          ? null
          : divRound(sourcedRate, 10n ** BigInt(SOURCE_RATE_SCALE - RATE_SCALE))
        : rateBetween(rates, leg.nativeCurrency, currency, on);
      if (!sourced && leg.nativeCurrency !== currency && fxRate === null)
        throw new SyncError("provider_unavailable");
      const amount = sourced
        ? sourcedRate === null
          ? 0n
          : divRound(native * sourcedRate, 10n ** BigInt(PRICE_SCALE + SOURCE_RATE_SCALE - 2))
        : fxRate === null
          ? nativeCents
          : divRound(nativeCents * fxRate, 10n ** BigInt(RATE_SCALE));
      const holdingId =
        leg.asset === null || leg.product === null
          ? null
          : await providerHoldingFor(
              ctx,
              tx,
              investment.id,
              await assetFor(ctx, tx, leg.asset),
              leg.product,
              on,
            );
      legs.push({
        leg: leg.leg,
        kind: leg.kind as OperationKind,
        holdingId,
        quantity: leg.quantity === null ? null : parseDecimal(leg.quantity, QUANTITY_SCALE),
        unitPrice: leg.unitPrice === null ? null : parseDecimal(leg.unitPrice, PRICE_SCALE),
        priceCurrency: leg.priceCurrency,
        nativeAmount: native,
        nativeCurrency: leg.nativeCurrency,
        fxRate,
        fxSource: sourced ? leg.fxSource : fxRate === null ? null : `ecb:${on}`,
        amountCents: SIGN[leg.kind] * (amount < 0n ? -amount : amount),
      });
    }
    const written = await insertEvent(ctx, tx, investment.id, {
      on,
      occurredAt: event.occurredAt,
      origin: "provider",
      note: event.note,
      legs,
    });
    await linkExternal(
      ctx,
      {
        provider: investment.provider,
        entityType: "investment_event",
        entityId: written.id,
        externalId: event.externalId,
      },
      now,
      tx,
    );
    created += 1;
    if (oldest === null || on < oldest) oldest = on;
  }
  return { created, oldest };
}
