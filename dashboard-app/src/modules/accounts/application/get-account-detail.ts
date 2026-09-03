import type { MonthPoint } from "@/lib/contracts";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { Account, BalancePoint } from "../domain/account";
import { monthlySeries } from "../domain/net-worth";
import type { UseCaseDeps } from "./deps";
import { NotFoundError } from "./errors";
import { DEFAULT_TREND_MONTHS, isStale, trendMonths } from "./list-accounts";
import type { ProviderLink } from "./ports";

export interface AccountDetail {
  account: Account;
  latest: BalancePoint | null;
  history: BalancePoint[];
  series: MonthPoint[];
  link: ProviderLink | null;
  stale: boolean;
}

export function getAccountDetail(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, opts?: { months?: number }): Promise<AccountDetail> => {
    assertPermission(principal, "accounts.read");
    const account = await deps.accounts.get(principal.userId, id);
    if (!account) throw new NotFoundError();

    const now = deps.clock.now();
    const months = trendMonths(now, opts?.months ?? DEFAULT_TREND_MONTHS);
    const points = await deps.accounts.history(principal.userId, [id], months[0]!);
    const latest = (await deps.accounts.latestBalances(principal.userId)).get(id) ?? null;
    // Same seeding rule as the list trend and the net-worth curve, so one
    // account's chart cannot disagree with the total it feeds.
    const seed = (await deps.accounts.latestBalancesBefore(principal.userId, [id], months[0]!)).get(id) ?? null;

    return {
      account,
      latest,
      history: [...points].sort((a, b) => b.asOf.localeCompare(a.asOf)),
      series: monthlySeries(points, months, seed),
      link: await deps.links.liveFor("account", id),
      stale: isStale(account, latest, now),
    };
  };
}
