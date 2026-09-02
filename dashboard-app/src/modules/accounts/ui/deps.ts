import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { Principal } from "@/platform/auth/principal";
import { requirePrincipal } from "@/platform/auth/require-principal";
import { withUserContext } from "@/platform/db/context";
import type { UseCaseDeps } from "../application/deps";
import { DrizzleAccountsRepository } from "../infrastructure/drizzle-accounts-repository";
import { DrizzleProviderLinksRepository } from "../infrastructure/drizzle-provider-links-repository";

/** The production assembly of `UseCaseDeps`, bound to one transaction. */
export function accountDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    accounts: new DrizzleAccountsRepository(tx),
    links: new DrizzleProviderLinksRepository(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
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
  const principal = await requirePrincipal();
  return withUserContext(db, { userId: principal.userId }, (tx) => fn(accountDeps(tx), principal));
}
