import { createHash } from "node:crypto";
import type { IntegrationConnection } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { enqueueSync } from "./enqueue-sync";

export interface WebhookOutcome {
  accepted: boolean;
  connectionId: string | null;
  /** The `sync_runs` rows this delivery queued. Empty on a rejection. */
  runIds: string[];
}

/**
 * Spec §3.4: an inbound webhook validates its signature and **enqueues** the
 * sync work rather than doing it inline (Ruling P2-C3). Nothing here calls a
 * provider or writes a user's domain data; the hourly `sync_queue` job claims
 * the queued rows and runs each one in its connection owner's user context.
 *
 * Everything below runs in the SYSTEM context, because a webhook has no
 * principal: it must be able to look across users to find whose secret signs
 * this body. That is also precisely why the sync itself cannot run here — it
 * would write every row with RLS bypassed and attribute every audit line to
 * the system rather than to the person.
 *
 * The path names only the provider, so the receiving connection is discovered
 * by trying each connected one's own webhook secret. That is O(connections),
 * which is one or two here, and it keeps the secret per connection rather than
 * making one deployment-wide secret speak for every user.
 *
 * Nothing in the payload is trusted beyond the event name, and the payload is
 * decoded only AFTER the signature verifies, so an unsigned body never reaches
 * `JSON.parse`.
 */
export function handleWebhook(deps: IntegrationDeps) {
  return async (input: {
    provider: string;
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookOutcome> => {
    const rejected: WebhookOutcome = { accepted: false, connectionId: null, runIds: [] };
    const provider = deps.registry.get(input.provider);
    if (!provider?.webhook) return rejected;

    const webhook = provider.webhook;
    const code = provider.code;
    const payloadHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");

    return deps.inSystemContext(async (d) => {
      const receivedAt = d.clock.now();

      let matched: IntegrationConnection | null = null;
      for (const connection of await d.connections.candidatesForWebhook(code)) {
        const sealed = await d.connections.readCredentials(connection.userId, connection.id);
        if (!sealed) continue;
        const secret = d.cipher.open(sealed).webhookSecret ?? "";
        if (!secret) continue;
        if (!webhook.verify({ rawBody: input.rawBody, headers: input.headers }, secret)) continue;
        matched = connection;
        break;
      }

      if (!matched) {
        await d.deliveries.record({
          connectionId: null,
          provider: code,
          event: "unverified",
          payloadHash,
          status: "rejected",
          error: "No connected connection verified this signature",
          receivedAt,
        });
        return rejected;
      }

      // A body that verified but is not JSON is a REAL problem — somebody
      // holding the right secret is sending something this adapter cannot
      // read — so it is recorded with its reason and refused, not quietly
      // turned into an `unknown` event that queues a sync anyway.
      let payload: unknown;
      try {
        payload = JSON.parse(input.rawBody);
      } catch (err) {
        await d.deliveries.record({
          connectionId: matched.id,
          provider: code,
          event: "malformed_json",
          payloadHash,
          status: "rejected",
          error: `Signed body was not JSON: ${err instanceof Error ? err.message : String(err)}`,
          receivedAt,
        });
        return { accepted: false, connectionId: matched.id, runIds: [] };
      }

      const requests = webhook.toSyncRequests(payload);
      const runIds: string[] = [];
      for (const request of requests) {
        const run = await enqueueSync(d)(matched, request.kind, "webhook");
        runIds.push(run.id);
      }

      await d.deliveries.record({
        connectionId: matched.id,
        provider: code,
        event: requests[0]?.event ?? "unknown",
        payloadHash,
        status: "accepted",
        error: null,
        receivedAt,
      });
      return { accepted: true, connectionId: matched.id, runIds };
    });
  };
}
