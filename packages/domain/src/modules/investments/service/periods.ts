// The first day of a manual portfolio (rewrite plan R5d, P4): a purchase plan that started before the
// portfolio was made here writes its past instalments, and the deposits that paid them, before the day
// it was made. The portfolio then starts that day instead, as a service whose history turns out to
// start earlier (sync/history.ts). Never over days whose value was Accounts': a portfolio made from a
// service kept by value («Switch to positions»), or on an account that had a balance, has them.
import { and, asc, eq } from "drizzle-orm";
import { openedNoLaterThan } from "../../accounts";
import type { CivilDate } from "../../../shared/dates";
import type { Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { PORTFOLIO_PROVIDER } from "../catalog";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentEvents,
  investmentOperations,
} from "../schema";
import { type InvestmentAccount, InvestmentError, type WriteCtx } from "./types";

/** Whether the portfolio took an opening cash: the balance its account had before it was made. */
async function hadBalance(ctx: WriteCtx, investment: InvestmentAccount, transaction: Tx): Promise<boolean> {
  const [row] = await transaction
    .select({ id: investmentOperations.id })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(
      and(
        userScoped(ctx).owns(investmentOperations),
        eq(investmentEvents.investmentAccountId, investment.id),
        eq(investmentOperations.kind, "opening_cash"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A write of the person on `day`, before the first day of a manual portfolio: the portfolio starts on
 * `day` from now on, in the caller's transaction (all or nothing). `before_positions` when the days
 * before were a value only. Any other service, or a day already in a period, is left as it is.
 */
export async function startPortfolioBy(
  ctx: WriteCtx,
  investment: InvestmentAccount,
  day: CivilDate,
  transaction: Tx,
): Promise<InvestmentAccount> {
  if (investment.provider !== PORTFOLIO_PROVIDER) return investment;
  const [first] = await transaction
    .select()
    .from(investmentAccountPeriods)
    .where(
      and(
        userScoped(ctx).owns(investmentAccountPeriods),
        eq(investmentAccountPeriods.investmentAccountId, investment.id),
      ),
    )
    .orderBy(asc(investmentAccountPeriods.startsAt))
    .limit(1);
  if (!first || first.fromOn <= day) return investment;
  if (first.mode !== "assets" || (await hadBalance(ctx, investment, transaction))) {
    throw new InvestmentError("before_positions");
  }
  await transaction
    .update(investmentAccountPeriods)
    .set({ fromOn: day, startsAt: new Date(`${day}T00:00:00Z`) })
    .where(eq(investmentAccountPeriods.id, first.id));
  const openedOn = investment.openedOn !== null && investment.openedOn < day ? investment.openedOn : day;
  const [moved] = await transaction
    .update(investmentAccounts)
    .set({ managedSince: day, openedOn, updatedAt: new Date() })
    .where(eq(investmentAccounts.id, investment.id))
    .returning();
  await openedNoLaterThan(ctx, investment.accountId, day, transaction);
  return moved;
}
