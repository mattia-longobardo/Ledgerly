/**
 * Trek's Vacay leave planner as an `IntegrationProvider`.
 *
 * The only new file that knows Trek exists. `testConnection` deliberately calls
 * `getEntries` and not `getStats`: the stats tool PERSISTS carry-over as a side
 * effect upstream, and a connection test must not write to the provider.
 */

import { z } from "zod";
import { errorMessage } from "@/lib/clients/http";
import { getEntries } from "@/lib/clients/trek";
import { db } from "@/lib/db";
import { drizzleTimeoffStore } from "@/modules/timeoff/infrastructure/trek-store";
import { runTrekSync, type TrekSyncResult } from "@/modules/timeoff/infrastructure/trek-sync";
import type {
  DisconnectContext,
  IntegrationProvider,
  SyncApplyContext,
  SyncFetchContext,
  SyncHandler,
  SyncRequest,
  TestResult,
} from "@/platform/integrations/types";
import { hmacSignatureVerifier, webhookEventName } from "@/platform/integrations/webhook-signature";

const TREK_PROVIDER = "trek" as const;

const credentialSchema = z.object({
  baseUrl: z.url(),
  token: z.string().min(1),
  webhookSecret: z.string().optional().default(""),
});

function configOf(credentials: Record<string, string>) {
  return { baseUrl: credentials.baseUrl!.replace(/\/+$/, ""), token: credentials.token! };
}

async function testConnection(credentials: Record<string, string>): Promise<TestResult> {
  try {
    const year = new Date().getFullYear();
    const entries = await getEntries(year, { config: configOf(credentials), attempts: 1 });
    return { ok: true, message: `Reached Trek and read ${entries.length} leave day(s) for ${year}.` };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * The leave sync.
 *
 * All of the work is in `fetch`, which looks odd until you read `trek-sync.ts`:
 * a pass is a read → diff → toggle conversation that takes its OWN advisory
 * lock on its OWN database connection, and it must not run inside somebody
 * else's transaction. Putting it in `fetch` — the phase the engine runs with
 * nothing open — is what keeps that true. `apply` reads the counts off the
 * result and never touches `ctx.db`.
 *
 * Trek's pass is a full-year reconciliation with nothing to carry forward, so
 * there is no cursor.
 */
const leaveSync: SyncHandler<TrekSyncResult> = {
  schedule: "hourly",

  fetch: (ctx: SyncFetchContext) =>
    runTrekSync({
      now: ctx.clock.now(),
      call: { config: configOf(ctx.credentials) },
      // The connection's owner, not the caller: an hourly pass runs with no
      // principal, and every database step inside the sync is scoped to this.
      userId: ctx.connection.userId,
      // `db`, not `ctx.db`: `fetch` runs with nothing open, and the store's job
      // is precisely to open one short context per database step of its own.
      store: drizzleTimeoffStore(db),
    }),

  async apply(_ctx: SyncApplyContext, result: TrekSyncResult): Promise<Record<string, number>> {
    if (result.status === "failed" || result.status === "partial") {
      // A partial pass means a local edit has not reached Trek. Recording it as
      // a success would let the last-sync stamp stay green while the two
      // calendars drift apart, so the engine is told it failed.
      throw new Error(result.errors.join("; ") || "Trek sync did not complete");
    }
    return { pulled: result.pulled, deleted: result.deleted, pushed: result.pushed };
  },
};

/**
 * Time off is the user's own record of their year, not the provider's:
 * `timeoff_events` is written by the dashboard as much as by the sync. No
 * policy deletes them, so this is a no-op beyond the audit line — a
 * disconnected Trek leaves the calendar exactly as the owner left it.
 */
async function onDisconnect(ctx: DisconnectContext): Promise<void> {
  await ctx.audit({
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: TREK_PROVIDER, policy: ctx.policy, timeoffEventsKept: true },
  });
}

export const trekProvider: IntegrationProvider = {
  code: TREK_PROVIDER,
  label: "Trek",
  capabilities: ["leave"],
  credentialSchema,
  credentialFields: [
    { name: "baseUrl", label: "Trek URL", secret: false, placeholder: "https://trek.example.com" },
    { name: "token", label: "MCP token", secret: true, placeholder: "trek_…" },
    { name: "webhookSecret", label: "Webhook secret", secret: true, placeholder: "Optional" },
  ],
  testConnection: (credentials) => testConnection(credentials),
  syncs: { leave: leaveSync },
  webhook: {
    // Both shared with the Wallet adapter, which is where they were duplicated
    // character-for-character: see `src/platform/integrations/webhook-signature.ts`.
    verify: hmacSignatureVerifier(),
    toSyncRequests: (payload): SyncRequest[] => [{ kind: "leave", event: webhookEventName(payload) }],
  },
  onDisconnect,
};
