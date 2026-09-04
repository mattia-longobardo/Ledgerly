import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { DisconnectPolicy, ProviderCode } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { ConnectionNotFoundError, UnknownProviderError } from "./errors";

/**
 * Spec §5.2: what happens to the data the provider left behind is the
 * connection's `disconnect_policy`, and a caller may override it once. The
 * credential is destroyed in every case (spec §8.4: "purges credentials
 * immediately"); only the domain data differs, and only the provider's own
 * adapter knows what that data is — which is why the work happens in
 * `onDisconnect` rather than here.
 *
 * All of it is one transaction, deliberately: `onDisconnect` archives or
 * deletes accounts, and that must not be half-applied if destroying the
 * credential fails. `onDisconnect` is the one provider hook that does no
 * network I/O — it operates on local data the provider owned — so holding a
 * transaction across it is safe.
 */
export function disconnectIntegration(deps: IntegrationDeps) {
  return async (
    principal: Principal,
    providerCode: ProviderCode,
    policy?: DisconnectPolicy,
  ): Promise<{ policy: DisconnectPolicy }> => {
    assertPermission(principal, "integrations.manage");
    const provider = deps.registry.get(providerCode);
    if (!provider) throw new UnknownProviderError(`No integration named ${providerCode}`);

    return deps.inUserContext(principal.userId, async (d) => {
      const connection = await d.connections.getByProvider(principal.userId, providerCode);
      if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);

      const effective = policy ?? connection.disconnectPolicy;

      await provider.onDisconnect({
        connection,
        policy: effective,
        db: d.db,
        clock: d.clock,
        audit: d.audit,
      });

      await d.connections.writeCredentials(principal.userId, connection.id, null);
      await d.connections.recordState(connection.id, { status: "disconnected", lastError: null });
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.disconnect",
        entityType: "integration_connection",
        entityId: connection.id,
        after: { provider: providerCode, policy: effective },
      });

      return { policy: effective };
    });
  };
}
