import { db } from "@/lib/db";
import { ownerUserId } from "@/platform/auth/owner";
import type { ProviderCode } from "@/platform/integrations/types";
import {
  openConnection,
  type OpenedConnection,
} from "@/modules/integrations/application/open-connection";
import { integrationDeps } from "./deps";

export interface OwnerConnection extends OpenedConnection {
  userId: string;
}

/**
 * The household owner's connection for a provider, with its credential open.
 *
 * The three scheduled jobs all begin the same way — find the owner, find their
 * connection, check it is usable, open the credential — and this is that
 * sequence, once. `null` means "this integration is not set up", which every
 * caller records as a skipped run rather than a failure.
 *
 * Still owner-only because the cron tiers are process-wide: per-user schedules
 * arrive when `sync_jobs` becomes dispatchable in a later phase.
 */
export async function openOwnerConnection(provider: ProviderCode): Promise<OwnerConnection | null> {
  const userId = await ownerUserId(db);
  if (!userId) return null;
  const opened = await openConnection(integrationDeps(db))(userId, provider);
  return opened ? { userId, ...opened } : null;
}
