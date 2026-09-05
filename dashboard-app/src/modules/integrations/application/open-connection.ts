import type { IntegrationConnection, ProviderCode } from "@/platform/integrations/types";
import { isUsable } from "../domain/connection";
import type { IntegrationDeps } from "./deps";

export interface OpenedConnection {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
}

/**
 * "Is this provider connected, and what is its credential?" — asked in one
 * place instead of four.
 *
 * Both jobs, the Trek server actions and the Work page need exactly this, and
 * each of them spelling it out separately is how one of them ends up checking
 * `status !== "disconnected"` and syncing through a broken credential. `null`
 * covers all three not-usable cases — no connection, not `connected`, no stored
 * credential — because every caller treats them identically: the integration is
 * off, which is a state to report, not an error to raise.
 */
export function openConnection(deps: IntegrationDeps) {
  return async (userId: string, provider: ProviderCode): Promise<OpenedConnection | null> =>
    deps.inUserContext(userId, async (d) => {
      const connection = await d.connections.getByProvider(userId, provider);
      if (!connection || !isUsable(connection)) return null;
      const sealed = await d.connections.readCredentials(userId, connection.id);
      if (!sealed) return null;
      return { connection, credentials: d.cipher.open(sealed) };
    });
}
