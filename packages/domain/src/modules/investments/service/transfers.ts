// Transfers between the person's accounts (§2.4, A10): the legs, a link, an unlink.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  TRANSFER_WINDOW_DAYS,
  type TransferLeg,
  PRICE_SCALE,
  QUANTITY_SCALE,
  transferProposals,
} from "../rules";
import { parseDecimal } from "../../../shared/money";
import { investmentAccounts, investmentEvents, investmentHoldings, investmentOperations } from "../schema";
import { abs } from "../../../shared/money";
import { requireEvent } from "./operations";
import { InvestmentError, type WriteCtx } from "./types";

// ——— Transfers between the person's accounts (§2.4, A10) ————————————————————————————————————

/**
 * The main legs of every deposit and withdrawal of the person's services, as the transfer
 * proposal compares them: the asset and its quantity, or the cash amount and its currency.
 */
export async function transferLegs(ctx: Pick<Ctx, "userId">): Promise<TransferLeg[]> {
  const rows = await getDb()
    .select({
      eventId: investmentEvents.id,
      accountId: investmentAccounts.accountId,
      on: investmentEvents.on,
      transferGroupId: investmentEvents.transferGroupId,
      kind: investmentOperations.kind,
      assetId: investmentHoldings.assetId,
      quantity: investmentOperations.quantity,
      nativeAmount: investmentOperations.nativeAmount,
      nativeCurrency: investmentOperations.nativeCurrency,
      amountCents: investmentOperations.amountCents,
    })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentEvents.investmentAccountId))
    .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentOperations.leg, "main"),
        inArray(investmentOperations.kind, ["deposit", "withdrawal"]),
      ),
    )
    .orderBy(asc(investmentEvents.on), asc(investmentEvents.id));
  if (rows.length === 0) return [];
  const currencies = new Map(
    (await listAccounts(ctx, { includeArchived: true })).map((account) => [account.id, account.currency]),
  );
  return rows.map((row) => {
    const asset = row.assetId !== null && row.quantity !== null;
    const cash =
      row.nativeAmount !== null && row.nativeCurrency !== null
        ? { amount: parseDecimal(row.nativeAmount, PRICE_SCALE), currency: row.nativeCurrency }
        : {
            amount: row.amountCents * 10n ** BigInt(PRICE_SCALE - 2),
            currency: currencies.get(row.accountId) ?? null,
          };
    return {
      eventId: row.eventId,
      accountId: row.accountId,
      on: row.on,
      kind: row.kind as TransferLeg["kind"],
      assetId: asset ? row.assetId : null,
      amount: abs(asset ? parseDecimal(row.quantity as string, QUANTITY_SCALE) : cash.amount),
      currency: asset ? null : cash.currency,
      transferGroupId: row.transferGroupId,
    };
  });
}

export async function clearTransferGroup(ctx: Pick<Ctx, "userId">, tx: Tx, groupId: string): Promise<void> {
  await tx
    .update(investmentEvents)
    .set({ transferGroupId: null })
    .where(and(eq(investmentEvents.transferGroupId, groupId), userScoped(ctx).owns(investmentEvents)));
}

export const transferInputSchema = z.object({ withdrawalId: z.uuid(), depositId: z.uuid() });
export type TransferInput = z.input<typeof transferInputSchema>;

/**
 * Links a withdrawal and a deposit of two of the person's services as one transfer (§2.4): both
 * events get the same `transfer_group_id`. Each account keeps it as a flow, the portfolio leaves
 * it out. Only a pair the proposal would make is accepted — different accounts, same asset and
 * quantity or same cash amount, at most {@link TRANSFER_WINDOW_DAYS} apart, neither linked yet —
 * so no value of either account changes and no point is rewritten.
 */
export async function linkTransfer(ctx: WriteCtx, input: TransferInput): Promise<string> {
  const parsed = transferInputSchema.parse(input);
  const legs = await transferLegs(ctx);
  const withdrawal = legs.find((leg) => leg.eventId === parsed.withdrawalId);
  const deposit = legs.find((leg) => leg.eventId === parsed.depositId);
  if (!withdrawal || !deposit) throw new InvestmentError("not_found");
  const apart =
    Math.abs(Date.parse(`${withdrawal.on}T00:00:00Z`) - Date.parse(`${deposit.on}T00:00:00Z`)) / 86_400_000;
  if (
    withdrawal.kind !== "withdrawal" ||
    deposit.kind !== "deposit" ||
    withdrawal.accountId === deposit.accountId ||
    withdrawal.assetId !== deposit.assetId ||
    withdrawal.currency !== deposit.currency ||
    withdrawal.amount !== deposit.amount ||
    apart > TRANSFER_WINDOW_DAYS
  ) {
    throw new InvestmentError("not_a_transfer");
  }
  const groupId = randomUUID();
  await getDb().transaction(async (tx) => {
    // Both rows locked and checked again: a concurrent link of either leg loses here.
    const locked = await tx
      .select({ id: investmentEvents.id, transferGroupId: investmentEvents.transferGroupId })
      .from(investmentEvents)
      .where(
        and(
          inArray(investmentEvents.id, [withdrawal.eventId, deposit.eventId]),
          userScoped(ctx).owns(investmentEvents),
        ),
      )
      .for("update");
    if (locked.length !== 2) throw new InvestmentError("not_found");
    if (locked.some((row) => row.transferGroupId !== null)) throw new InvestmentError("not_a_transfer");
    await tx
      .update(investmentEvents)
      .set({ transferGroupId: groupId })
      .where(
        and(
          inArray(investmentEvents.id, [withdrawal.eventId, deposit.eventId]),
          userScoped(ctx).owns(investmentEvents),
        ),
      );
  });
  return groupId;
}

/** Undoes a transfer: both legs are plain deposits and withdrawals again (§2.4); a leg of `ofAccount` when given. */
export async function unlinkTransfer(ctx: WriteCtx, eventId: string, ofAccount?: string): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw new InvestmentError("not_found");
  await getDb().transaction(async (tx) => {
    const { event } = await requireEvent(ctx, eventId, tx, ofAccount);
    if (!event.transferGroupId) throw new InvestmentError("not_a_transfer");
    await clearTransferGroup(ctx, tx, event.transferGroupId);
  });
}

/** How many transfers between the person's services wait to be confirmed (rewrite plan R5e, «Da fare»). */
export async function transfersToConfirm(ctx: Pick<Ctx, "userId">): Promise<number> {
  return transferProposals(await transferLegs(ctx)).length;
}
