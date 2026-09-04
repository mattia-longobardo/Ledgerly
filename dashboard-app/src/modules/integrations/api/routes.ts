import { createRoute } from "@hono/zod-openapi";
import { UpstreamError } from "@/lib/contracts";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { providerRegistry } from "@/platform/integrations/registry";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncRun,
} from "@/platform/integrations/types";
import { connectIntegration } from "@/modules/integrations/application/connect-integration";
import { disconnectIntegration } from "@/modules/integrations/application/disconnect-integration";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  SyncDisabledError,
  SyncNotSupportedError,
  UnknownProviderError,
} from "@/modules/integrations/application/errors";
import { handleWebhook } from "@/modules/integrations/application/handle-webhook";
import { listIntegrations, type IntegrationSummary } from "@/modules/integrations/application/list-integrations";
import { runSync } from "@/modules/integrations/application/run-sync";
import { testIntegrationConnection } from "@/modules/integrations/application/test-integration-connection";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  ConnectRequestSchema,
  ConnectResponseSchema,
  DisconnectRequestSchema,
  DisconnectResponseSchema,
  IntegrationListResponseSchema,
  ProviderParamSchema,
  SyncRequestBodySchema,
  SyncResponseSchema,
  SyncRunsPageSchema,
  SyncRunsQuerySchema,
  TestResultSchema,
  WebhookResponseSchema,
} from "./schemas";

/**
 * Maps a use-case error to the `ApiError` the brief pins down, and rethrows
 * anything else unchanged so `app.onError` turns it into a 500.
 *
 * `UpstreamError` comes from `@/lib/contracts`, not from the HTTP client
 * module — the clients throw it, `contracts.ts` declares it.
 */
function toApiError(err: unknown): ApiError {
  if (err instanceof UnknownProviderError) return new ApiError(404, "not_found", err.message);
  if (err instanceof ConnectionNotFoundError) return new ApiError(409, "conflict", err.message);
  if (err instanceof ConnectionNotUsableError) return new ApiError(409, "conflict", err.message);
  if (err instanceof SyncDisabledError) return new ApiError(409, "conflict", err.message);
  if (err instanceof SyncNotSupportedError) return new ApiError(422, "validation_failed", err.message);
  if (err instanceof CredentialValidationError) {
    return new ApiError(422, "validation_failed", err.message, err.issues);
  }
  if (err instanceof ConnectionVersionMismatchError) {
    return new ApiError(409, "version_mismatch", err.message);
  }
  if (err instanceof UpstreamError) return new ApiError(503, "integration_unavailable", err.message);
  throw err;
}

function connectionDto(c: IntegrationConnection) {
  return {
    id: c.id,
    provider: c.provider,
    status: c.status,
    settings: c.settings,
    lastTestAt: c.lastTestAt ? c.lastTestAt.toISOString() : null,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    lastError: c.lastError,
    disconnectPolicy: c.disconnectPolicy,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function summaryDto(s: IntegrationSummary) {
  return {
    provider: s.provider,
    label: s.label,
    capabilities: [...s.capabilities],
    credentialFields: s.credentialFields.map((f) => ({
      name: f.name,
      label: f.label,
      secret: f.secret,
      ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
    })),
    connection: s.connection ? connectionDto(s.connection) : null,
  };
}

function runDto(r: SyncRun) {
  return {
    id: r.id,
    connectionId: r.connectionId,
    jobId: r.jobId,
    kind: r.kind,
    status: r.status,
    trigger: r.trigger,
    stats: r.stats,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse(
    "Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`).",
  ),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

const notFound = errorResponse("No integration under that code (`not_found`).");
const conflict = errorResponse("Not connected, not usable, switched off, or a lost version race (`conflict`, `version_mismatch`).");
const unprocessable = errorResponse("The credential or the requested sync was refused (`validation_failed`).");
const unavailable = errorResponse("The upstream integration is unavailable (`integration_unavailable`).");

/**
 * Narrows a free-text path segment to a `ProviderCode` by asking the registry,
 * which is the only thing that actually knows. No cast: an unregistered code
 * leaves here as a 404, so the value handed to a use case is always one the
 * registry vouched for.
 */
function providerCodeOf(code: string): ProviderCode {
  const provider = providerRegistry.get(code);
  if (!provider) throw new ApiError(404, "not_found", `No integration named ${code}`);
  return provider.code;
}

const listRoute = createRoute({
  method: "get",
  path: "/integrations",
  tags: ["Integrations"],
  security: [{ session: [] }],
  responses: {
    200: {
      description: "Every registered provider, with its connection when there is one.",
      content: { "application/json": { schema: IntegrationListResponseSchema } },
    },
    ...commonErrorResponses,
  },
});

const connectRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/connect",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description:
    "Stores the credential and tests it. A failed test is still a 200: the connection lands in `error` with the provider's own message. The credential is never echoed back.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: ConnectRequestSchema } } },
  },
  responses: {
    200: { description: "The connection and the test result.", content: { "application/json": { schema: ConnectResponseSchema } } },
    404: notFound,
    409: conflict,
    422: unprocessable,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const testRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/test",
  tags: ["Integrations"],
  security: [{ session: [] }],
  request: { params: ProviderParamSchema },
  responses: {
    200: { description: "Whether the stored credential still works.", content: { "application/json": { schema: TestResultSchema } } },
    404: notFound,
    409: conflict,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const syncRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/sync",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description:
    "Idempotent per running job: a second call while a run is in flight returns that run. `kind` defaults to the provider's only sync.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: SyncRequestBodySchema } } },
  },
  responses: {
    200: { description: "The run, finished or already in flight.", content: { "application/json": { schema: SyncResponseSchema } } },
    404: notFound,
    409: conflict,
    422: unprocessable,
    503: unavailable,
    ...commonErrorResponses,
  },
});

const disconnectRoute = createRoute({
  method: "post",
  path: "/integrations/{provider}/disconnect",
  tags: ["Integrations"],
  security: [{ session: [] }],
  description: "Destroys the credential and applies the disconnect policy. `policy` overrides the stored one for this call only.",
  request: {
    params: ProviderParamSchema,
    body: { content: { "application/json": { schema: DisconnectRequestSchema } } },
  },
  responses: {
    200: { description: "The policy that was applied.", content: { "application/json": { schema: DisconnectResponseSchema } } },
    404: notFound,
    409: conflict,
    ...commonErrorResponses,
  },
});

const syncRunsRoute = createRoute({
  method: "get",
  path: "/integrations/{provider}/sync-runs",
  tags: ["Integrations"],
  security: [{ session: [] }],
  request: { params: ProviderParamSchema, query: SyncRunsQuerySchema },
  responses: {
    200: { description: "Most recent runs first.", content: { "application/json": { schema: SyncRunsPageSchema } } },
    404: notFound,
    ...commonErrorResponses,
  },
});

const webhookRoute = createRoute({
  method: "post",
  path: "/webhooks/{provider}",
  tags: ["Integrations"],
  // No `security`: this endpoint authenticates itself with an HMAC over the
  // raw body, using the receiving connection's own webhook secret. It is
  // therefore also the one /api/v1 route exempt from `X-Requested-With`.
  description:
    "Verifies `X-Signature: sha256=<hex>` over the raw body and queues the provider's syncs. The work runs on the next `sync_queue` tick, not in this request.",
  request: {
    params: ProviderParamSchema,
    // A plain OpenAPI schema, not a Zod one: `@hono/zod-openapi` only wires up
    // its automatic body validator for a Zod schema, and that validator would
    // call `c.req.json()` before the handler runs, both consuming the body and
    // rejecting a signed-but-non-JSON delivery with a generic 400 before the
    // signature is ever checked. This route validates and reads the raw body
    // itself (`handleWebhook`), so the schema here is documentation only.
    body: { content: { "application/json": { schema: { type: "object" } } } },
  },
  responses: {
    202: {
      description: "Signature verified; syncs queued.",
      content: { "application/json": { schema: WebhookResponseSchema } },
    },
    404: errorResponse("The signature did not verify against any connection, or the provider does not exist."),
  },
});

/** 1–200, default 20; anything else is a 422 rather than a silent clamp. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new ApiError(422, "validation_failed", "limit must be an integer between 1 and 200");
  }
  return n;
}

export function registerIntegrationRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const items = await listIntegrations(integrationDeps(deps.db, c.get("requestId")))(principal);
      return c.json({ items: items.map(summaryDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(connectRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const result = await connectIntegration(integrationDeps(deps.db, c.get("requestId")))(principal, {
        provider: providerCodeOf(provider),
        credentials: body.credentials,
        ...(body.settings !== undefined ? { settings: body.settings } : {}),
        ...(body.disconnectPolicy !== undefined ? { disconnectPolicy: body.disconnectPolicy } : {}),
      });
      // `connectionDto` has no field for a credential, so the response cannot
      // carry one back however the handler is later edited.
      return c.json({ connection: connectionDto(result.connection), test: result.test }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(testRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    try {
      const result = await testIntegrationConnection(integrationDeps(deps.db, c.get("requestId")))(
        principal,
        providerCodeOf(provider),
      );
      return c.json(result, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(syncRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      // No `kind` defaulting here: `runSync` owns that rule, so this route and
      // `syncIntegrationAction` cannot end up disagreeing about it.
      const run = await runSync(integrationDeps(deps.db, c.get("requestId")))(principal, {
        provider: providerCodeOf(provider),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        trigger: "api",
      });
      return c.json({ run: runDto(run) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(disconnectRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const result = await disconnectIntegration(integrationDeps(deps.db, c.get("requestId")))(
        principal,
        providerCodeOf(provider),
        body.policy,
      );
      return c.json(result, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(syncRunsRoute, async (c) => {
    const principal = c.get("principal");
    const { provider } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const code = providerCodeOf(provider);
      const limit = parseLimit(query.limit);
      const summaries = await listIntegrations(integrationDeps(deps.db, c.get("requestId")))(principal);
      const summary = summaries.find((s) => s.provider === code);
      return c.json({ items: (summary?.recentRuns ?? []).slice(0, limit).map(runDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(webhookRoute, async (c) => {
    const providerCode = c.req.param("provider")!;
    // `c.req.text()`, not `c.req.raw.text()`: nothing here validates the body
    // (see `webhookRoute` above), so the underlying stream is still open and
    // either read works — but going through Hono's own request object is what
    // keeps this safe if that ever changes, since Hono caches the body text
    // the first time anything reads it and hands back the same raw bytes on a
    // second read rather than re-consuming (or failing on) the stream.
    const rawBody = await c.req.text();
    // No `withSystemContext` here: `handleWebhook` opens exactly the contexts
    // it needs (Global Constraints), and it enqueues rather than syncing, so
    // nothing a user owns is ever written under `app.role = 'system'`.
    const outcome = await handleWebhook(integrationDeps(deps.db, c.get("requestId")))({
      provider: providerCode,
      rawBody,
      headers: c.req.raw.headers,
    });
    // One answer for "no such provider", "bad signature" and "signed but
    // unreadable": a machine endpoint must not confirm what exists.
    if (!outcome.accepted) throw new ApiError(404, "not_found", "No such webhook endpoint");
    return c.json({ accepted: true, runIds: outcome.runIds }, 202);
  });
}
