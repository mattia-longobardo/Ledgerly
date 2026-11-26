// Funds · the account's legs of the voluntary contributions (PERS-651,
// docs/design/investments-cash-movements.md §3.3): money that left one of the person's accounts for
// the fund, a giroconto of origin `investments` on the fund's account, paired with the bank's
// movement. A contribution from the payslip has none: it is held back from the gross pay and never
// passes through an account. The rule is per operation, never per fund.
import { and, asc, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { wantedLegOf } from "../../../shared/cash-legs";
import { getAccount } from "../../accounts";
import { fundLegs } from "../ports";
import { fundOperations, funds } from "../schema";

/** The legs of one fund in line with its voluntary contributions, then paired. Returns the legs that changed. */
export async function linkFundLegs(ctx: Pick<Ctx, "userId" | "timeZone">, fundId: string): Promise<number> {
  const [fund] = await getDb()
    .select({ accountId: funds.valuationAccountId })
    .from(funds)
    .where(and(eq(funds.id, fundId), userScoped(ctx).owns(funds)));
  const currency = fund ? (await getAccount(ctx, fund.accountId))?.currency : undefined;
  if (!fund || !currency) return 0;
  const written = await getDb().transaction(async (trx) => {
    const operations = await trx
      .select({
        id: fundOperations.id,
        on: fundOperations.operationDate,
        amountCents: fundOperations.workerCents,
        note: fundOperations.note,
        transactionId: fundOperations.transactionId,
        legTransactionId: fundOperations.legTransactionId,
      })
      .from(fundOperations)
      .where(
        and(
          userScoped(ctx).owns(fundOperations),
          eq(fundOperations.fundId, fundId),
          eq(fundOperations.classification, "voluntary"),
        ),
      )
      .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id));
    const legs = await fundLegs().writeLegs(
      trx,
      ctx,
      { id: fund.accountId, currency },
      operations.map(wantedLegOf),
    );
    for (const [index, operation] of operations.entries()) {
      if (legs.legIds[index] === operation.legTransactionId) continue;
      await trx
        .update(fundOperations)
        .set({ legTransactionId: legs.legIds[index] })
        .where(and(eq(fundOperations.id, operation.id), userScoped(ctx).owns(fundOperations)));
    }
    return legs;
  });
  await fundLegs().settleLegs(ctx, written);
  return written.touched.length;
}

/** Every fund of the person (the history, once): a second run changes nothing. */
export async function linkAllFundLegs(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<number> {
  const owned = await getDb()
    .select({ id: funds.id })
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.id));
  let changed = 0;
  for (const fund of owned) changed += await linkFundLegs(ctx, fund.id);
  return changed;
}
