// The services and their operations for the export (§2.4).
import type { Ctx } from "../../../platform/context";
import { investmentsPortfolio } from "./home";
import { trimmed } from "./holdings";
import { type InvestmentsSnapshot, investmentsSnapshot, snapshotOf } from "./snapshot";
import { investmentsPnl } from "./views";

/**
 * What the export reads (audit INV-5, decisions D9, D10): the read-model of `GET /investments`,
 * every service with the archived ones, and the P&L of the period the API takes by default — the
 * year running — for its Modified Dietz return. One snapshot of the books for all of it.
 */
export async function investmentsExport(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  now: Date,
) {
  const snapshot = await investmentsSnapshot(ctx, { now });
  const options = { includeArchived: true };
  const [portfolio, pnl, operations] = await Promise.all([
    investmentsPortfolio(ctx, snapshot, options),
    investmentsPnl(ctx, { period: null, from: null, to: null }, snapshot, options),
    investmentOperationsExport(ctx, snapshot),
  ]);
  return { portfolio, pnl, operations };
}

/** For the export: every operation leg of every service, oldest first, with its transfer (§2.4). */
export async function investmentOperationsExport(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Date | InvestmentsSnapshot = new Date(),
) {
  const { loaded } = await snapshotOf(ctx, source);
  const names = new Map(loaded.map((one) => [one.investment.id, one.account.name]));
  const groups = new Map<string, string[]>();
  for (const one of loaded) {
    for (const event of one.book.eventRows) {
      if (event.transferGroupId === null) continue;
      groups.set(event.transferGroupId, [
        ...(groups.get(event.transferGroupId) ?? []),
        event.investmentAccountId,
      ]);
    }
  }
  return loaded.flatMap((one) => {
    const holdingNames = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
    return one.book.eventRows.flatMap((event) => {
      const other =
        event.transferGroupId === null
          ? undefined
          : groups.get(event.transferGroupId)?.find((id) => id !== event.investmentAccountId);
      return one.book.operationRows
        .filter((op) => op.eventId === event.id)
        .map((op) => ({
          on: event.on,
          service: one.account.name,
          currency: one.account.currency,
          kind: op.kind,
          leg: op.leg,
          asset: op.holdingId ? (holdingNames.get(op.holdingId) ?? null) : null,
          quantity: op.quantity === null ? null : trimmed(op.quantity),
          unitPrice: op.unitPrice === null ? null : trimmed(op.unitPrice),
          amountCents: op.amountCents,
          transferWith: other === undefined ? null : (names.get(other) ?? null),
          note: event.note,
        }));
    });
  });
}
