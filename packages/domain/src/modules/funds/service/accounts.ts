// Funds · what rests on an account (PERS-419): moved or released with it.
import { and, asc, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { fundContributionSources, fundDepositRules, funds } from "../schema";
import { matchDebits } from "./debits";
import { FundError } from "./model";
import { requireAccount } from "./reads";

// ——— What rests on an account (PERS-419) ——————————————————————————————————————————————————————
// The deletion of an account lists these and moves each to another account first: the foreign key
// is `on delete no action`, so one left behind makes the deletion refuse.

/** The funds an account values, and the debit sources that leave it, by the fund's name. */
export async function fundsOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ funds: { id: string; name: string }[]; sources: { id: string; fundName: string }[] }> {
  const valued = await getDb()
    .select({ id: funds.id, name: funds.name })
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.valuationAccountId, accountId)))
    .orderBy(asc(funds.name), asc(funds.id));
  const sources = await getDb()
    .select({ id: fundContributionSources.id, fundName: funds.name })
    .from(fundContributionSources)
    .innerJoin(funds, eq(funds.id, fundContributionSources.fundId))
    .where(
      and(userScoped(ctx).owns(fundContributionSources), eq(fundContributionSources.accountId, accountId)),
    )
    .orderBy(asc(funds.name), asc(fundContributionSources.id));
  return { funds: valued, sources };
}

/**
 * A fund valued by another account. The account must be open and value no other fund
 * (`account_taken`): a fund's value is its account's balance, and two funds cannot share one.
 */
export async function moveFundAccount(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  accountId: string,
): Promise<void> {
  await requireAccount(ctx, accountId);
  try {
    const moved = await getDb()
      .update(funds)
      .set({ valuationAccountId: accountId })
      .where(and(eq(funds.id, fundId), userScoped(ctx).owns(funds)))
      .returning({ id: funds.id });
    if (moved.length === 0) throw new FundError("not_found");
  } catch (error) {
    if (hasPgError(error, UNIQUE_VIOLATION, "funds_valuation_account_uq"))
      throw new FundError("account_taken");
    throw error;
  }
}

/** A debit source that leaves another account; its debits are matched again, as after an edit. */
export async function moveFundSourceAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  sourceId: string,
  accountId: string,
): Promise<void> {
  await requireAccount(ctx, accountId);
  const [row] = await getDb()
    .update(fundContributionSources)
    .set({ accountId })
    .where(and(eq(fundContributionSources.id, sourceId), userScoped(ctx).owns(fundContributionSources)))
    .returning();
  if (!row) throw new FundError("not_found");
  if (row.kind === "bank_debit" && row.state === "active") await matchDebits(ctx, [row.fundId]);
}

/**
 * The model before N6 points at accounts too: `funds.debit_account_id` and `fund_deposit_rules`.
 * No code reads them (they stay for the image before, until R5f), and the sources above replaced
 * them, so they are not listed: a deletion clears them, write only, or their foreign key would
 * refuse it. The image before then sees a fund with no debit account, which is what it is.
 */
export async function releaseFormerAccountReferences(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<void> {
  await getDb()
    .update(funds)
    .set({ debitAccountId: null })
    .where(and(userScoped(ctx).owns(funds), eq(funds.debitAccountId, accountId)));
  await getDb()
    .update(fundDepositRules)
    .set({ accountId: null })
    .where(and(userScoped(ctx).owns(fundDepositRules), eq(fundDepositRules.accountId, accountId)));
}
