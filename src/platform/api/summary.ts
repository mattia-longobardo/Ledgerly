import "server-only";
import { Hono } from "hono";
import { monthKey, today } from "@/platform/dates";
import { monthlyFigures } from "@/platform/reports/monthly";
import { withToken, type ApiEnv } from "./auth";
import { money } from "./json";

/**
 * `GET /api/v1/summary` — the Home Assistant card (plan F8 §3.4.10): net worth, liquidity, and
 * what came in and went out this month.
 *
 * The one route that lives here rather than in a module's own `api.ts`, because it belongs to no
 * single module. The figures themselves are `platform/reports/monthly`, which the monthly summary
 * email reads too: the card, the email and Overview cannot quote three different net worths (D5).
 */
export const summaryApi = new Hono<ApiEnv>();

summaryApi.get("/summary", withToken("read"), async (c) => {
  const ctx = c.get("ctx");
  const figures = await monthlyFigures(ctx, monthKey(today(ctx.timeZone)));
  return c.json({
    month: figures.month,
    netWorth: money(figures.netWorthCents),
    // True when an account counted has no balance yet: the total is a floor, not a fact.
    netWorthPartial: figures.netWorthPartial,
    previousNetWorth: money(figures.previousNetWorthCents),
    cash: money(figures.cashCents),
    cashPartial: figures.cashPartial,
    income: money(figures.incomeCents),
    expense: money(figures.expenseCents),
    net: money(figures.netCents),
    transactions: figures.transactions,
    accounts: figures.accounts,
    lastSnapshotMonth: figures.lastSnapshotMonth,
  });
});
