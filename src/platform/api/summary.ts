import "server-only";
import { Hono } from "hono";
import { accountsView } from "@/modules/accounts/queries";
import { transactionsSummary } from "@/modules/transactions/queries";
import { lastDayOfMonth, monthKey, today } from "@/platform/dates";
import { withToken, type ApiEnv } from "./auth";
import { money } from "./json";

/**
 * `GET /api/v1/summary` — the Home Assistant card (plan F8 §3.4.10): net worth, liquidity, and
 * what came in and went out this month.
 *
 * The one route that lives here rather than in a module's own `api.ts`, because it belongs to no
 * single module: it is a composition of two, and putting it inside either would make that module
 * depend on the other for a number it does not own. It still reads nothing itself — both figures
 * come from the very queries the screens are drawn from, so the card and Overview can never
 * disagree (D5).
 */
export const summaryApi = new Hono<ApiEnv>();

summaryApi.get("/summary", withToken("read"), async (c) => {
  const ctx = c.get("ctx");
  const month = monthKey(today(ctx.timeZone));
  const [accounts, movements] = await Promise.all([
    accountsView(ctx, { months: 1 }),
    transactionsSummary(ctx, { from: month, to: lastDayOfMonth(month) }),
  ]);
  return c.json({
    month,
    netWorth: money(accounts.total),
    /** True when at least one account counted has no balance yet: the total is a floor, not a fact. */
    netWorthPartial: accounts.totalPartial,
    previousNetWorth: money(accounts.previousTotal),
    cash: money(accounts.buckets.cash.total),
    cashPartial: accounts.buckets.cash.partial,
    income: money(movements.incomeCents),
    expense: money(movements.expenseCents),
    net: money(movements.netCents),
    transactions: movements.count,
    accounts: accounts.rows.length,
    lastSnapshotMonth: accounts.lastSnapshot?.month ?? null,
  });
});
