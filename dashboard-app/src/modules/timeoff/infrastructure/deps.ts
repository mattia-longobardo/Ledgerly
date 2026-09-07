import type { DbClient } from "@/lib/db/client";
import { hoursPerDay } from "@/lib/repo/settings";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { DrizzleBalancesRepository } from "./drizzle-balances-repository";
import { DrizzleEventsRepository } from "./drizzle-events-repository";
import { DrizzleTypesRepository } from "./drizzle-types-repository";

/**
 * Hours in a working day as the two-decimal string every quantity in this
 * module is. `app_settings` carries no RLS, so reading it on the pool-bound
 * client from inside somebody's transaction is safe and returns the same row.
 */
export async function hoursPerDayString(): Promise<string> {
  return (await hoursPerDay()).toFixed(2);
}

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction — the
 * flat shape `interestDeps` and `payrollDeps` follow. RLS context is opened
 * once by the caller.
 */
export function timeoffDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    types: new DrizzleTypesRepository(tx),
    balances: new DrizzleBalancesRepository(tx),
    events: new DrizzleEventsRepository(tx),
    settings: { hoursPerDay: hoursPerDayString },
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
