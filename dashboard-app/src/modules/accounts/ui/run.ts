import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/deps";
import { accountDeps } from "../infrastructure/deps";

export { accountDeps } from "../infrastructure/deps";

/**
 * Test seams for `runForPrincipal`. Both are no-ops outside `NODE_ENV=test`, so
 * production code can never be redirected by a stray call.
 *
 * Kept in this module, not `ui/deps.ts`, so a unit test can set them without
 * ever importing `require-principal` (which drags in `@/auth` and, through it,
 * `next/server` — an import graph vitest's unit environment cannot resolve).
 * `runForPrincipal` below only reaches for that import dynamically, and only
 * when no test principal is set, so setting both seams keeps a test off that
 * path entirely.
 */
let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setAccountDepsFactoryForTests(
  factory: (() => UseCaseDeps) | null,
): void {
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
 * that touches accounts goes through here, so none of them has to remember
 * the order of those three steps.
 */
export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  if (
    process.env.NODE_ENV === "test" &&
    depsFactoryForTests &&
    principalForTests
  ) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } =
    await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) =>
    fn(accountDeps(tx), principal),
  );
}
