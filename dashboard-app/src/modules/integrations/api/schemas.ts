import { z } from "@hono/zod-openapi";

export const ProviderParamSchema = z.object({
  provider: z.string().min(1).openapi({ param: { name: "provider", in: "path" }, example: "wallet" }),
});

export const ConnectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  status: z.enum(["disconnected", "connected", "error", "disabled"]),
  settings: z.record(z.string(), z.unknown()),
  lastTestAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  disconnectPolicy: z.enum(["keep", "archive", "purge"]),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CredentialFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean(),
  placeholder: z.string().optional(),
});

export const IntegrationSummarySchema = z.object({
  provider: z.string(),
  label: z.string(),
  capabilities: z.array(z.string()),
  credentialFields: z.array(CredentialFieldSchema),
  connection: ConnectionSchema.nullable(),
});

export const IntegrationListResponseSchema = z.object({ items: z.array(IntegrationSummarySchema) });

export const SyncRunSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  /** The `sync_jobs` row this run belongs to, or null. */
  jobId: z.string().nullable(),
  kind: z.enum(["accounts", "leave"]),
  /** `queued` is a webhook-created run the hourly `sync_queue` job has not reached yet. */
  status: z.enum(["queued", "running", "success", "failed", "skipped"]),
  trigger: z.enum(["cron", "manual", "webhook", "api"]),
  stats: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const SyncRunsPageSchema = z.object({ items: z.array(SyncRunSchema) });
export const SyncResponseSchema = z.object({ run: SyncRunSchema });
export const SyncRunsQuerySchema = z.object({
  limit: z.string().optional().openapi({ param: { name: "limit", in: "query" }, example: "20" }),
});

export const TestResultSchema = z.object({ ok: z.boolean(), message: z.string() });

export const ConnectRequestSchema = z.object({
  /** Field names come from the provider's own `credentialFields`; values are write-only and never returned. */
  credentials: z.record(z.string(), z.string()),
  settings: z.record(z.string(), z.unknown()).optional(),
  disconnectPolicy: z.enum(["keep", "archive", "purge"]).optional(),
});

export const ConnectResponseSchema = z.object({
  connection: ConnectionSchema,
  test: TestResultSchema,
});

export const SyncRequestBodySchema = z.object({ kind: z.enum(["accounts", "leave"]).optional() });
export const DisconnectRequestSchema = z.object({ policy: z.enum(["keep", "archive", "purge"]).optional() });
export const DisconnectResponseSchema = z.object({ policy: z.enum(["keep", "archive", "purge"]) });

export const WebhookResponseSchema = z.object({
  accepted: z.boolean(),
  runIds: z.array(z.string()),
});
