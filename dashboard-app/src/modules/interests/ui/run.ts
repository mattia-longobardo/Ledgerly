import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/ports";
import { interestDeps } from "../infrastructure/deps";

export { interestDeps } from "../infrastructure/deps";

/**
 * Test seams for `runForPrincipal`, mirroring the expenses module's
 * `ui/run.ts`. Both are no-ops outside `NODE_ENV=test`, so production code
 * can never be redirected by a stray call.
 */
let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setInterestDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller, open a transaction carrying their identity so RLS
 * applies, and run a use case inside it. Every server component and action
 * that touches interests goes through here — the Interests use cases take a
 * flat deps bag and never open a context themselves, and the accruals
 * repository takes no `userId` at all, so this context is the only wall.
 */
export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(interestDeps(tx), principal));
}
