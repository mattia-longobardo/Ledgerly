import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TimeoffCode, TimeoffType, TypesRepository, UseCaseDeps } from "./ports";

/**
 * R7-1: the three types every user gets, created lazily the first time
 * anything in this module touches their data. `hours_per_day` comes from the
 * app setting, so the divisor the workspace converts with is the one the owner
 * configured — not a constant buried in a page.
 *
 * `sick` and `other` are admitted by the CHECK but not seeded (Phase 7 scope
 * cut); they can be added through the API.
 */
export const DEFAULT_TIMEOFF_TYPES: readonly {
  code: TimeoffCode;
  label: string;
  unit: "hours" | "days";
}[] = [
  { code: "vacation", label: "Ferie", unit: "hours" },
  { code: "permits", label: "ROL / permessi", unit: "hours" },
  { code: "comp", label: "Recupero", unit: "hours" },
];

/**
 * Creates whichever default types this user is missing and returns the full
 * list. Idempotent: a second call creates nothing.
 *
 * Lives beside the use case rather than inside it because the payroll balance
 * sink needs exactly this and must not depend on a `Principal` — an apply runs
 * for a user whose types may never have been touched.
 */
export async function seedDefaultTypes(
  types: TypesRepository,
  userId: string,
  hoursPerDay: string,
): Promise<TimeoffType[]> {
  for (const wanted of DEFAULT_TIMEOFF_TYPES) {
    if (await types.getByCode(userId, wanted.code)) continue;
    await types.create({
      userId,
      code: wanted.code,
      label: wanted.label,
      unit: wanted.unit,
      hoursPerDay,
    });
  }
  return types.list(userId);
}

/**
 * R7-1 as a use case: every other use case in this module opens with it, so a
 * user who has never touched Time Off still gets a workspace with three types
 * instead of an empty page.
 */
export function ensureDefaultTypes(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TimeoffType[]> => {
    assertPermission(principal, "timeoff.read");
    return seedDefaultTypes(deps.types, principal.userId, await deps.settings.hoursPerDay());
  };
}
