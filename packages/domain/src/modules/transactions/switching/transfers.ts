import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, civilDateIn } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { linkExternal } from "../../../platform/integrations/service";
import { retypeMovements } from "../macro";
import { type SwitchMovement, type TransferCandidate, type TransferPair } from "../switch-rules";
import { switchTransferPairs, transactions } from "../schema";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** A row that counts: not hidden by the person, not gone from its source. */
const visible = () => and(isNull(transactions.hiddenAt), isNull(transactions.removedUpstreamAt));

/** The text two sources both keep of a movement. */
export function textOf(row: { payee: string | null; note: string | null }): string {
  return `${row.payee ?? ""} ${row.note ?? ""}`.trim();
}

/**
 * The movements of an account from `from` to `to` (days in the person's zone), as the comparison of
 * the switch reads them (§4.6): money in and out written by the source, not transfers, visible.
 */
export async function movementsToCompare(
  ctx: Who,
  accountId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<SwitchMovement[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      note: transactions.note,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, accountId),
        eq(transactions.origin, "provider"),
        visible(),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.flatMap((row) => {
    const day = civilDateIn(row.occurredAt, ctx.timeZone);
    return day >= from && day <= to
      ? [{ id: row.id, day, amountCents: row.amountCents, text: textOf(row) }]
      : [];
  });
}

/**
 * The movements of these accounts that may become a leg of a transfer (§4.6.1, point 10): money in
 * or out, not already a transfer, visible. A movement with a category chosen by the person is
 * included: the report says so (`categoryByPerson`).
 */
export async function transferCandidates(
  ctx: Who,
  accountIds: readonly string[],
  since: CivilDate | null = null,
): Promise<(TransferCandidate & { categoryByPerson: boolean })[]> {
  if (accountIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      categoryOrigin: transactions.categoryOrigin,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        ne(transactions.type, "transfer"),
        isNull(transactions.transferGroupId),
        visible(),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.flatMap((row) => {
    const day = civilDateIn(row.occurredAt, ctx.timeZone);
    if (since !== null && day <= since) return [];
    return [
      {
        id: row.id,
        accountId: row.accountId,
        day,
        amountCents: row.amountCents,
        currency: row.currency,
        categoryByPerson: row.categoryOrigin === "user",
      },
    ];
  });
}

/**
 * Makes each pair a transfer (H40): both legs get the type `transfer` and one group, the smaller id,
 * as the provider's pairs. What each leg was is kept, for "Undo switch". Inside the caller's
 * transaction. A leg that is no longer free (another pass made it a transfer) is left alone.
 */
export async function writeTransferPairs(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  switchId: string,
  pairs: readonly TransferPair[],
): Promise<number> {
  let written = 0;
  for (const pair of pairs) {
    const legs = await tx
      .select({ id: transactions.id, type: transactions.type, transferGroupId: transactions.transferGroupId })
      .from(transactions)
      .where(and(inArray(transactions.id, [pair.outId, pair.inId]), userScoped(ctx).owns(transactions)))
      .for("update");
    const out = legs.find((leg) => leg.id === pair.outId);
    const into = legs.find((leg) => leg.id === pair.inId);
    if (!out || !into || out.type === "transfer" || into.type === "transfer") continue;
    if (out.transferGroupId !== null || into.transferGroupId !== null) continue;
    const group = pair.outId < pair.inId ? pair.outId : pair.inId;
    await tx
      .update(transactions)
      .set({ type: "transfer", transferGroupId: group })
      .where(and(inArray(transactions.id, [pair.outId, pair.inId]), userScoped(ctx).owns(transactions)));
    await tx.insert(switchTransferPairs).values(
      userScoped(ctx).stamp({
        switchId,
        outId: pair.outId,
        inId: pair.inId,
        outBefore: { type: out.type, transferGroupId: out.transferGroupId },
        inBefore: { type: into.type, transferGroupId: into.transferGroupId },
      }),
    );
    written += 1;
  }
  return written;
}

/** "Undo switch": every pair of the switch goes back to a money in and a money out, as it was. */
export async function undoTransferPairs(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  switchId: string,
  now: Date,
): Promise<number> {
  const pairs = await tx
    .select()
    .from(switchTransferPairs)
    .where(
      and(
        eq(switchTransferPairs.switchId, switchId),
        isNull(switchTransferPairs.undoneAt),
        userScoped(ctx).owns(switchTransferPairs),
      ),
    );
  for (const pair of pairs) {
    for (const [id, before] of [
      [pair.outId, pair.outBefore],
      [pair.inId, pair.inBefore],
    ] as const) {
      await tx
        .update(transactions)
        .set({ type: before.type, transferGroupId: before.transferGroupId })
        .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
    }
  }
  await tx
    .update(switchTransferPairs)
    .set({ undoneAt: now })
    .where(and(eq(switchTransferPairs.switchId, switchId), isNull(switchTransferPairs.undoneAt)));
  // A leg out of its pair counts by its category (CR3).
  await retypeMovements(tx, ctx);
  return pairs.length;
}

/**
 * The movements found in both sources keep their row and get the bank's link too (§9.1): the next
 * reading of the bank recognises them and creates nothing. Inside the caller's transaction.
 */
export async function linkFoundInBoth(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  provider: string,
  links: readonly { transactionId: string; externalId: string }[],
  now: Date,
): Promise<void> {
  for (const link of links) {
    await linkExternal(
      ctx,
      { provider, entityType: "transaction", entityId: link.transactionId, externalId: link.externalId },
      now,
      tx,
    );
  }
}
