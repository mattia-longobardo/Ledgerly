import { and, asc, desc, eq, inArray, lt, ne, notInArray, or } from "drizzle-orm";
import { getAccount } from "../../accounts/queries";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "../../../platform/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type RateTable } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import {
  type FlowsRead,
  type FxLookup,
  SourceError,
  sourceErrorLog,
  sourceErrorText,
} from "../../../platform/integrations/investments/source";
import {
  type Connection,
  linkExternal,
  markConnection,
  saveSyncJob,
  unlinkEntities,
} from "../../../platform/integrations/service";
import type { Cents } from "../../../platform/money";
import { divRound, formatDecimal, parseDecimal, QUANTITY_SCALE, RATE_SCALE } from "../rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
} from "../schema";
import { type InvestmentAccount, insertEvent, type WriteCtx } from "../service";
import { SOURCE_RATE_SCALE, rateBetween } from "./events";
import { providerHoldingFor, retireKeys, writeCoverage } from "./readings";
import { BACKOFF_KEY, DEFAULT_BACKOFF_SECONDS } from "./sources";

// ——— The pass (§3.1) —————————————————————————————————————————————————————————————————————————

export interface Linked {
  connection: Connection;
  investment: InvestmentAccount;
  currency: string;
}

export async function linkedOf(ctx: Pick<Ctx, "userId">, connection: Connection): Promise<Linked | null> {
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(
      and(userScoped(ctx).owns(investmentAccounts), eq(investmentAccounts.provider, connection.provider)),
    )
    .orderBy(asc(investmentAccounts.createdAt))
    .limit(1);
  if (!investment) return null;
  const account = await getAccount(ctx, investment.accountId);
  if (!account) return null;
  return { connection, investment, currency: account.currency };
}

/**
 * A 401, or a 403 of the key check itself (eToro `/me`, Binance `apiRestrictions`), revokes the
 * connection; a 403 of any other call is only a failed reading (PERS-87 SEC-06). A 429 waits as
 * long as the provider asked (SEC-09).
 */
export async function noteFailure(
  ctx: WriteCtx,
  linked: Linked,
  error: unknown,
  now: Date,
  step: "check" | "read",
): Promise<"failed" | "refused"> {
  const text = sourceErrorText(linked.connection.provider, error);
  console.error("[investments] pass failed", sourceErrorLog(linked.connection.provider, error));
  if (
    error instanceof SourceError &&
    (error.errorClass === "auth" || (error.errorClass === "permission" && step === "check"))
  ) {
    await markConnection(ctx, linked.connection.id, "revoked", text, now);
    await retireKeys(ctx, getDb(), linked.investment.id, now);
    return "refused";
  }
  if (error instanceof SourceError && error.errorClass === "rate_limited") {
    const until = new Date(now.getTime() + (error.retryAfterSeconds ?? DEFAULT_BACKOFF_SECONDS) * 1000);
    await saveSyncJob(
      ctx,
      linked.connection.id,
      "holdings",
      { cursor: { [BACKOFF_KEY]: until.toISOString() } },
      now,
    );
    return "refused";
  }
  return "failed";
}

/** The ECB rates of `rates` as a source asks for them (§1.8): account units per unit, as a decimal. */
export function fxLookupOf(rates: RateTable): FxLookup {
  return (from, to, on) => {
    if (from === to) return "1";
    const rate = rateBetween(rates, from, to, on);
    return rate === null ? null : formatDecimal(rate, RATE_SCALE);
  };
}

/** The fiat a source may need in a rate: USD for a stablecoin's path (§1.8), the usual cash. */
export const LOOKUP_CURRENCIES = ["USD", "EUR", "GBP", "CHF"];

/** The latest ECB rates for a reading of today (§1.8 step 3–4): a week back covers any weekend. */
export async function todayLookup(
  ctx: Pick<Ctx, "timeZone">,
  currency: string,
  now: Date,
): Promise<FxLookup> {
  const todayOn = today(ctx.timeZone, now);
  return fxLookupOf(await ratesOn(new Set([...LOOKUP_CURRENCIES, currency]), addDays(todayOn, -10), todayOn));
}

/** How a leg moves its coin's quantity (A6): in for buy, deposit, income, opening; out otherwise. */
const QUANTITY_SIGN: Record<string, 1n | -1n | 0n> = {
  opening_position: 1n,
  deposit: 1n,
  buy: 1n,
  income: 1n,
  sell: -1n,
  withdrawal: -1n,
  fee: -1n,
  close: -1n,
};

/** A difference this small is dust (B5): under a cent at the reading's price, or 0.001 unpriced. */
function isDust(quantity: bigint, valueCents: Cents | null, reported: bigint): boolean {
  const abs = quantity < 0n ? -quantity : quantity;
  if (valueCents !== null && reported > 0n) {
    return divRound((valueCents < 0n ? -valueCents : valueCents) * abs * 100n, reported) < 100n;
  }
  return abs < 10n ** BigInt(QUANTITY_SCALE - 3);
}

/**
 * A rebase (PERS-141): the source reads a history other than the one it started, so what was
 * inferred from the old reading goes — the provider's inferred openings and every provider event
 * before the history's new start (older is the opening, never rebuilt), with their links, and the
 * estimated readings, with the opening period back on the first real reading. `checkQuantities`
 * infers the openings again and `estimateHistoryOf` estimates the history again, on this pass.
 * Returns the first day it removed, for the points to be written again from there.
 */
export async function undoInferred(
  ctx: WriteCtx,
  tx: Tx,
  investment: InvestmentAccount,
  provider: string,
  historyFrom: Date,
): Promise<CivilDate | null> {
  const openings = await tx
    .selectDistinct({ eventId: investmentOperations.eventId, on: investmentEvents.on })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentEvents.origin, "provider"),
        or(
          and(
            eq(investmentOperations.kind, "opening_position"),
            eq(investmentOperations.quantityBasis, "inferred"),
          ),
          lt(investmentEvents.occurredAt, historyFrom),
        ),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentOperations.eventId));
  const eventIds = openings.map((one) => one.eventId);
  let removedFrom: CivilDate | null = openings[0]?.on ?? null;
  if (eventIds.length > 0) {
    await tx
      .delete(investmentOperations)
      .where(
        and(inArray(investmentOperations.eventId, eventIds), userScoped(ctx).owns(investmentOperations)),
      );
    await tx
      .delete(investmentEvents)
      .where(and(inArray(investmentEvents.id, eventIds), userScoped(ctx).owns(investmentEvents)));
    await unlinkEntities(ctx, provider, "investment_event", eventIds, tx);
  }
  const periods = await tx
    .select()
    .from(investmentAccountPeriods)
    .where(
      and(
        userScoped(ctx).owns(investmentAccountPeriods),
        eq(investmentAccountPeriods.investmentAccountId, investment.id),
      ),
    )
    .orderBy(asc(investmentAccountPeriods.fromOn));
  // Only the history `estimateHistoryOf` wrote: one opening period of a service connected new.
  if (periods.length !== 1 || periods[0].reason !== "opening" || periods[0].origin !== "synced")
    return removedFrom;
  const [real] = await tx
    .select({ on: investmentReadings.on })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        notInArray(investmentReadings.status, ["pending_zero", "reconstructed"]),
      ),
    )
    .orderBy(asc(investmentReadings.on))
    .limit(1);
  if (!real || periods[0].fromOn >= real.on) return removedFrom;
  if (removedFrom === null || periods[0].fromOn < removedFrom) removedFrom = periods[0].fromOn;
  await tx
    .delete(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        eq(investmentReadings.status, "reconstructed"),
      ),
    );
  await tx
    .update(investmentAccountPeriods)
    .set({ fromOn: real.on, startsAt: new Date(`${real.on}T00:00:00Z`) })
    .where(
      and(eq(investmentAccountPeriods.id, periods[0].id), userScoped(ctx).owns(investmentAccountPeriods)),
    );
  await tx
    .update(investmentAccounts)
    .set({ managedSince: real.on, openedOn: real.on })
    .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)));
  return removedFrom;
}

/**
 * The quantities of a source that reads a window of history (A6, §3.2): on the first pass, one
 * `opening_position` per coin held, `inferred` = reported today − net flows of the window; on every
 * pass, opening + Σ legs against the reading, per coin. A difference over dust is a declared gap of
 * the stream `quantities`, never a silent one.
 */
export async function checkQuantities(
  ctx: WriteCtx,
  tx: Tx,
  investment: InvestmentAccount,
  connectionId: string,
  read: FlowsRead,
  now: Date,
): Promise<CivilDate | null> {
  const from = read.historyFrom!;
  const [reading] = await tx
    .select({ id: investmentReadings.id })
    .from(investmentReadings)
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        eq(investmentReadings.investmentAccountId, investment.id),
        ne(investmentReadings.status, "pending_zero"),
      ),
    )
    .orderBy(desc(investmentReadings.on))
    .limit(1);
  if (!reading) return null;
  const positions = await tx
    .select({
      assetId: investmentReadingPositions.assetId,
      quantity: investmentReadingPositions.quantity,
      valueCents: investmentReadingPositions.valueCents,
      class: investmentAssets.class,
      symbol: investmentAssets.symbol,
    })
    .from(investmentReadingPositions)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadingPositions),
        eq(investmentReadingPositions.readingId, reading.id),
      ),
    )
    .orderBy(asc(investmentReadingPositions.id));
  const legs = await tx
    .select({
      assetId: investmentHoldings.assetId,
      kind: investmentOperations.kind,
      quantity: investmentOperations.quantity,
      class: investmentAssets.class,
      symbol: investmentAssets.symbol,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentHoldings.origin, "provider"),
      ),
    )
    .orderBy(asc(investmentOperations.id));

  // Coins only: cash is not a position whose quantity a flow carries.
  const reported = new Map<string, { quantity: bigint; valueCents: Cents | null; symbol: string }>();
  for (const one of positions) {
    if (one.class === "cash") continue;
    const before = reported.get(one.assetId);
    const quantity = parseDecimal(one.quantity, QUANTITY_SCALE);
    reported.set(one.assetId, {
      quantity: (before?.quantity ?? 0n) + quantity,
      valueCents:
        before === undefined
          ? one.valueCents
          : before.valueCents === null || one.valueCents === null
            ? null
            : before.valueCents + one.valueCents,
      symbol: one.symbol ?? "",
    });
  }
  const net = new Map<string, bigint>();
  const symbols = new Map([...reported].map(([assetId, held]) => [assetId, held.symbol]));
  let opened = false;
  for (const one of legs) {
    if (one.class === "cash" || one.quantity === null) continue;
    if (one.kind === "opening_position") opened = true;
    symbols.set(one.assetId, one.symbol ?? "");
    const sign = QUANTITY_SIGN[one.kind] ?? 0n;
    net.set(one.assetId, (net.get(one.assetId) ?? 0n) + sign * parseDecimal(one.quantity, QUANTITY_SCALE));
  }

  const fromOn = civilDateIn(from, ctx.timeZone);
  let negative = false;
  let written: CivilDate | null = null;
  if (!opened && read.openingRates !== undefined) {
    // Every coin held or moved: one sold out within the window started with what it sold (A6).
    for (const [assetId, symbol] of symbols) {
      const held = reported.get(assetId) ?? { quantity: 0n, valueCents: null, symbol };
      const opening = held.quantity - (net.get(assetId) ?? 0n);
      if (isDust(opening, held.valueCents, held.quantity)) continue;
      if (opening < 0n) {
        negative = true;
        continue;
      }
      const rate = read.openingRates[held.symbol] ?? null;
      const rateUnits = rate === null ? null : parseDecimal(rate.rate, SOURCE_RATE_SCALE);
      const valueCents =
        rateUnits === null
          ? 0n
          : divRound(opening * rateUnits, 10n ** BigInt(QUANTITY_SCALE + SOURCE_RATE_SCALE - 2));
      const holdingId = await providerHoldingFor(ctx, tx, investment.id, assetId, "spot", fromOn);
      const event = await insertEvent(ctx, tx, investment.id, {
        on: fromOn,
        occurredAt: from,
        origin: "provider",
        note: "Opening inferred from the history",
        legs: [
          {
            leg: "main",
            kind: "opening_position",
            holdingId,
            quantity: opening,
            fxRate:
              rateUnits === null ? null : divRound(rateUnits, 10n ** BigInt(SOURCE_RATE_SCALE - RATE_SCALE)),
            fxSource: rate?.source ?? "unpriced",
            amountCents: -valueCents,
            quantityBasis: "inferred",
          },
        ],
      });
      await linkExternal(
        ctx,
        {
          provider: investment.provider,
          entityType: "investment_event",
          entityId: event.id,
          externalId: `opening:${held.symbol}`,
        },
        now,
        tx,
      );
      net.set(assetId, (net.get(assetId) ?? 0n) + opening);
      written = fromOn;
    }
  }
  const assets = new Set([...reported.keys(), ...net.keys()]);
  let mismatch = false;
  for (const assetId of assets) {
    const held = reported.get(assetId);
    const difference = (held?.quantity ?? 0n) - (net.get(assetId) ?? 0n);
    if (!isDust(difference, held?.valueCents ?? null, held?.quantity ?? 0n)) mismatch = true;
  }
  await writeCoverage(ctx, tx, connectionId, "flows", [
    {
      stream: "quantities",
      fromAt: from,
      toAt: now,
      status: negative || mismatch ? "partial" : "complete",
      reason: negative ? "negative_opening" : mismatch ? "quantity_mismatch" : null,
    },
  ]);
  return written;
}
