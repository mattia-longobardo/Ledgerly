// A service's page (§4.3): its summary, positions, operations, readings and what can be linked.
import { and, eq, inArray } from "drizzle-orm";
import { findMovements, transactionsByIds } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { ratesOn } from "../../../platform/fx/service";
import { type Cents } from "../../../shared/money";
import { transferProposals } from "../rules";
import { investmentOperationRevisions, investmentReadingScopes } from "../schema";
import { listAssets, transferLegs } from "../service";
import {
  holdingsOf,
  type OperationRow,
  type ServiceDetail,
  type TransferProposalRow,
  trimmed,
} from "./holdings";
import { type InvestmentsSnapshot, servicesOf, snapshotOf } from "./snapshot";
import { LINK_LIMIT, LINK_WINDOW_DAYS, OPEN_ADJUSTMENT_DAYS, summaryOf } from "./summary";

export async function serviceDetail(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  source: Date | InvestmentsSnapshot = new Date(),
): Promise<ServiceDetail | null> {
  const snapshot = await snapshotOf(ctx, source, accountId);
  const { todayOn, accounts } = snapshot;
  const one = servicesOf(snapshot, accountId)[0];
  if (!one) return null;
  const currency = ctx.displayCurrency;
  const displayRates = await ratesOn(
    one.account.currency !== currency ? [currency, one.account.currency] : [],
    todayOn,
    todayOn,
  );
  const summary = summaryOf(one, todayOn, currency, displayRates);
  summary.weight = null;

  const holdings = await holdingsOf(ctx, one, todayOn);

  // Operations, grouped by event, newest first, with their bank link and their revisions.
  const names = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
  const transactionIds = one.book.eventRows.flatMap((event) =>
    event.transactionId ? [event.transactionId] : [],
  );
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const [linked, revisionRows, legs] = await Promise.all([
    transactionsByIds(ctx, transactionIds),
    getDb()
      .select({ eventId: investmentOperationRevisions.eventId })
      .from(investmentOperationRevisions)
      .where(
        and(
          userScoped(ctx).owns(investmentOperationRevisions),
          eq(investmentOperationRevisions.investmentAccountId, one.investment.id),
        ),
      ),
    transferLegs(ctx),
  ]);
  const partnerOf = (event: { id: string; transferGroupId: string | null }) => {
    if (event.transferGroupId === null) return null;
    const other = legs.find(
      (leg) => leg.transferGroupId === event.transferGroupId && leg.eventId !== event.id,
    );
    return other
      ? { accountId: other.accountId, accountName: accountNames.get(other.accountId) ?? "" }
      : null;
  };
  const revisions = new Map<string, number>();
  for (const row of revisionRows) revisions.set(row.eventId, (revisions.get(row.eventId) ?? 0) + 1);
  const operations: OperationRow[] = [...one.book.eventRows].reverse().map((event) => {
    const legs = one.book.operationRows
      .filter((op) => op.eventId === event.id)
      .sort((a, b) => (a.leg === "main" ? -1 : b.leg === "main" ? 1 : a.leg < b.leg ? -1 : 1))
      .map((op) => ({
        id: op.id,
        holdingId: op.holdingId,
        leg: op.leg,
        kind: op.kind,
        holdingName: op.holdingId ? (names.get(op.holdingId) ?? null) : null,
        quantityText: op.quantity === null ? null : trimmed(op.quantity),
        priceText: op.unitPrice === null ? null : trimmed(op.unitPrice),
        priceCurrency: op.priceCurrency,
        amountCents: op.amountCents,
        validUntil: op.validUntil,
        fxSource: op.fxSource,
      }));
    const transaction = event.transactionId ? linked.get(event.transactionId) : undefined;
    return {
      id: event.id,
      on: event.on,
      origin: event.origin,
      note: event.note,
      kind: legs[0]?.kind ?? "deposit",
      legs,
      linked: transaction ? { payee: transaction.payee, on: event.on, cents: transaction.amountCents } : null,
      transactionId: event.transactionId,
      revisions: revisions.get(event.id) ?? 0,
      transfer: partnerOf(event),
    };
  });
  const amountOf = new Map(operations.map((row) => [row.id, row.legs[0]?.amountCents ?? 0n]));
  const proposals: TransferProposalRow[] = transferProposals(legs).flatMap(({ withdrawal, deposit }) => {
    const out = withdrawal.accountId === accountId;
    if (!out && deposit.accountId !== accountId) return [];
    const mine = out ? withdrawal : deposit;
    const other = out ? deposit : withdrawal;
    return [
      {
        withdrawalId: withdrawal.eventId,
        depositId: deposit.eventId,
        direction: out ? ("out" as const) : ("in" as const),
        on: mine.on,
        amountCents: amountOf.get(mine.eventId) ?? 0n,
        other: {
          accountId: other.accountId,
          accountName: accountNames.get(other.accountId) ?? "",
          on: other.on,
        },
      },
    ];
  });

  const scopeRows =
    one.book.readingRows.length === 0
      ? []
      : await getDb()
          .select({
            readingId: investmentReadingScopes.readingId,
            product: investmentReadingScopes.product,
            complete: investmentReadingScopes.complete,
          })
          .from(investmentReadingScopes)
          .where(
            and(
              userScoped(ctx).owns(investmentReadingScopes),
              inArray(
                investmentReadingScopes.readingId,
                one.book.readingRows.map((reading) => reading.id),
              ),
            ),
          );
  // Enough of the latest to fold the runs of equal readings (§3.6); the reconstructed ones are one line.
  const readings = [...one.book.readingRows]
    .filter((reading) => reading.status !== "reconstructed")
    .reverse()
    .slice(0, 60)
    .map((reading) => ({
      id: reading.id,
      on: reading.on,
      status: reading.status,
      totalCents: reading.totalCents,
      missingPrices: reading.missingPrices,
      products: [
        ...new Set(
          scopeRows.filter((row) => row.readingId === reading.id && row.complete).map((row) => row.product),
        ),
      ].sort(),
      // A wallet or account type the provider reports but the adapter does not read (B4, E2).
      unread: [
        ...new Set(
          scopeRows.filter((row) => row.readingId === reading.id && !row.complete).map((row) => row.product),
        ),
      ].sort(),
    }));
  const coveredProducts = readings[0]?.products ?? [];
  const rebuilt = one.book.readingRows.filter((reading) => reading.status === "reconstructed");
  const reconstructedReadings =
    rebuilt.length === 0
      ? null
      : { count: rebuilt.length, from: rebuilt[0].on, to: rebuilt[rebuilt.length - 1].on };
  const firstReadOn = one.book.readingRows.find((reading) => reading.status !== "reconstructed")?.on ?? null;

  const adjustments = one.book.eventRows.flatMap((event) =>
    one.book.operationRows
      .filter((op) => op.eventId === event.id && op.kind === "adjustment")
      .filter((op) => op.validUntil === null || op.validUntil >= todayOn)
      .map((op) => ({
        eventId: event.id,
        on: event.on,
        amountCents: op.amountCents,
        validUntil: op.validUntil,
        note: event.note,
        stale: op.validUntil === null && event.on <= addDays(todayOn, -OPEN_ADJUSTMENT_DAYS),
        adjustmentClass: op.adjustmentClass,
      })),
  );

  const from = addDays(todayOn, -LINK_WINDOW_DAYS);
  const [out, incoming, assets] = await Promise.all([
    findMovements(ctx, { sign: "out", from, to: todayOn, newestFirst: true, limit: LINK_LIMIT }),
    findMovements(ctx, { sign: "in", from, to: todayOn, newestFirst: true, limit: LINK_LIMIT }),
    listAssets(ctx),
  ]);
  const option = (row: {
    id: string;
    accountId: string;
    on: CivilDate;
    cents: Cents;
    payee: string | null;
  }) => ({
    id: row.id,
    on: row.on,
    cents: row.cents < 0n ? -row.cents : row.cents,
    payee: row.payee,
    accountName: accountNames.get(row.accountId) ?? null,
  });

  return {
    summary,
    currency: one.account.currency,
    day: one.day,
    periods: one.book.periodRows.map((period) => ({
      fromOn: period.fromOn,
      mode: period.mode,
      origin: period.origin,
      reason: period.reason,
    })),
    holdings,
    operations,
    readings,
    reconstructedReadings,
    firstReadOn,
    adjustments,
    sync: one.sync,
    coveredProducts,
    assets,
    linkOptions: { out: out.map(option), in: incoming.map(option) },
    transferProposals: proposals,
  };
}
