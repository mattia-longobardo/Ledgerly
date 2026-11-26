import { and, asc, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { getAccount } from "../../accounts";
import { alertAdmins } from "../../../platform/alerts/gotify";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type HoldingsSnapshot,
  type KeyCheck,
  sourceErrorLog,
  sourceErrorText,
} from "../../../platform/integrations/investments/source";
import {
  finishRun,
  linkExternal,
  markConnection,
  readCredentials,
  recordRun,
  unlinkEntities,
} from "../../../platform/integrations/service";
import type { Cents } from "../../../shared/money";
import { cashGaps, GAP_NOTES, openingCashAt } from "../cutoff";
import {
  investmentAccountPeriods,
  investmentEvents,
  investmentHoldings,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
} from "../schema";
import {
  insertEvent,
  linkCashLegs,
  loadBook,
  lockInvestmentAccount,
  rebuild,
  type WriteCtx,
} from "../service";
import { estimateHistoryOf, syncFlows } from "./history";
import { noteFailure, todayLookup, type Linked } from "./quantities";
import { insertKeyCheck, statusOf, writeReading } from "./readings";
import { READ_PERMISSIONS, sourceOf } from "./sources";

/**
 * The cut-off of a service connected new (PERS-145): the first day of its one opening period, the
 * 12 months it reads. `null` for a handover, a conversion or a manual service, which keep their past.
 */
export async function cutoffOf(
  ctx: Pick<Ctx, "userId">,
  tx: Pick<Tx, "select">,
  investmentAccountId: string,
): Promise<CivilDate | null> {
  const periods = await tx
    .select()
    .from(investmentAccountPeriods)
    .where(
      and(
        userScoped(ctx).owns(investmentAccountPeriods),
        eq(investmentAccountPeriods.investmentAccountId, investmentAccountId),
      ),
    )
    .orderBy(asc(investmentAccountPeriods.fromOn));
  if (periods.length !== 1 || periods[0].reason !== "opening" || periods[0].origin !== "synced") return null;
  return periods[0].fromOn;
}

export interface Settled {
  cutoff: CivilDate | null;
  /** Provider events before the cut-off removed, with their legs and links. */
  events: number;
  /** Readings before the cut-off removed. */
  readings: number;
  /** Provider holdings no leg uses any more, removed. */
  holdings: number;
  /** The cash opened at the cut-off, when the provider booked none. */
  openingCents: Cents | null;
  /** Differences of the cash booked as entries of their own. */
  gaps: number;
}

/**
 * The 12 months of a synced service (PERS-145, rules 1, 2, 4), for a service connected new only —
 * an account a source reads, a handover or a manual service is never touched: nothing before its
 * cut-off (the provider's events and readings, the holdings left with no leg), its cash opened at
 * the cut-off when the provider booked none, and every difference of its cash an entry with a name
 * and a day (`cashGaps`). One transaction; idempotent: a second run finds nothing to do.
 */
export async function settleCutoff(ctx: WriteCtx, accountId: string): Promise<Settled> {
  const currency = (await getAccount(ctx, accountId))?.currency;
  const none: Settled = { cutoff: null, events: 0, readings: 0, holdings: 0, openingCents: null, gaps: 0 };
  if (!currency) return none;
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const cutoff = await cutoffOf(ctx, tx, investment.id);
    if (cutoff === null || investment.provider === "manual") return none;
    const provider = investment.provider;

    const old = await tx
      .select({ id: investmentEvents.id })
      .from(investmentEvents)
      .where(
        and(
          userScoped(ctx).owns(investmentEvents),
          eq(investmentEvents.investmentAccountId, investment.id),
          eq(investmentEvents.origin, "provider"),
          lt(investmentEvents.on, cutoff),
        ),
      )
      .orderBy(asc(investmentEvents.id));
    const ids = old.map((one) => one.id);
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500);
      await tx
        .delete(investmentEvents)
        .where(and(inArray(investmentEvents.id, chunk), userScoped(ctx).owns(investmentEvents)));
      await unlinkEntities(ctx, provider, "investment_event", chunk, tx);
    }
    const readings = await tx
      .delete(investmentReadings)
      .where(
        and(
          userScoped(ctx).owns(investmentReadings),
          eq(investmentReadings.investmentAccountId, investment.id),
          lt(investmentReadings.on, cutoff),
        ),
      )
      .returning({ id: investmentReadings.id });
    const used = tx
      .select({ id: investmentOperations.holdingId })
      .from(investmentOperations)
      .where(and(userScoped(ctx).owns(investmentOperations), isNotNull(investmentOperations.holdingId)));
    const positioned = tx
      .select({ id: investmentHoldings.id })
      .from(investmentHoldings)
      .innerJoin(
        investmentReadingPositions,
        and(
          eq(investmentReadingPositions.assetId, investmentHoldings.assetId),
          eq(investmentReadingPositions.product, investmentHoldings.product),
        ),
      )
      .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingPositions.readingId))
      .where(
        and(
          userScoped(ctx).owns(investmentHoldings),
          eq(investmentReadings.investmentAccountId, investment.id),
        ),
      );
    const holdings = await tx
      .delete(investmentHoldings)
      .where(
        and(
          userScoped(ctx).owns(investmentHoldings),
          eq(investmentHoldings.investmentAccountId, investment.id),
          eq(investmentHoldings.origin, "provider"),
          notInArray(investmentHoldings.id, used),
          notInArray(investmentHoldings.id, positioned),
        ),
      )
      .returning({ id: investmentHoldings.id });

    // The cash of the cut-off (rule 2), when the provider's opening did not book it.
    let book = await loadBook(ctx, investment, currency, tx);
    let openingCents: Cents | null = null;
    const openedCash = book.events.some(
      (event) =>
        event.origin === "provider" &&
        event.on === cutoff &&
        event.operations.some((op) => op.kind === "opening_cash"),
    );
    if (!openedCash) {
      openingCents = openingCashAt(book, cutoff);
      if (openingCents !== null) {
        const event = await insertEvent(ctx, tx, investment.id, {
          on: cutoff,
          occurredAt: new Date(`${cutoff}T00:00:00Z`),
          origin: "provider",
          note: GAP_NOTES.opening,
          legs: [{ leg: "main", kind: "opening_cash", amountCents: openingCents }],
        });
        await linkExternal(
          ctx,
          { provider, entityType: "investment_event", entityId: event.id, externalId: "opening:cash" },
          new Date(),
          tx,
        );
        book = await loadBook(ctx, investment, currency, tx);
      }
    }

    // Every difference of the cash, an entry with a name and a day (rule 4).
    const gaps = cashGaps(book, cutoff);
    for (const gap of gaps) {
      const event = await insertEvent(ctx, tx, investment.id, {
        on: gap.to,
        occurredAt: new Date(`${gap.to}T23:59:59Z`),
        origin: "provider",
        note: gap.exchange ? GAP_NOTES.exchange : GAP_NOTES.balance,
        legs: [{ leg: "main", kind: gap.cents < 0n ? "fee" : "income", amountCents: gap.cents }],
      });
      await linkExternal(
        ctx,
        {
          provider,
          entityType: "investment_event",
          entityId: event.id,
          externalId: `gap:${gap.from}:${gap.to}`,
        },
        new Date(),
        tx,
      );
    }

    const changed = ids.length + readings.length + holdings.length + gaps.length > 0 || openingCents !== null;
    if (changed) await rebuild(ctx, investment, currency, cutoff, tx);
    return {
      cutoff,
      events: ids.length,
      readings: readings.length,
      holdings: holdings.length,
      openingCents,
      gaps: gaps.length,
    };
  });
}

export async function runFlows(ctx: WriteCtx, linked: Linked, now: Date): Promise<boolean> {
  const run = await recordRun(ctx, { connectionId: linked.connection.id, kind: "flows" });
  try {
    const created = await syncFlows(ctx, linked.connection, linked.investment.accountId, now);
    // The reconstructed history, once the flows are in (PERS-100): a failure waits for the next pass.
    const estimated = await estimateHistoryOf(ctx, linked, now).catch((error: unknown) => {
      console.error("[investments] history not rebuilt", sourceErrorLog(linked.connection.provider, error));
      return 0;
    });
    // The 12 months, settled (PERS-145): a failure waits for the next pass, and changes nothing.
    await settleCutoff(ctx, linked.investment.accountId).catch((error: unknown) => {
      console.error("[investments] cut-off not settled", sourceErrorLog(linked.connection.provider, error));
    });
    // The deposits and withdrawals as giroconti in the accounts (PERS-651): only what changed is
    // written, so a pass that reads the same events again adds nothing.
    await linkCashLegs(ctx, linked.investment.accountId).catch((error: unknown) => {
      console.error("[investments] legs not linked", sourceErrorLog(linked.connection.provider, error));
    });
    await finishRun(ctx, run.id, { counts: estimated > 0 ? { created, estimated } : { created } }, now);
    return true;
  } catch (error) {
    await finishRun(
      ctx,
      run.id,
      { counts: {}, error: sourceErrorText(linked.connection.provider, error), cause: error },
      now,
    );
    console.error("[investments] flows failed", sourceErrorLog(linked.connection.provider, error));
    return false;
  }
}

/** The holdings of a pass: the key checked again (SEC-01), then the reading of the day (R5). */
export async function runHoldings(
  ctx: WriteCtx,
  linked: Linked,
  now: Date,
): Promise<"answered" | "failed" | "refused"> {
  const { connection, investment } = linked;
  const run = await recordRun(ctx, { connectionId: connection.id, kind: "holdings" });
  const source = sourceOf(connection.provider);
  let credentials: Record<string, string>;
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    credentials = await readCredentials(ctx, connection.id);
    check = await source.verifyReadOnly(credentials);
  } catch (error) {
    await insertKeyCheck(ctx, getDb(), {
      investmentAccountId: investment.id,
      connectionId: connection.id,
      provider: connection.provider,
      origin: "pass",
      check: null,
      now,
    });
    await finishRun(
      ctx,
      run.id,
      { counts: {}, error: sourceErrorText(connection.provider, error), cause: error },
      now,
    );
    return noteFailure(ctx, linked, error, now, "check");
  }
  await insertKeyCheck(ctx, getDb(), {
    investmentAccountId: investment.id,
    connectionId: connection.id,
    provider: connection.provider,
    origin: "pass",
    check,
    now,
  });
  if (check.result !== "read-only") {
    // §5.2: refused, nothing read, the administrator told which permission was found.
    const text = `${connection.provider} · key_${check.result.replace("-", "_")}`;
    // A key that can do more than read is a key to replace: the code of a key that does not work.
    await finishRun(ctx, run.id, { counts: {}, error: text, cause: { code: "auth" } }, now);
    await markConnection(ctx, connection.id, "error", text, now);
    // What the key may do beyond reading: eToro's scopes, Binance's flags that are on (§5.2).
    const found = Object.entries(check.permissions)
      .filter(([name, on]) => on && !name.endsWith(":read") && !READ_PERMISSIONS.has(name))
      .map(([name]) => name)
      .slice(0, 10);
    await alertAdmins({
      title: "Ledgerly: investment key refused",
      message: `The ${connection.provider} key is not read only (${found.join(", ") || check.result}). Ledgerly stopped reading it until a key that only reads is saved.`,
      priority: 8,
    });
    return "refused";
  }
  try {
    snapshot = await source.fetchHoldings(
      credentials,
      linked.currency,
      now,
      await todayLookup(ctx, linked.currency, now),
    );
  } catch (error) {
    await finishRun(
      ctx,
      run.id,
      { counts: {}, error: sourceErrorText(connection.provider, error), cause: error },
      now,
    );
    return noteFailure(ctx, linked, error, now, "read");
  }
  const todayOn = today(ctx.timeZone, now);
  await getDb().transaction(async (tx) => {
    const locked = await lockInvestmentAccount(ctx, investment.accountId, tx);
    await writeReading(ctx, tx, locked, {
      on: todayOn,
      observedAt: snapshot.observedAt,
      status: await statusOf(ctx, tx, locked, snapshot, todayOn),
      totalCents: snapshot.totalCents,
      cashCents: snapshot.cashCents,
      externalAccountId: snapshot.externalAccountId,
      snapshot,
      scopes: snapshot.scopes,
    });
    await rebuild(ctx, locked, linked.currency, todayOn, tx);
  });
  await finishRun(ctx, run.id, { counts: { updated: 1, created: snapshot.positions.length } }, now);
  return "answered";
}
