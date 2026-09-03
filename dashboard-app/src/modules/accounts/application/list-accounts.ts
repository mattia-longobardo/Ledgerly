import type { MonthPoint } from "@/lib/contracts";
import { addMonths, monthKey, monthRange } from "@/lib/time";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { Account, BalancePoint } from "../domain/account";
import { monthlySeries } from "../domain/net-worth";
import type { UseCaseDeps } from "./deps";

export const DEFAULT_TREND_MONTHS = 13;

/** How old a synced figure may be before the UI stops trusting it. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * A synced account whose last capture has aged out — or that never captured
 * anything — is stale. A manual account never is: its owner types the figure,
 * so there is no sync to fall behind.
 */
export function isStale(account: Account, latest: BalancePoint | null, now: Date): boolean {
  if (account.origin !== "synced") return false;
  if (!latest) return true;
  return now.getTime() - latest.capturedAt.getTime() > STALE_AFTER_MS;
}

/** The inclusive month keys a trend of `months` points ends on today. Always at least the current month. */
export function trendMonths(now: Date, months: number): string[] {
  const span = Math.max(1, Math.trunc(months));
  const end = monthKey(now);
  return monthRange(addMonths(end, -(span - 1)), end);
}

export interface AccountListItem {
  account: Account;
  latest: BalancePoint | null;
  trend: MonthPoint[];
  stale: boolean;
}

export function listAccounts(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    opts?: { months?: number; includeArchived?: boolean },
  ): Promise<AccountListItem[]> => {
    assertPermission(principal, "accounts.read");
    const now = deps.clock.now();
    const months = trendMonths(now, opts?.months ?? DEFAULT_TREND_MONTHS);
    const accounts = await deps.accounts.list(principal.userId, { includeArchived: opts?.includeArchived });
    const accountIds = accounts.map((a) => a.id);
    const latestBalances = await deps.accounts.latestBalances(principal.userId);
    const history = await deps.accounts.history(principal.userId, accountIds, months[0]!);
    // The last balance from before the window, so an account nobody has touched
    // in a while shows its known figure across the trend instead of a flat gap.
    const seeds = await deps.accounts.latestBalancesBefore(principal.userId, accountIds, months[0]!);
    return accounts.map((account) => {
      const latest = latestBalances.get(account.id) ?? null;
      return {
        account,
        latest,
        trend: monthlySeries(
          history.filter((p) => p.accountId === account.id),
          months,
          seeds.get(account.id) ?? null,
        ),
        stale: isStale(account, latest, now),
      };
    });
  };
}
