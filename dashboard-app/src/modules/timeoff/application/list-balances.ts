import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TimeoffBalance, UseCaseDeps } from "./ports";

/**
 * Every balance row whose `as_of` falls in the year, oldest first — the
 * history behind the single figure `getWorkspace` shows, one row per payslip
 * applied. Never summed: `used` is cumulative on the payslip it came from (see
 * the comment in `get-workspace.ts`), so the series is reported as it stands.
 */
export function listBalances(deps: UseCaseDeps) {
  return async (principal: Principal, year: number): Promise<TimeoffBalance[]> => {
    assertPermission(principal, "timeoff.read");
    return deps.balances.listForYear(principal.userId, year);
  };
}
