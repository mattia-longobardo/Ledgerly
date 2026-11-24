// What investments lends subscriptions (R5d, §11.3.3): the payees of the movements tied to one of its
// operations — a purchase of a plan linked to its debit, a deposit — which are no subscription.
import { and, isNotNull } from "drizzle-orm";
import { transactionsByIds } from "../../transactions/queries";
import { payeeKeyOf } from "../../transactions/rules";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { investmentEvents } from "../schema";

export async function linkedPayeeKeys(ctx: Pick<Ctx, "userId">): Promise<Set<string>> {
  const rows = await getDb()
    .selectDistinct({ id: investmentEvents.transactionId })
    .from(investmentEvents)
    .where(and(userScoped(ctx).owns(investmentEvents), isNotNull(investmentEvents.transactionId)));
  const movements = await transactionsByIds(
    ctx,
    rows.flatMap((row) => (row.id === null ? [] : [row.id])),
  );
  const keys = [...movements.values()].map((movement) => payeeKeyOf(movement.payee));
  return new Set(keys.filter((key) => key !== null));
}
