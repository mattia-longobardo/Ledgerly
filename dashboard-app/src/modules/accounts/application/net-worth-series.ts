import type { MonthPoint } from "@/lib/contracts";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { Account, BalancePoint } from "../domain/account";
import { monthlySeries, totalSeries } from "../domain/net-worth";
import type { UseCaseDeps } from "./deps";
import { DEFAULT_TREND_MONTHS, isStale, trendMonths } from "./list-accounts";

export interface NetWorthAccountSeries {
  account: Account;
  series: MonthPoint[];
  latest: BalancePoint | null;
}

export interface NetWorthSeries {
  months: string[];
  total: MonthPoint[];
  perAccount: NetWorthAccountSeries[];
  /** Newest capture behind the figure, or null when nothing has ever been captured. */
  asOf: Date | null;
  stale: boolean;
  unavailableCount: number;
}

/**
 * Net worth is the sum of the accounts the owner marked as counting towards it.
 * An `unavailable` account still counts — the provider lost sight of it, but the
 * money did not stop existing — while an archived one is gone from the figure by
 * definition, so `list()` excluding archived rows is exactly the wanted filter.
 */
export function netWorthSeries(deps: UseCaseDeps) {
  return async (principal: Principal, months: number = DEFAULT_TREND_MONTHS): Promise<NetWorthSeries> => {
    assertPermission(principal, "accounts.read");
    const now = deps.clock.now();
    const monthKeys = trendMonths(now, months);

    const all = await deps.accounts.list(principal.userId);
    const included = all.filter(
      (a) => a.includeInNetWorth && (a.status === "active" || a.status === "unavailable"),
    );

    const latestBalances = await deps.accounts.latestBalances(principal.userId);
    const history = await deps.accounts.history(
      principal.userId,
      included.map((a) => a.id),
      monthKeys[0]!,
    );

    const perAccount: NetWorthAccountSeries[] = included.map((account) => ({
      account,
      series: monthlySeries(
        history.filter((p) => p.accountId === account.id),
        monthKeys,
      ),
      latest: latestBalances.get(account.id) ?? null,
    }));

    let asOf: Date | null = null;
    let stale = false;
    for (const { account, latest } of perAccount) {
      if (latest && (!asOf || latest.capturedAt > asOf)) asOf = latest.capturedAt;
      if (isStale(account, latest, now)) stale = true;
    }

    return {
      months: monthKeys,
      total: totalSeries(
        perAccount.map((r) => r.series),
        monthKeys,
      ),
      perAccount,
      asOf,
      stale,
      unavailableCount: included.filter((a) => a.status === "unavailable").length,
    };
  };
}
