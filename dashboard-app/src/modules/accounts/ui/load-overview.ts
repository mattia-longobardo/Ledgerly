import { DEFAULT_TREND_MONTHS, listAccounts, type AccountListItem } from "../application/list-accounts";
import { netWorthSeries, type NetWorthSeries } from "../application/net-worth-series";
import { runForPrincipal } from "./deps";

export interface SourceFreshness {
  name: string;
  lastUpdated: Date | null;
  state: "fresh" | "stale" | "missing";
}

export interface OverviewData {
  netWorth: NetWorthSeries;
  accounts: AccountListItem[];
  sources: SourceFreshness[];
}

function newestCapture(items: readonly AccountListItem[]): Date | null {
  let newest: Date | null = null;
  for (const { latest } of items) {
    if (latest && (!newest || latest.capturedAt > newest)) newest = latest.capturedAt;
  }
  return newest;
}

/**
 * Where the figures came from and how much they can be trusted. Two rows, one
 * per way a balance can enter the system: the Wallet sync and the owner typing
 * it in. A row with nothing behind it says so rather than showing a zero.
 */
function sourceFreshness(accounts: readonly AccountListItem[]): SourceFreshness[] {
  const synced = accounts.filter((a) => a.account.origin === "synced");
  const manual = accounts.filter((a) => a.account.origin === "manual");
  const manualUpdated = newestCapture(manual);
  return [
    {
      name: "Budget Makers Wallet",
      lastUpdated: newestCapture(synced),
      state: synced.length === 0 ? "missing" : synced.some((a) => a.stale) ? "stale" : "fresh",
    },
    {
      name: "Manual entries",
      lastUpdated: manualUpdated,
      state: manualUpdated === null ? "missing" : "fresh",
    },
  ];
}

/** Everything the Home and Accounts overviews read, in one transaction. */
export async function loadOverview(months: number = DEFAULT_TREND_MONTHS): Promise<OverviewData> {
  return runForPrincipal(async (deps, principal) => {
    const netWorth = await netWorthSeries(deps)(principal, months);
    const accounts = await listAccounts(deps)(principal, { months });
    return { netWorth, accounts, sources: sourceFreshness(accounts) };
  });
}
