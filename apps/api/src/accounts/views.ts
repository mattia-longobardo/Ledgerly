// Accounts · the read views (rewrite plan R2, R3): the net worth by month and by day, an account day
// by day. Every change and share is the domain's rule (`changeBetween`, `shareOf`): a screen shows
// these fields and never works them out.
import type { Hono } from "hono";
import { ACCOUNTS } from "@ledgerly/api-contract";
import {
  accountReconstructedBalances,
  accountsView,
  changeBetween,
  dailyNetWorth,
  getAccount,
  listAccounts,
  shareOf,
  stepsOf,
  windowChangeOf,
} from "@ledgerly/domain/accounts";
import { syncedServicesOf } from "@ledgerly/domain/investments";
import { addDays, type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing } from "./cases";
import { delta, instant, money, viewRow } from "./dto";

const { views } = ACCOUNTS;

/** The longest window of `daily-balances`, as the contract says it. */
const MAX_DAYS = 1100;

function serveNetWorth(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, views.getNetWorth, async ({ ctx, query }) => {
    const view = await accountsView(ctx, {
      months: query.months,
      through: query.through,
      includeArchived: query.includeArchived === "true",
    });
    const services = await syncedServicesOf(
      ctx,
      view.rows.map((row) => row.account.id),
    );
    // Overview's «Year to date»: from the end of December before the year of the window's last month.
    const january = view.months.indexOf(`${(view.months.at(-1) ?? "").slice(0, 4)}-01-01`);
    return {
      currency: view.currency,
      months: view.months,
      netWorth: view.netWorth.map((point, index) => ({
        total: money(point.total),
        partial: point.partial,
        estimated: view.netWorthEstimated[index] ?? false,
      })),
      total: money(view.total),
      totalPartial: view.totalPartial,
      previousTotal: money(view.previousTotal),
      change: delta(changeBetween(view.total, view.previousTotal)),
      yearToDate: delta(
        changeBetween(view.total, january > 0 ? (view.netWorth[january - 1]?.total ?? null) : null),
      ),
      windowChange: delta(windowChangeOf(view.netWorth.map((point) => point.total))),
      buckets: {
        cash: { ...view.buckets.cash, total: money(view.buckets.cash.total) },
        savings: { ...view.buckets.savings, total: money(view.buckets.savings.total) },
        investments: { ...view.buckets.investments, total: money(view.buckets.investments.total) },
        other: { ...view.buckets.other, total: money(view.buckets.other.total) },
      },
      alerts: view.alerts.map((alert) => ({ accountId: alert.accountId, kind: alert.kind })),
      missingRates: view.missingRates,
      lastSnapshotMonth: view.lastSnapshot?.month ?? null,
      accounts: view.rows.map((row) => {
        const service = services.get(row.account.id) ?? null;
        return viewRow(row, {
          change: delta(changeBetween(row.balance, row.previous)),
          seriesChange: stepsOf(row.series).map(delta),
          yoy: delta(changeBetween(row.balance, row.series.at(-13) ?? null)),
          // An archived account is outside the total: a share of it would be a wrong number.
          share: row.account.state === "archived" ? null : shareOf(row.display.balance, view.total),
          service: service && { provider: service.provider, lastSyncedAt: instant(service.lastSyncedAt) },
        });
      }),
    };
  });
}

export function serveViews(app: Hono<ApiEnv>, guard: Guard): void {
  serveNetWorth(app, guard);
  serve(app, guard, views.getNetWorthDaily, async ({ ctx, query }) => {
    const todayOn = today(ctx.timeZone);
    const to: CivilDate = query.to < todayOn ? query.to : todayOn;
    if (query.from > to) throw new ApiRefusal("invalid");
    // At most the last 366 days of the window, as the chart draws them.
    const earliest = addDays(to, -365);
    const from = query.from > earliest ? query.from : earliest;
    const counted = (await listAccounts(ctx)).filter((account) => account.inNetWorth);
    const daily = await dailyNetWorth(ctx, counted, { from, to });
    return {
      currency: daily.currency,
      days: daily.days,
      total: daily.total.map(money),
      estimated: daily.estimated,
      windowChange: delta(windowChangeOf(daily.total)),
      accounts: daily.accounts.map((account) => ({ ...account, values: account.values.map(money) })),
    };
  });
  serve(app, guard, views.getAccountDailyBalances, async ({ ctx, params, query }) => {
    if (!(await getAccount(ctx, params.id))) throw new ApiRefusal("not_found");
    const todayOn = today(ctx.timeZone);
    const to: CivilDate = query.to < todayOn ? query.to : todayOn;
    if (query.from > to || addDays(query.from, MAX_DAYS - 1) < to) throw new ApiRefusal("invalid");
    const daily = await refusing(accountReconstructedBalances(ctx, params.id, { from: query.from, to }));
    return {
      days: daily.days,
      values: daily.values.map(money),
      estimated: daily.estimated,
      changes: stepsOf(daily.values).map(delta),
    };
  });
}
