import { createHash } from "node:crypto";
import type { IntegrationConnection } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { enqueueSync } from "./enqueue-sync";
import { SyncDisabledError } from "./errors";

/**
 * Why this delivery ended the way it did. `duplicate` and `accepted` are both
 * 202s — a provider retrying a delivery it never got an answer for must not be
 * told "error" (Ruling R9-6) — but only `accepted` queued anything.
 */
export type WebhookOutcomeStatus = "accepted" | "duplicate" | "rate_limited" | "rejected";

export interface WebhookOutcome {
  status: WebhookOutcomeStatus;
  /** 202-worthy: a fresh delivery, or an idempotent replay of one. */
  accepted: boolean;
  connectionId: string | null;
  /** The `sync_runs` rows this delivery queued. Empty on a rejection or a replay. */
  runIds: string[];
}

/**
 * Per-connection inbound cap (Ruling R9-6). Generous next to any real provider
 * — Wallet and Trek send single-digit deliveries a minute.
 *
 * It bounds a *signed* sender only. `consumeWindow` runs after the signature
 * has resolved a connection, so an unsigned caller never reaches it and this
 * cap can do nothing about the candidate scan, the AES-GCM decrypt or the HMAC
 * per candidate that such a caller costs. Those are bounded by the 1 MB body
 * cap and the flat `404` in `src/modules/integrations/api/routes.ts`, which
 * says the same thing from the other side. What this cap buys is that somebody
 * who *does* hold a valid secret cannot keep one connection's enqueue path
 * running flat out.
 */
export const INBOUND_LIMIT_PER_MINUTE = 60;

/**
 * How far back a repeat of the same signed body still counts as a replay
 * (Ruling R9-6, narrowed by Ruling P9-7).
 *
 * Ten minutes, not the 24 h this first shipped with. The window exists for one
 * thing: a provider retrying a delivery whose response it never saw, which
 * happens in seconds. A day-long window is a different, worse promise, because
 * a provider body need carry no event identity at all — Wallet sends
 * `{"event":"accounts.changed"}`, hashed on the raw body alone — so every
 * delivery of the day hashes identically and only the first one syncs.
 */
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * The `event` a duplicate's own `webhook_deliveries` row carries, and the one
 * value `findAccepted` refuses to treat as the original. Reserved: no adapter
 * may emit it as a sync-request event name (they are all dotted, like
 * `accounts.changed`), because a delivery recorded under it can never anchor a
 * replay window.
 */
export const DUPLICATE_EVENT = "duplicate";

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
 *
 * Two guards sit between the signature and the enqueue (Ruling R9-6): a
 * per-connection cap of 60 deliveries a minute, and replay protection — the
 * same `(connection_id, payload_hash)` accepted in the last 10 minutes is
 * acknowledged with the same 202 and queues nothing (Rulings P9-5, P9-7). The
 * replay guard is what makes a provider's own retry after a timed-out response
 * safe: without it, an answer lost on the wire turns one event into two syncs.
 * Both guards are keyed per connection, so one person's traffic can neither
 * throttle nor swallow another's.
 *
 * The window is anchored on the delivery that actually *queued* something, and
 * never on a duplicate: a duplicate's own row is recorded under the reserved
 * `duplicate` event and `findAccepted` skips it (Ruling P9-7). Otherwise each
 * duplicate would push the window forward by its own arrival time, and a
 * provider whose bodies carry no event identity would sync exactly once, ever.
 */
export function handleWebhook(deps: IntegrationDeps) {
  return async (input: {
    provider: string;
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookOutcome> => {
    const rejected: WebhookOutcome = { status: "rejected", accepted: false, connectionId: null, runIds: [] };
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
        let secret: string;
        try {
          secret = d.cipher.open(sealed).webhookSecret ?? "";
        } catch {
          // `cipher.open` throws `CredentialCryptoError` for a blob whose
          // `keyId` has since rotated out of `APP_ENCRYPTION_KEY`, or one that
          // is simply malformed. One connection's stale credential must not
          // deny delivery to every other connected user of this provider —
          // skip it and keep looking, the same as `!secret`/no-match below.
          continue;
        }
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

      // Rate limit and replay check in that order, and both AFTER the signature
      // has resolved a connection: neither may be an oracle telling an
      // unauthenticated caller whether a body was ever accepted, or which
      // connection would receive it.
      //
      // Neither branch throws. Everything here runs inside the system context's
      // transaction, and throwing would roll back the very counter row and
      // delivery row that are the point — the limiter would never trip. The
      // route turns the returned status into the response code.
      const window = await d.consumeWindow(matched.id, INBOUND_LIMIT_PER_MINUTE, receivedAt);
      if (window.exceeded) {
        await d.deliveries.record({
          connectionId: matched.id,
          provider: code,
          event: "rate_limited",
          payloadHash,
          status: "rejected",
          error: `More than ${INBOUND_LIMIT_PER_MINUTE} deliveries in one minute`,
          receivedAt,
        });
        return { status: "rate_limited", accepted: false, connectionId: matched.id, runIds: [] };
      }

      // Keyed on the matched CONNECTION, not the provider (Ruling P9-5): a
      // payload need carry nothing user-specific, so two people connected to
      // the same provider routinely send byte-identical bodies, and a
      // provider-wide key would drop the second one's sync behind a 202.
      const earlier = await d.deliveries.findAccepted(
        matched.id,
        payloadHash,
        new Date(receivedAt.getTime() - REPLAY_WINDOW_MS),
      );
      if (earlier) {
        // Recorded, not silent: a retry storm is something an operator should
        // be able to see, and the 60/min cap above bounds how many rows it can
        // add. `status: "accepted"` because the delivery WAS answered 202 (and
        // the column's CHECK has no third value for it), but under the
        // reserved `duplicate` event, which `findAccepted` skips: a duplicate
        // must never become the anchor a later copy is measured against, or
        // the window would renew itself forever (Ruling P9-7).
        await d.deliveries.record({
          connectionId: matched.id,
          provider: code,
          event: DUPLICATE_EVENT,
          payloadHash,
          status: "accepted",
          error: null,
          receivedAt,
        });
        return { status: "duplicate", accepted: true, connectionId: matched.id, runIds: [] };
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
        return { status: "rejected", accepted: false, connectionId: matched.id, runIds: [] };
      }

      const requests = webhook.toSyncRequests(payload);
      const runIds: string[] = [];
      try {
        for (const request of requests) {
          const run = await enqueueSync(d)(matched, request.kind, "webhook");
          runIds.push(run.id);
        }
      } catch (err) {
        // Only `SyncDisabledError` — the connection's `sync_jobs` row for
        // this kind has been switched off — is a verified-but-refused
        // delivery worth recording and answering with the flat rejection.
        // Anything else (a DB error, a constraint violation) is a genuine
        // infrastructure failure: it must surface as a 500 that alerts
        // operators, not get silently filed away as a routine rejection.
        if (!(err instanceof SyncDisabledError)) throw err;
        await d.deliveries.record({
          connectionId: matched.id,
          provider: code,
          event: requests[0]?.event ?? "unknown",
          payloadHash,
          status: "rejected",
          error: `Could not queue sync: ${err.message}`,
          receivedAt,
        });
        return { status: "rejected", accepted: false, connectionId: matched.id, runIds: [] };
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
      return { status: "accepted", accepted: true, connectionId: matched.id, runIds };
    });
  };
}
