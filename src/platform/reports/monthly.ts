import "server-only";
import { accountsView } from "@/modules/accounts/queries";
import { transactionsSummary } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { lastDayOfMonth, type MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/**
 * The figures of one month: what is owned at the end of it, and what moved during it.
 *
 * A composition of two modules and so of neither — putting it inside accounts would make accounts
 * depend on transactions for a number it does not own, and the other way round. Both callers are
 * here: `GET /api/v1/summary` (the current month, for the Home Assistant card) and the monthly
 * summary email (the month just ended). They read the very queries the screens are drawn from, so
 * a card, an email and Overview can never quote three different net worths (D5).
 */
export interface MonthlyFigures {
  month: MonthKey;
  netWorthCents: Cents | null;
  /** True when an account counted has no balance yet: the total is a floor, not a fact. */
  netWorthPartial: boolean;
  previousNetWorthCents: Cents | null;
  cashCents: Cents | null;
  cashPartial: boolean;
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
  transactions: number;
  accounts: number;
  lastSnapshotMonth: MonthKey | null;
}

export async function monthlyFigures(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  month: MonthKey,
  now: Date = new Date(),
): Promise<MonthlyFigures> {
  const [accounts, movements] = await Promise.all([
    accountsView(ctx, { months: 1, through: month, now }),
    transactionsSummary(ctx, { from: month, to: lastDayOfMonth(month) }),
  ]);
  return {
    month,
    netWorthCents: accounts.total,
    netWorthPartial: accounts.totalPartial,
    previousNetWorthCents: accounts.previousTotal,
    cashCents: accounts.buckets.cash.total,
    cashPartial: accounts.buckets.cash.partial,
    incomeCents: movements.incomeCents,
    expenseCents: movements.expenseCents,
    netCents: movements.netCents,
    transactions: movements.count,
    accounts: accounts.rows.length,
    lastSnapshotMonth: accounts.lastSnapshot?.month ?? null,
  };
}
