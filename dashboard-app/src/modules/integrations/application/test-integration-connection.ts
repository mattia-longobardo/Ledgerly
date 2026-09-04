import { assertPermission, type Principal } from "@/platform/auth/principal";
import { redactCredentials } from "@/platform/integrations/redact-credentials";
import type { ProviderCode, TestResult } from "@/platform/integrations/types";
import { statusAfterTest } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import { ConnectionNotFoundError, UnknownProviderError } from "./errors";

/**
 * "Does this credential still work?", answered without changing anything but
 * the stamps. Read, call the provider with nothing open, write.
 */
export function testIntegrationConnection(deps: IntegrationDeps) {
  return async (principal: Principal, providerCode: ProviderCode): Promise<TestResult> => {
    assertPermission(principal, "integrations.manage");
    const provider = deps.registry.get(providerCode);
    if (!provider) throw new UnknownProviderError(`No integration named ${providerCode}`);

    const opened = await deps.inUserContext(principal.userId, async (d) => {
      const connection = await d.connections.getByProvider(principal.userId, providerCode);
      if (!connection) throw new ConnectionNotFoundError(`${providerCode} is not connected`);
      const sealed = await d.connections.readCredentials(principal.userId, connection.id);
      if (!sealed) throw new ConnectionNotFoundError(`${providerCode} has no stored credential`);
      return { connection, credentials: d.cipher.open(sealed) };
    });

    const result = await provider.testConnection(opened.credentials, opened.connection.settings);

    await deps.inUserContext(principal.userId, async (d) => {
      await d.connections.recordState(opened.connection.id, {
        status: statusAfterTest(result),
        lastTestAt: d.clock.now(),
        // `result.message` is the provider's own text — an HTTP client that
        // folds a URL or a header into its error message can put this
        // connection's own credential into it, and this is a column the
        // owner's Settings UI renders straight back to them.
        lastError: result.ok ? null : redactCredentials(result.message, opened.credentials),
      });
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.test",
        entityType: "integration_connection",
        entityId: opened.connection.id,
        after: { provider: providerCode, ok: result.ok },
      });
    });

    return result;
  };
}
