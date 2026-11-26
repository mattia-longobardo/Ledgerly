// The account's legs of a service's deposits and withdrawals (PERS-651,
// docs/design/investments-cash-movements.md): each one a giroconto of origin `investments` on the
// service's account, paired with the bank's movement. Written in the transaction that changes an
// operation, after a pass of the provider, and once for the history (`--link-investment-legs`).
import { and, asc, eq, inArray } from "drizzle-orm";
import { getAccount } from "../../accounts";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { wantedLegOf, type WrittenLegs } from "../../../shared/cash-legs";
import { MANUAL_PROVIDER } from "../catalog";
import { cashLegs } from "../ports";
import { investmentAccounts, investmentEvents, investmentOperations } from "../schema";
import { lockInvestmentAccount } from "./book";
import type { InvestmentAccount, WriteCtx } from "./types";

/**
 * Writes the legs of every deposit and withdrawal of the service — the person's and the provider's —
 * inside `trx`, and keeps each event's `leg_transaction_id`. A manual service writes none: its money
 * in and out are the account's own movements (PERS-342); the legs of a service disconnected stay as
 * they were. Returns what `settleLegs` takes after the commit, and the leg of each event.
 */
export async function writeCashLegs(
  ctx: WriteCtx,
  trx: Tx,
  investment: InvestmentAccount,
  currency: string,
): Promise<{ written: WrittenLegs; legOf: Map<string, string> }> {
  if (investment.provider === MANUAL_PROVIDER)
    return { written: { legIds: [], touched: [], choices: new Map() }, legOf: new Map() };
  const events = await trx
    .select({
      id: investmentEvents.id,
      on: investmentEvents.on,
      note: investmentEvents.note,
      transactionId: investmentEvents.transactionId,
      legTransactionId: investmentEvents.legTransactionId,
      amountCents: investmentOperations.amountCents,
    })
    .from(investmentEvents)
    .innerJoin(
      investmentOperations,
      and(eq(investmentOperations.eventId, investmentEvents.id), eq(investmentOperations.leg, "main")),
    )
    .where(
      and(
        userScoped(ctx).owns(investmentEvents),
        eq(investmentEvents.investmentAccountId, investment.id),
        inArray(investmentOperations.kind, ["deposit", "withdrawal"]),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentEvents.id));
  const written = await cashLegs().writeLegs(
    trx,
    ctx,
    { id: investment.accountId, currency },
    events.map(wantedLegOf),
  );
  const legOf = new Map<string, string>();
  for (const [index, event] of events.entries()) {
    const legId = written.legIds[index];
    legOf.set(event.id, legId);
    if (legId === event.legTransactionId) continue;
    await trx
      .update(investmentEvents)
      .set({ legTransactionId: legId })
      .where(and(eq(investmentEvents.id, event.id), userScoped(ctx).owns(investmentEvents)));
  }
  return { written, legOf };
}

/** The legs of one service in line with its operations, then paired. Returns the legs that changed. */
export async function linkCashLegs(ctx: WriteCtx, accountId: string): Promise<number> {
  const currency = (await getAccount(ctx, accountId))?.currency;
  if (!currency) return 0;
  const { written } = await getDb().transaction(async (trx) =>
    writeCashLegs(ctx, trx, await lockInvestmentAccount(ctx, accountId, trx), currency),
  );
  await cashLegs().settleLegs(ctx, written);
  return written.touched.length;
}

/** Every service of the person (the history, once): a second run changes nothing. */
export async function linkAllCashLegs(ctx: WriteCtx): Promise<number> {
  const services = await getDb()
    .select({ accountId: investmentAccounts.accountId })
    .from(investmentAccounts)
    .where(userScoped(ctx).owns(investmentAccounts))
    .orderBy(asc(investmentAccounts.accountId));
  let changed = 0;
  for (const service of services) changed += await linkCashLegs(ctx, service.accountId);
  return changed;
}
