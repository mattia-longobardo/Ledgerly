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
 * credential fails.
 *
 * The real invariant, precisely: no provider's `onDisconnect` may do network
 * I/O *while this transaction is open*. Most providers satisfy that trivially
 * because they only ever touch local data they already own. `payroll_silo` is
 * the one exception on paper — its `purge` branch (`silo-provider-adapter.ts`)
 * lists and deletes objects in the document store over HTTP — but it is inert
 * today: nothing currently populates `ctx.store`, a deliberately parked gap
 * (PH4-C4). Unparking it must not mean simply filling in `ctx.store` here —
 * the store has to be resolved and the purge performed by the *caller*,
 * before `inUserContext` opens, mirroring Ruling R4-8's pattern for keeping
 * that I/O out of the use-case transaction — the same pattern
 * `document-store-resolver.ts`'s `resolveDocumentStore` already follows by
 * being called before any `inUserContext`/`withUserContext` transaction
 * opens, never from inside one. Whoever unparks PH4-C4 should not trust an
 * older wording of this comment claiming no provider ever does network I/O
 * here, and should not nest the purge inside this transaction.
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
