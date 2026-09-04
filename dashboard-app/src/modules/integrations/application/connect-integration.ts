import { assertPermission, type Principal } from "@/platform/auth/principal";
import { redactCredentials } from "@/platform/integrations/redact-credentials";
import type {
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  TestResult,
} from "@/platform/integrations/types";
import { statusAfterTest } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import {
  ConnectionVersionMismatchError,
  CredentialValidationError,
  UnknownProviderError,
} from "./errors";

export interface ConnectIntegrationInput {
  provider: ProviderCode;
  credentials: Record<string, string>;
  settings?: Record<string, unknown>;
  disconnectPolicy?: DisconnectPolicy;
}

/**
 * Connecting is idempotent per (user, provider): there is one row per pair and
 * reconnecting replaces the credential on it rather than adding a second.
 *
 * A failed test does NOT abort the connect (Ruling P2-6). The credential is
 * still stored and the connection lands in `error` with the provider's own
 * message, because the common failure is a typo the person is about to fix —
 * losing what they typed would make them retype the whole secret.
 *
 * Three phases, and the middle one is the point: read what exists, call the
 * provider with NO transaction open, then write. A `testConnection` inside a
 * transaction would hold a pool connection for as long as the provider takes to
 * answer.
 */
export function connectIntegration(deps: IntegrationDeps) {
  return async (
    principal: Principal,
    input: ConnectIntegrationInput,
  ): Promise<{ connection: IntegrationConnection; test: TestResult }> => {
    assertPermission(principal, "integrations.manage");

    const provider = deps.registry.get(input.provider);
    if (!provider) throw new UnknownProviderError(`No integration named ${input.provider}`);

    const parsed = provider.credentialSchema.safeParse(input.credentials);
    if (!parsed.success) {
      throw new CredentialValidationError("Check the fields and try again.", parsed.error.issues);
    }

    const settings = input.settings ?? {};

    // ── 1. What is there now.
    const existing = await deps.inUserContext(principal.userId, (d) =>
      d.connections.getByProvider(principal.userId, input.provider),
    );

    // ── 2. The provider round trip, outside every transaction.
    const test = await provider.testConnection(parsed.data, settings);
    const status = statusAfterTest(test);
    // `test.message` is the provider's own text — an HTTP client that folds a
    // URL or a header into its error message can put this connection's own
    // credential into it, and this is a column the owner's Settings UI
    // renders straight back to them.
    const lastError = test.ok ? null : redactCredentials(test.message, parsed.data);

    // ── 3. One transaction for every write.
    const connection = await deps.inUserContext(principal.userId, async (d) => {
      const now = d.clock.now();
      let row = existing;

      if (row) {
        const updated = await d.connections.update(principal.userId, row.id, row.version, {
          settings,
          ...(input.disconnectPolicy ? { disconnectPolicy: input.disconnectPolicy } : {}),
        });
        // Ruling P2-C9. Swallowing this would store the new credential while
        // silently dropping the settings that were meant to go with it, and
        // hand back a connection object that disagrees with the database.
        if (updated === "version_mismatch") {
          throw new ConnectionVersionMismatchError(
            `${input.provider} was changed by somebody else; reload and try again`,
          );
        }
        if (updated === null) {
          // The row disappeared between the read and the write — a disconnect
          // that deleted it. Fall through and create a fresh one.
          row = null;
        } else {
          row = updated;
        }
      }

      if (!row) {
        row = await d.connections.create({
          userId: principal.userId,
          provider: input.provider,
          status,
          settings,
          disconnectPolicy: input.disconnectPolicy ?? "keep",
        });
      }

      await d.connections.writeCredentials(principal.userId, row.id, d.cipher.seal(parsed.data));
      await d.connections.recordState(row.id, {
        status,
        lastTestAt: now,
        lastError,
      });

      // Ruling P2-C4: a connection's schedulable work is its `sync_jobs` rows,
      // one per kind the adapter implements. `ensure` keeps whatever `enabled`
      // and `cursor` an existing row has, so reconnecting never silently
      // re-enables a kind somebody switched off.
      for (const [kind, handler] of Object.entries(provider.syncs)) {
        if (!handler) continue;
        await d.jobs.ensure({ connectionId: row.id, kind: kind as SyncKind, schedule: handler.schedule });
      }

      // The credential itself is never audited — only that one was written, and
      // under which key (spec §3.2 "credentials metadata").
      await d.audit({
        actorUserId: principal.userId,
        action: "integration.connect",
        entityType: "integration_connection",
        entityId: row.id,
        after: { provider: input.provider, status, keyId: d.cipher.activeKeyId, testOk: test.ok },
      });

      return (
        (await d.connections.get(principal.userId, row.id)) ?? {
          ...row,
          status,
          lastTestAt: now,
          lastError,
        }
      );
    });

    return { connection, test };
  };
}
