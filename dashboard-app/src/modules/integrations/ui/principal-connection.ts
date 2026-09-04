import { db } from "@/lib/db";
import type { ProviderCode } from "@/platform/integrations/types";
import {
  openConnection,
  type OpenedConnection,
} from "@/modules/integrations/application/open-connection";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";

/**
 * The signed-in user's connection for a provider, with its credential open, or
 * null when they have not connected it. Every caller treats null as "the
 * integration is off" rather than an error — the same contract the deleted
 * `trekConfig()` had.
 *
 * `require-principal` is imported dynamically, exactly as
 * `modules/accounts/ui/run.ts` does it: a static import drags in `@/auth` and
 * through it `next/server`, which vitest's unit environment cannot resolve, and
 * would make every unit test of a caller unrunnable.
 */
export async function openPrincipalConnection(provider: ProviderCode): Promise<OpenedConnection | null> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return openConnection(integrationDeps(db))(principal.userId, provider);
}

/** "Is this provider set up for me?" — for a page that must not decrypt anything to render. */
export async function isProviderConnectedForPrincipal(provider: ProviderCode): Promise<boolean> {
  const { requirePrincipal } = await import("@/platform/auth/require-principal");
  const principal = await requirePrincipal();
  return integrationDeps(db).inUserContext(principal.userId, async (d) => {
    const connection = await d.connections.getByProvider(principal.userId, provider);
    return connection?.status === "connected";
  });
}
