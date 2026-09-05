import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { ensureProvidersRegistered } from "@/platform/integrations/register-all";
import type { IntegrationDeps } from "../application/deps";
import { integrationDeps } from "../infrastructure/deps";

export { integrationDeps } from "../infrastructure/deps";

/**
 * Test seams for `runIntegrationsForPrincipal`. Both are no-ops outside
 * `NODE_ENV=test`, so production code can never be redirected by a stray call.
 *
 * Kept in this module, not next to the deps, so a unit test can set them
 * without ever importing `require-principal` (which drags in `@/auth` and,
 * through it, `next/server` — an import graph vitest's unit environment cannot
 * resolve). The function below only reaches for that import dynamically, and
 * only when no test principal is set.
 */
let depsFactoryForTests: (() => IntegrationDeps) | null = null;
let principalForTests: Principal | null = null;

export function setIntegrationDepsFactoryForTests(factory: (() => IntegrationDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setIntegrationPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller and run a use case with pool-bound deps.
 *
 * Unlike the accounts module's twin, this does NOT open a transaction: an
 * integration use case opens its own (Global Constraints), because it has to
 * talk to a provider between them.
 */
export async function runIntegrationsForPrincipal<T>(
  fn: (deps: IntegrationDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  ensureProvidersRegistered();
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return fn(integrationDeps(db), principal);
}
