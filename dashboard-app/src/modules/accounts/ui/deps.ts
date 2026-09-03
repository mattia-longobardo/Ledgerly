import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { requirePrincipal } from "@/platform/auth/require-principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/deps";
import { accountDeps } from "../infrastructure/deps";

export { accountDeps } from "../infrastructure/deps";

/**
 * Resolve the caller, open a transaction carrying their identity so RLS
 * applies, and run a use case inside it. Every server component and action
 * that touches accounts goes through here, so none of them has to remember
 * the order of those three steps.
 */
export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(accountDeps(tx), principal));
}
