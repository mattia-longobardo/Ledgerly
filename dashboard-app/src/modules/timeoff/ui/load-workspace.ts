import { getCachedTrekStats } from "@/lib/repo/trek-state";
import { isProviderConnectedForPrincipal } from "@/modules/integrations/ui/principal-connection";
import { getWorkspace, type TimeoffWorkspace } from "../application/get-workspace";
import { addQuantity } from "../domain/units";
import type { TimeoffEvent } from "../application/ports";
import { runForPrincipal } from "./run";

export interface LoadWorkspaceInput {
  year: number;
  /** The day whose detail the page is editing, from `?day=`. */
  selectedDate?: string | null;
}

/**
 * The Time Off page's one read.
 *
 * `trekConnected` and `cachedStats` are resolved BEFORE `runForPrincipal`
 * opens its transaction: `isProviderConnectedForPrincipal` opens a context of
 * its own, and the shared conventions forbid nesting them.
 */
export async function loadWorkspace(input: LoadWorkspaceInput): Promise<TimeoffWorkspace> {
  const [trekConnected, cachedStats] = await Promise.all([
    isProviderConnectedForPrincipal("trek"),
    getCachedTrekStats(input.year),
  ]);
  return runForPrincipal((deps, principal) =>
    getWorkspace(deps)(principal, {
      year: input.year,
      selectedDate: input.selectedDate ?? null,
      trekConnected,
      cachedStats,
    }),
  );
}

export interface TimeoffSummary {
  /**
   * Every type's remaining balance added together, in days — `null` when
   * nothing has ever written a balance, which the card renders as "—". Never
   * `"0.00"`: an absent payslip is not a zero balance.
   */
  remainingDays: string | null;
  upcoming: TimeoffEvent[];
  pendingCount: number;
}

/**
 * The three figures the Home `leave` card and any other consumer needs, from
 * the same workspace read the page itself uses — so the card and the page can
 * never disagree about a balance.
 *
 * Trek state is not consulted: neither figure depends on it, and asking would
 * cost a connection read on every Home render.
 */
export async function loadTimeoffSummary(year?: number): Promise<TimeoffSummary> {
  const workspace = await runForPrincipal((deps, principal) =>
    getWorkspace(deps)(principal, {
      year: year ?? new Date().getFullYear(),
      selectedDate: null,
      trekConnected: false,
      cachedStats: null,
    }),
  );
  return {
    remainingDays: workspace.balances.reduce<string | null>(
      (total, balance) => addQuantity(total, balance.remainingDays),
      null,
    ),
    upcoming: workspace.upcoming,
    pendingCount: workspace.pendingCount,
  };
}
