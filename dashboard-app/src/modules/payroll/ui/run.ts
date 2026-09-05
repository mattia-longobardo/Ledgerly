import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/ports";
import { payrollDeps } from "../infrastructure/deps";
import { resolveDocumentStore } from "../infrastructure/document-store-resolver";
import { resolveScanner } from "../infrastructure/scanner-resolver";

export { payrollDeps } from "../infrastructure/deps";

/**
 * Test seams, mirroring the interests and expenses modules' own `ui/run.ts`.
 * Both are no-ops outside `NODE_ENV=test`, so production code can never be
 * redirected by a stray call.
 */
let depsFactoryForTests: (() => UseCaseDeps) | null = null;
let principalForTests: Principal | null = null;

export function setPayrollDepsFactoryForTests(factory: (() => UseCaseDeps) | null): void {
  if (process.env.NODE_ENV !== "test") return;
  depsFactoryForTests = factory;
}

export function setPrincipalForTests(principal: Principal | null): void {
  if (process.env.NODE_ENV !== "test") return;
  principalForTests = principal;
}

/**
 * Resolve the caller, resolve the document store and the scanner **before** any
 * transaction opens (Ruling R4-8), then open one transaction carrying the
 * caller's identity so RLS applies, and run a use case inside it. Every server
 * component and action that touches payroll goes through here.
 *
 * Returns `null` from the callback's point of view is not an option: a
 * deployment with no store configured throws, and the pages catch that to
 * render their setup state rather than a stack trace.
 */
export class DocumentStoreUnavailableError extends Error {
  constructor() {
    super("No payroll document store is configured.");
    this.name = "DocumentStoreUnavailableError";
  }
}

export async function runForPrincipal<T>(
  fn: (deps: UseCaseDeps, principal: Principal) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "test" && depsFactoryForTests && principalForTests) {
    return fn(depsFactoryForTests(), principalForTests);
  }
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) throw new DocumentStoreUnavailableError();
  const opts = { documents: resolution.store, scanner: resolveScanner() };
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(payrollDeps(tx, opts), principal));
}
