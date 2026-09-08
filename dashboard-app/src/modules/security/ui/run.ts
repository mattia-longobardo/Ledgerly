import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/ports";
import { securityDeps } from "../infrastructure/deps";

export { securityDeps } from "../infrastructure/deps";

/** Test seams, mirroring `src/modules/interests/ui/run.ts`. No-ops outside `NODE_ENV=test`. */
let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setSecurityDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller, open a transaction carrying their identity so RLS
 * applies, and run a use case inside it.
 *
 * `requirePrincipal` is the cookie path and the only path: a server action is
 * never reached with a Bearer header, so everything routed through here is
 * session-authenticated by construction (Ruling P8-2 — a token must not mint
 * or revoke tokens).
 */
export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(securityDeps(tx), principal));
}
