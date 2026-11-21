// The services and their operations for the export and the command palette (§2.4).
import type { Ctx } from "../../../platform/context";
import { NO_RATES } from "../../../platform/fx/rules";
import { type Cents } from "../../../shared/money";
import { type Mode } from "../rules";
import { type Xirr } from "../../../shared/returns";
import { trimmed } from "./holdings";
import { investmentsSnapshot } from "./snapshot";
import { summaryOf } from "./summary";

/** For the export and the ⌘K palette: every service by name with its value and returns today. */
export async function investmentServices(ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">): Promise<
  {
    accountId: string;
    name: string;
    category: string;
    provider: string;
    mode: Mode | null;
    currency: string;
    valueCents: Cents | null;
    investedCents: Cents;
    gainCents: Cents | null;
    simpleReturn: number | null;
    xirr: Xirr | null;
    reliableFrom: Date | null;
  }[]
> {
  const { todayOn, loaded } = await investmentsSnapshot(ctx);
  return loaded.map((one) => {
    const summary = summaryOf(one, todayOn, one.account.currency, NO_RATES);
    return {
      accountId: one.account.id,
      name: one.account.name,
      category: one.investment.category,
      provider: one.investment.provider,
      mode: one.day.mode,
      currency: one.account.currency,
      valueCents: one.day.valueCents,
      investedCents: summary.performance.investedCents,
      gainCents: summary.performance.gainCents,
      simpleReturn: summary.performance.simpleReturn,
      xirr: summary.xirr,
      reliableFrom: summary.reliableFrom,
    };
  });
}

/** For the export: every operation leg of every service, oldest first, with its transfer (§2.4). */
export async function investmentOperationsExport(ctx: Pick<Ctx, "userId" | "timeZone">) {
  const { loaded } = await investmentsSnapshot(ctx);
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
