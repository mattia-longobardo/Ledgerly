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

/** The Time Off page's one read. */
export async function loadWorkspace(input: LoadWorkspaceInput): Promise<TimeoffWorkspace> {
  // Resolved BEFORE `runForPrincipal` opens its transaction:
  // `isProviderConnectedForPrincipal` opens a context of its own, and the
  // shared conventions forbid nesting them.
  const trekConnected = await isProviderConnectedForPrincipal("trek");
  return runForPrincipal(async (deps, principal) => {
    // Inside the callback, because the cache is keyed by the calendar's owner
    // and this is where the principal is. `app_settings` carries no RLS, so
    // reading it on the pool-bound client from inside an open transaction is
    // safe and returns the same row — the same reasoning `hoursPerDayString`
    // in `infrastructure/deps.ts` already relies on.
    const cachedStats = await getCachedTrekStats(principal.userId, input.year);
    return getWorkspace(deps)(principal, {
      year: input.year,
      selectedDate: input.selectedDate ?? null,
      trekConnected,
      cachedStats,
    });
  });
}

export interface TimeoffSummary {
  /**
   * The remaining balance of every type that HAS one, added together, in days
   * — `null` when no type has one, which a card renders as "—". Never
   * `"0.00"`: an absent payslip is not a zero balance.
   *
   * Read it with `remainingByType`, never on its own. A payslip states
   * `vacation` and `permits` but typically never `comp`, so this figure covers
   * some of the types, not all of them, and a caller that labels it "across
   * every type" reports a partial sum as a total. `remainingByType` names
   * exactly the types behind it so the label can say what was actually added.
   */
  remainingDays: string | null;
  /**
   * The types `remainingDays` is the sum of and what each contributes, in
   * `TIMEOFF_CODE_ORDER`. Empty exactly when `remainingDays` is `null`. A
   * caller shows the pairs, or names them beside the sum — never the sum
   * alone under a label that claims every type.
   */
  remainingByType: { label: string; days: string }[];
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
  const contributing = workspace.balances.filter((balance) => balance.remainingDays !== null);
  return {
    remainingDays: contributing.reduce<string | null>(
      (total, balance) => addQuantity(total, balance.remainingDays),
      null,
    ),
    remainingByType: contributing.map((balance) => ({
      label: balance.type.label,
      days: balance.remainingDays!,
    })),
    upcoming: workspace.upcoming,
    pendingCount: workspace.pendingCount,
  };
}
