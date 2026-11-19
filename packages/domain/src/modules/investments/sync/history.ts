import { and, asc, eq, notInArray } from "drizzle-orm";
import { openedNoLaterThan } from "../../accounts";
import { addDays, type CivilDate, civilDateIn, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { ratesOn } from "../../../platform/fx/service";
import {
  type Connection,
  readCredentials,
  readSyncJob,
  resolveExternal,
  saveSyncJob,
} from "../../../platform/integrations/service";
import { estimateHistory, HISTORY_RATE_SCALE, type HistoryLeg, historyMoves } from "../history";
import { QUANTITY_SCALE } from "../rules";
import { formatDecimal, parseDecimal } from "../../../shared/money";
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
import { lockInvestmentAccount, rebuild, translated, type WriteCtx } from "../service";
import { ensureRatesFrom, writeEvents } from "./events";
import {
  LOOKUP_CURRENCIES,
  checkQuantities,
  fxLookupOf,
  linkedOf,
  type Linked,
  undoInferred,
} from "./quantities";
import { writeCoverage } from "./readings";
import { cutoffOf } from "./settle";
import { SyncError, sourceOf } from "./sources";

/**
 * The flows of a connection (§3.1 step 3): events, links, coverage and the cursor in one
 * transaction (A7), so a failed write never moves the cursor past what it did not save.
 */
export async function syncFlows(
  ctx: WriteCtx,
  connection: Connection,
  accountId: string,
  now: Date,
): Promise<number> {
  const linked = await linkedOf(ctx, connection);
  if (!linked || linked.investment.accountId !== accountId) throw new SyncError("not_connected");
  const credentials = await readCredentials(ctx, connection.id);
  const todayOn = today(ctx.timeZone, now);
  const cursor = (await readSyncJob(ctx, connection.id, "flows"))?.cursor ?? null;
  // The rates a source may ask for (a stablecoin through USD, §1.8): those already kept.
  const lookupFrom = addDays(todayOn, -761);
  const lookupRates = await ratesOn(new Set([...LOOKUP_CURRENCIES, linked.currency]), lookupFrom, todayOn);
  const since = await cutoffOf(ctx, getDb(), linked.investment.id);
  const read = await sourceOf(connection.provider).fetchFlows(credentials, now, {
    currency: linked.currency,
    cursor,
    fx: fxLookupOf(lookupRates),
    ...(since === null ? {} : { since: new Date(`${since}T00:00:00Z`) }),
  });
  const days = read.events.map((event) => civilDateIn(event.occurredAt, ctx.timeZone));
  const first = days.reduce<CivilDate | null>((min, day) => (min === null || day < min ? day : min), null);
  const currencies = new Set([
    linked.currency,
    ...read.events.flatMap((event) =>
      event.legs
        .filter((leg) => leg.fxSource === undefined || leg.fxSource === null)
        .map((leg) => leg.nativeCurrency),
    ),
  ]);
  if (first !== null && currencies.size > 1) await ensureRatesFrom(first, todayOn);
  const rates =
    first === null || currencies.size === 1 ? new Map() : await ratesOn(currencies, first, todayOn);
  const known = new Set(
    (
      await resolveExternal(
        ctx,
        connection.provider,
        "investment_event",
        read.events.map((event) => event.externalId),
      )
    ).keys(),
  );
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, linked.investment.accountId, tx);
    const cutoff = read.historyFrom === undefined ? await cutoffOf(ctx, tx, investment.id) : null;
    const { created, oldest } = await translated(
      writeEvents(ctx, tx, investment, linked.currency, read.events, known, rates, now, cutoff),
    );
    await writeCoverage(ctx, tx, connection.id, "flows", read.coverage);
    const removed =
      read.rebase && read.historyFrom !== undefined
        ? await undoInferred(ctx, tx, investment, connection.provider, read.historyFrom)
        : null;
    const opened =
      read.historyFrom === undefined
        ? null
        : await translated(checkQuantities(ctx, tx, investment, connection.id, read, now));
    if (read.cursor !== undefined) {
      await saveSyncJob(ctx, connection.id, "flows", { cursor: read.cursor }, now, tx);
    }
    const from = [oldest, opened, removed].filter((day): day is CivilDate => day !== null).sort()[0] ?? null;
    if (from !== null) await rebuild(ctx, investment, linked.currency, from, tx);
    return created;
  });
}

/**
 * The estimated history of a service whose provider has no history of its value (PERS-100,
 * Binance): once, after the flows have reached back past the connection, every day from the first
 * flow to the day before the first reading gets an `estimated` reading — the quantities rebuilt
 * backwards from that reading, at the exchange's daily closes — and the opening period moves back
 * to the first flow, so the chart and the net worth have the 24 months. Network first, then one
 * transaction (V6). Returns the days written.
 */
export async function estimateHistoryOf(ctx: WriteCtx, linked: Linked, now: Date): Promise<number> {
  const source = sourceOf(linked.connection.provider);
  if (!source.fetchDailyRates) return 0;
  const { investment, currency } = linked;
  const periodsOf = (db: Pick<Tx, "select">) =>
    db
      .select()
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, investment.id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn));
  const periods = await periodsOf(getDb());
  // Only a service connected new: a handover or a conversion has a history of its own before.
  if (periods.length !== 1 || periods[0].reason !== "opening" || periods[0].origin !== "synced") return 0;
  const opening = periods[0];
  const [anchor] = await getDb()
    .select({ id: investmentReadings.id, on: investmentReadings.on })
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
  if (!anchor) return 0;
  const legRows = await getDb()
    .select({
      on: investmentEvents.on,
      kind: investmentOperations.kind,
      quantity: investmentOperations.quantity,
      nativeCurrency: investmentOperations.nativeCurrency,
      amountCents: investmentOperations.amountCents,
      symbol: investmentAssets.symbol,
      class: investmentAssets.class,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .leftJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentOperations.id));
  const first = legRows[0]?.on ?? null;
  if (first === null || first >= opening.fromOn || first >= anchor.on) return 0;
  const positions = await getDb()
    .select({
      quantity: investmentReadingPositions.quantity,
      valueCents: investmentReadingPositions.valueCents,
      symbol: investmentAssets.symbol,
      class: investmentAssets.class,
    })
    .from(investmentReadingPositions)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadingPositions),
        eq(investmentReadingPositions.readingId, anchor.id),
      ),
    )
    .orderBy(asc(investmentReadingPositions.id));

  // The account's own cash is cents; every other asset, fiat included, a quantity to price.
  const isCash = (row: { class: string | null; symbol: string | null }) =>
    row.class === "cash" && row.symbol === currency;
  const quantities = new Map<string, bigint>();
  let cashCents = 0n;
  for (const row of positions) {
    if (isCash(row)) cashCents += row.valueCents ?? 0n;
    else if (row.symbol)
      quantities.set(
        row.symbol,
        (quantities.get(row.symbol) ?? 0n) + parseDecimal(row.quantity, QUANTITY_SCALE),
      );
  }
  const legs: HistoryLeg[] = legRows.map((row) => ({
    on: row.on,
    kind: row.kind,
    symbol: row.symbol === null || isCash(row) ? null : row.symbol,
    quantity: row.quantity === null ? null : parseDecimal(row.quantity, QUANTITY_SCALE),
    nativeCurrency: row.nativeCurrency,
    amountCents: row.amountCents,
  }));
  const coins = [
    ...new Set([...quantities.keys(), ...legs.flatMap((leg) => (leg.symbol ? [leg.symbol] : []))]),
  ];
  const todayOn = today(ctx.timeZone, now);
  const lookup = await ratesOn(new Set([...LOOKUP_CURRENCIES, currency]), addDays(first, -7), todayOn);
  const fx = fxLookupOf(lookup);
  const credentials = await readCredentials(ctx, linked.connection.id);
  const daily = await source.fetchDailyRates(
    credentials,
    coins,
    currency,
    new Date(`${first}T00:00:00Z`),
    now,
    fx,
  );
  const days: CivilDate[] = [];
  for (let day = first; day < anchor.on; day = addDays(day, 1)) days.push(day);
  const estimated = estimateHistory({
    days,
    anchor: { on: anchor.on, quantities, cashCents },
    moves: historyMoves(legs, currency),
    rate: (symbol, on) => {
      const text = daily[symbol]?.[on];
      if (text) return parseDecimal(text, HISTORY_RATE_SCALE);
      // Fiat other than the account's own: the ECB rate of the day (§1.8).
      const ecb = /^[A-Z]{3}$/.test(symbol) ? fx(symbol, currency, on) : null;
      return ecb === null ? null : parseDecimal(ecb, HISTORY_RATE_SCALE);
    },
  });
  if (estimated.length === 0) return 0;
  // Where each coin's positions go: the provider's own holding of it (PERS-141).
  const holdingRows = await getDb()
    .select({
      symbol: investmentAssets.symbol,
      assetId: investmentHoldings.assetId,
      product: investmentHoldings.product,
    })
    .from(investmentHoldings)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentHoldings),
        eq(investmentHoldings.investmentAccountId, investment.id),
        eq(investmentHoldings.origin, "provider"),
      ),
    )
    .orderBy(asc(investmentHoldings.product), asc(investmentHoldings.id));
  const assetOf = new Map<string, { assetId: string; product: string }>();
  for (const row of holdingRows) {
    if (!row.symbol) continue;
    const held = assetOf.get(row.symbol);
    if (!held || (held.product !== "spot" && row.product === "spot")) assetOf.set(row.symbol, row);
  }

  return getDb().transaction(async (tx) => {
    const locked = await lockInvestmentAccount(ctx, investment.accountId, tx);
    const again = await periodsOf(tx);
    // Someone else moved the period meanwhile (a conversion, a second pass): nothing to do.
    if (again.length !== 1 || again[0].id !== opening.id || again[0].fromOn !== opening.fromOn) return 0;
    const byDay = new Map(estimated.map((day) => [day.on, day]));
    for (let index = 0; index < estimated.length; index += 500) {
      const written = await tx
        .insert(investmentReadings)
        .values(
          estimated.slice(index, index + 500).map((day) =>
            userScoped(ctx).stamp({
              investmentAccountId: locked.id,
              on: day.on,
              observedAt: new Date(`${day.on}T23:59:59Z`),
              status: "reconstructed" as const,
              totalCents: day.totalCents,
              cashCents: day.cashCents,
              missingPrices: day.missingPrices,
            }),
          ),
        )
        .onConflictDoNothing({ target: [investmentReadings.investmentAccountId, investmentReadings.on] })
        .returning({ id: investmentReadings.id, on: investmentReadings.on });
      const positions = written.flatMap((reading) =>
        (byDay.get(reading.on)?.positions ?? []).flatMap((position) => {
          const held = assetOf.get(position.symbol);
          if (!held) return [];
          return [
            userScoped(ctx).stamp({
              readingId: reading.id,
              assetId: held.assetId,
              product: held.product,
              quantity: formatDecimal(position.quantity, QUANTITY_SCALE),
              valueCents: position.valueCents,
              priceSource: "close",
            }),
          ];
        }),
      );
      for (let at = 0; at < positions.length; at += 1000) {
        await tx.insert(investmentReadingPositions).values(positions.slice(at, at + 1000));
      }
    }
    await tx
      .update(investmentAccountPeriods)
      .set({ fromOn: first, startsAt: new Date(`${first}T00:00:00Z`) })
      .where(
        and(eq(investmentAccountPeriods.id, opening.id), userScoped(ctx).owns(investmentAccountPeriods)),
      );
    await tx
      .update(investmentAccounts)
      .set({ managedSince: first, openedOn: first, updatedAt: now })
      .where(and(eq(investmentAccounts.id, locked.id), userScoped(ctx).owns(investmentAccounts)));
    await openedNoLaterThan(ctx, locked.accountId, first, tx);
    await writeCoverage(ctx, tx, linked.connection.id, "holdings", [
      {
        stream: "balance_history",
        fromAt: new Date(`${first}T00:00:00Z`),
        toAt: new Date(`${anchor.on}T00:00:00Z`),
        status: "complete",
        reason: "reconstructed",
      },
    ]);
    await rebuild(ctx, { ...locked, managedSince: first, openedOn: first }, currency, first, tx);
    return estimated.length;
  });
}
