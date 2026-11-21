// Reading an account's book (docs/design/investments.md §2): the book, its rates, its value and the points rebuild writes.
import { and, asc, eq } from "drizzle-orm";
import { balanceDays, getAccount, replacePortfolioPoints } from "../../accounts";
import { movementsByAccount } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type RateTable } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import { MANUAL_PROVIDER } from "../catalog";
import {
  type AccountBalanceLike,
  type Book,
  compareEvents,
  computePoints,
  type EventLike,
  type OperationLike,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
} from "../rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
  investmentReadingScopes,
  investmentReconciliations,
} from "../schema";
import {
  fromNumeric,
  type InvestmentAccount,
  type InvestmentAsset,
  InvestmentError,
  type InvestmentEvent,
  type InvestmentHolding,
  type InvestmentOperation,
  type InvestmentPeriod,
  type InvestmentReading,
  type WriteCtx,
} from "./types";

// ——— Reading an account's book ——————————————————————————————————————————————————————————————

export async function requireInvestmentAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  tx?: Tx,
): Promise<InvestmentAccount> {
  const [row] = await (tx ?? getDb())
    .select()
    .from(investmentAccounts)
    .where(and(eq(investmentAccounts.accountId, accountId), userScoped(ctx).owns(investmentAccounts)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

/** Takes the account's row lock: two writes to one account rebuild its points one after the other. */
export async function lockInvestmentAccount(ctx: Pick<Ctx, "userId">, accountId: string, tx: Tx) {
  const [row] = await tx
    .select()
    .from(investmentAccounts)
    .where(and(eq(investmentAccounts.accountId, accountId), userScoped(ctx).owns(investmentAccounts)))
    .for("update");
  if (!row) throw new InvestmentError("not_found");
  return row;
}

/** Awaits lazy query builders one at a time, keeping the tuple's types. */
async function inOrder<T extends readonly unknown[]>(
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}

export interface LoadedBook extends Book {
  periodRows: InvestmentPeriod[];
  eventRows: InvestmentEvent[];
  operationRows: InvestmentOperation[];
  holdingRows: (InvestmentHolding & { asset: InvestmentAsset })[];
  readingRows: InvestmentReading[];
}

/** Everything the engine needs about one account, read in one go (inside `tx` when given). */
export async function loadBook(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  investment: InvestmentAccount,
  currency: string,
  tx?: Tx,
): Promise<LoadedBook> {
  const db = tx ?? getDb();
  const id = investment.id;
  // One after the other: inside a transaction they share one connection, and a query builder only
  // runs when awaited, so a `Promise.all` would pile them onto the same client at once.
  const [
    periodRows,
    eventRows,
    operationRows,
    holdingJoin,
    readingRows,
    positionRows,
    scopeRows,
    reconciliations,
  ] = await inOrder([
    db
      .select()
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn), asc(investmentAccountPeriods.startsAt)),
    db
      .select()
      .from(investmentEvents)
      .where(and(userScoped(ctx).owns(investmentEvents), eq(investmentEvents.investmentAccountId, id)))
      .orderBy(asc(investmentEvents.on), asc(investmentEvents.occurredAt), asc(investmentEvents.seq)),
    db
      .select({ operation: investmentOperations })
      .from(investmentOperations)
      .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
      .where(and(userScoped(ctx).owns(investmentOperations), eq(investmentEvents.investmentAccountId, id)))
      .orderBy(asc(investmentOperations.eventId), asc(investmentOperations.leg)),
    db
      .select({ holding: investmentHoldings, asset: investmentAssets })
      .from(investmentHoldings)
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
      .where(and(userScoped(ctx).owns(investmentHoldings), eq(investmentHoldings.investmentAccountId, id)))
      .orderBy(asc(investmentAssets.name), asc(investmentHoldings.id)),
    db
      .select()
      .from(investmentReadings)
      .where(and(userScoped(ctx).owns(investmentReadings), eq(investmentReadings.investmentAccountId, id)))
      .orderBy(asc(investmentReadings.on)),
    db
      .select({ position: investmentReadingPositions })
      .from(investmentReadingPositions)
      .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingPositions.readingId))
      .where(
        and(userScoped(ctx).owns(investmentReadingPositions), eq(investmentReadings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReadingPositions.id)),
    db
      .select({ scope: investmentReadingScopes })
      .from(investmentReadingScopes)
      .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingScopes.readingId))
      .where(
        and(userScoped(ctx).owns(investmentReadingScopes), eq(investmentReadings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReadingScopes.id)),
    db
      .select({ reconciliation: investmentReconciliations })
      .from(investmentReconciliations)
      .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentReconciliations.holdingId))
      .where(
        and(userScoped(ctx).owns(investmentReconciliations), eq(investmentHoldings.investmentAccountId, id)),
      )
      .orderBy(asc(investmentReconciliations.effectiveOn), asc(investmentReconciliations.decidedAt)),
  ]);
  const operations = operationRows.map((row) => row.operation);
  const opsByEvent = new Map<string, OperationLike[]>();
  for (const op of operations) {
    const list = opsByEvent.get(op.eventId) ?? [];
    list.push({
      leg: op.leg,
      holdingId: op.holdingId,
      kind: op.kind,
      quantity: fromNumeric(op.quantity, QUANTITY_SCALE),
      unitPrice: fromNumeric(op.unitPrice, PRICE_SCALE),
      priceCurrency: op.priceCurrency,
      amountCents: op.amountCents,
      fxRate: fromNumeric(op.fxRate, RATE_SCALE),
      validUntil: op.validUntil,
      nativeCurrency: op.nativeCurrency,
    });
    opsByEvent.set(op.eventId, list);
  }
  const events: EventLike[] = eventRows.map((event) => ({
    id: event.id,
    on: event.on,
    occurredAt: event.occurredAt,
    seq: event.seq,
    origin: event.origin,
    transferGroupId: event.transferGroupId,
    operations: opsByEvent.get(event.id) ?? [],
  }));
  const holdingRows = holdingJoin.map((row) => ({ ...row.holding, asset: row.asset }));
  const view =
    investment.provider === MANUAL_PROVIDER ? await accountView(ctx, investment, periodRows) : null;
  return {
    currency,
    ...(view ? { accountBalances: view.balances } : {}),
    periods: periodRows.map((period) => ({
      fromOn: period.fromOn,
      startsAt: period.startsAt,
      mode: period.mode,
      origin: period.origin,
    })),
    events: view
      ? [...events.filter((event) => event.origin !== "manual"), ...view.events].sort(compareEvents)
      : events,
    holdings: holdingRows.map((holding) => ({
      id: holding.id,
      assetId: holding.assetId,
      origin: holding.origin,
      product: holding.product,
      currency: holding.asset.currency,
    })),
    readings: readingRows.map((reading) => ({
      id: reading.id,
      on: reading.on,
      status: reading.status,
      totalCents: reading.totalCents,
      cashCents: reading.cashCents,
      positions: positionRows
        .filter((row) => row.position.readingId === reading.id)
        .map((row) => ({
          assetId: row.position.assetId,
          product: row.position.product,
          valueCents: row.position.valueCents,
          quantity: fromNumeric(row.position.quantity, QUANTITY_SCALE),
          costCents: row.position.costCents,
          unitPrice: fromNumeric(row.position.price, PRICE_SCALE),
          priceCurrency: row.position.priceCurrency,
        })),
      scopes: scopeRows
        .filter((row) => row.scope.readingId === reading.id)
        .map((row) => ({ product: row.scope.product, complete: row.scope.complete })),
    })),
    reconciliations: reconciliations.map(({ reconciliation }) => ({
      holdingId: reconciliation.holdingId,
      effectiveOn: reconciliation.effectiveOn,
      kind: reconciliation.kind,
      quantity: fromNumeric(reconciliation.quantity, QUANTITY_SCALE),
      decidedAt: reconciliation.decidedAt,
    })),
    periodRows,
    eventRows: view ? eventRows.filter((event) => event.origin !== "manual") : eventRows,
    operationRows: operations,
    holdingRows,
    readingRows,
  };
}

/**
 * What a manual service reads from Accounts (docs/design/investments.md §1.3, PERS-342): it is a
 * view on its account, not a writer. Its value is the account's balance (typed in Accounts or read
 * by Wallet), and its deposits and withdrawals are the account's movements from the service's first
 * day: money in is a deposit, money out a withdrawal. The operations typed in the module before
 * (origin `manual`) no longer count; the history of a past connection and the openings do.
 */
async function accountView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  investment: InvestmentAccount,
  periodRows: readonly InvestmentPeriod[],
): Promise<{ balances: AccountBalanceLike[]; events: EventLike[] }> {
  const [balances, movements] = await Promise.all([
    balanceDays(ctx, [investment.accountId]),
    movementsByAccount(ctx, [investment.accountId]),
  ]);
  const first = periodRows.reduce<CivilDate | null>(
    (min, period) => (min === null || period.fromOn < min ? period.fromOn : min),
    null,
  );
  const events: EventLike[] = (movements.get(investment.accountId) ?? [])
    .filter((movement) => first !== null && movement.on >= first && movement.cents !== 0n)
    .map((movement) => ({
      id: movement.id,
      on: movement.on,
      occurredAt: movement.occurredAt,
      seq: 0n,
      origin: "provider" as const,
      transferGroupId: movement.transferGroupId,
      operations: [
        {
          leg: "main" as const,
          holdingId: null,
          kind: movement.cents > 0n ? ("deposit" as const) : ("withdrawal" as const),
          quantity: null,
          unitPrice: null,
          priceCurrency: null,
          amountCents: movement.cents,
          fxRate: null,
          validUntil: null,
        },
      ],
    }));
  return { balances: balances.get(investment.accountId) ?? [], events };
}

/** The rates a book's values need: its account currency and every asset's quote currency. */
export async function ratesFor(book: Book, to: CivilDate): Promise<RateTable> {
  const from = book.periods.reduce<CivilDate>(
    (min, period) => (period.fromOn < min ? period.fromOn : min),
    to,
  );
  const currencies = new Set([book.currency, ...book.holdings.map((holding) => holding.currency)]);
  return currencies.size === 1 ? new Map() : ratesOn(currencies, from, to);
}

/**
 * A service's book with the rates that value it up to `todayOn`: what `valueAt` reads, loaded the
 * same way for the pages and the API and for the `portfolio` balances `rebuild` writes (audit INV-3).
 */
export async function valuedBook(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  investment: InvestmentAccount,
  valuing: { currency: string; todayOn: CivilDate; transaction?: Tx },
): Promise<{ book: LoadedBook; rates: RateTable }> {
  const book = await loadBook(ctx, investment, valuing.currency, valuing.transaction);
  return { book, rates: await ratesFor(book, valuing.todayOn) };
}

/**
 * Rewrites the account's `portfolio` points from `from` on (§1.7), inside the transaction that
 * changed its data: `valueAt` on the book as the transaction now sees it, the projection of the
 * value the pages read.
 */
export async function rebuild(
  ctx: WriteCtx,
  investment: InvestmentAccount,
  currency: string,
  from: CivilDate,
  tx: Tx,
): Promise<void> {
  // A manual service writes no balance (§1.3, PERS-342): Accounts holds its value.
  if (investment.provider === MANUAL_PROVIDER) return;
  const todayOn = today(ctx.timeZone);
  const { book, rates } = await valuedBook(ctx, investment, { currency, todayOn, transaction: tx });
  const points = computePoints(book, rates, todayOn, from);
  await replacePortfolioPoints(ctx, { accountId: investment.accountId, from, points }, tx);
}

export async function currencyOf(ctx: Pick<Ctx, "userId">, accountId: string): Promise<string> {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return account.currency;
}

/** Rewrites every point of an account from its first period: the repair the itests also run. */
export async function rebuildAll(ctx: WriteCtx, accountId: string): Promise<void> {
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  await getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const [first] = await tx
      .select({ fromOn: investmentAccountPeriods.fromOn })
      .from(investmentAccountPeriods)
      .where(
        and(
          userScoped(ctx).owns(investmentAccountPeriods),
          eq(investmentAccountPeriods.investmentAccountId, investment.id),
        ),
      )
      .orderBy(asc(investmentAccountPeriods.fromOn))
      .limit(1);
    if (first) await rebuild(ctx, investment, account.currency, first.fromOn, tx);
  });
}
