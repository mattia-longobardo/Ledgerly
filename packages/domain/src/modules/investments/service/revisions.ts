// The stored side of an operation's edit and deletion (§1.5, A2): the event found under its service,
// its legs kept as revisions, and the positions nothing refers to any more.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import type { Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  investmentAccounts,
  investmentEvents,
  investmentHoldings,
  investmentOperationRevisions,
  investmentOperations,
} from "../schema";
import { InvestmentError, type InvestmentEvent, type WriteCtx } from "./types";

/** The person's event, of the service `ofAccount` when given: otherwise `not_found`. */
export async function requireEvent(
  ctx: Pick<Ctx, "userId">,
  eventId: string,
  trx: Pick<Tx, "select">,
  ofAccount?: string,
) {
  const [row] = await trx
    .select({ event: investmentEvents, accountId: investmentAccounts.accountId })
    .from(investmentEvents)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentEvents.investmentAccountId))
    .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
  if (!row || (ofAccount !== undefined && row.accountId !== ofAccount))
    throw new InvestmentError("not_found");
  return row;
}

/** Saves every leg of an event as it was (A2): an operation is never overwritten silently. */
export async function keepRevisions(
  ctx: Pick<Ctx, "userId">,
  trx: Tx,
  event: InvestmentEvent,
  reason: "edited" | "deleted",
): Promise<void> {
  const legs = await trx
    .select()
    .from(investmentOperations)
    .where(and(eq(investmentOperations.eventId, event.id), userScoped(ctx).owns(investmentOperations)));
  if (legs.length === 0) return;
  await trx.insert(investmentOperationRevisions).values(
    legs.map((leg) =>
      userScoped(ctx).stamp({
        investmentAccountId: event.investmentAccountId,
        eventId: event.id,
        operationId: leg.id,
        reason,
        before: {
          on: event.on,
          note: event.note,
          transactionId: event.transactionId,
          leg: leg.leg,
          kind: leg.kind,
          holdingId: leg.holdingId,
          quantity: leg.quantity,
          unitPrice: leg.unitPrice,
          priceCurrency: leg.priceCurrency,
          fxRate: leg.fxRate,
          fxSource: leg.fxSource,
          amountCents: leg.amountCents.toString(),
          validUntil: leg.validUntil,
        },
      }),
    ),
  );
}

/** A position nothing refers to any more goes with its last operation. */
export async function dropUnusedHoldings(
  ctx: WriteCtx,
  trx: Tx,
  legs: { holdingId: string | null }[],
): Promise<void> {
  const holdingIds = [...new Set(legs.flatMap((leg) => (leg.holdingId ? [leg.holdingId] : [])))];
  for (const holdingId of holdingIds) {
    const [used] = await trx
      .select({ id: investmentOperations.id })
      .from(investmentOperations)
      .where(eq(investmentOperations.holdingId, holdingId))
      .limit(1);
    if (!used) {
      await trx
        .delete(investmentHoldings)
        .where(and(eq(investmentHoldings.id, holdingId), userScoped(ctx).owns(investmentHoldings)));
    }
  }
}
