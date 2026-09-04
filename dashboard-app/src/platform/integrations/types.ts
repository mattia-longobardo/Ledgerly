/**
 * The integration framework's vocabulary (spec §6). Provider-neutral by
 * construction: nothing in this file names Wallet or Trek, and nothing in it
 * imports a module that does.
 */

import type { ZodType } from "zod";
import type { DbClient } from "@/lib/db/client";
import type { AuditInput } from "@/platform/audit/record";
import type { Clock } from "@/platform/clock";

/** Ruling P2-C6: `payroll_silo` joins in Phase 4, with the document store it needs. */
export type ProviderCode = "wallet" | "trek";

export type IntegrationCapability =
  | "accounts"
  | "transactions"
  | "interest_posting"
  | "leave"
  | "documents";

export type ConnectionStatus = "disconnected" | "connected" | "error" | "disabled";
export type DisconnectPolicy = "keep" | "archive" | "purge";
export type SyncKind = "accounts" | "leave";
export type SyncTrigger = "cron" | "manual" | "webhook" | "api";

/**
 * `queued` is a run a webhook created and nobody has executed yet (spec §3.4,
 * Ruling P2-C3). `skipped` is a run that was started and deliberately did
 * nothing.
 */
export type SyncRunStatus = "queued" | "running" | "success" | "failed" | "skipped";

/** The dispatch tier a sync's `sync_jobs` row is created with (Ruling P2-4). */
export type SyncSchedule = "hourly" | "daily" | "monthly";

export interface IntegrationConnection {
  id: string;
  userId: string;
  provider: ProviderCode;
  status: ConnectionStatus;
  settings: Record<string, unknown>;
  lastTestAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  disconnectPolicy: DisconnectPolicy;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  /** The `sync_jobs` row this run belongs to, or null when there is none. */
  jobId: string | null;
  kind: SyncKind;
  status: SyncRunStatus;
  trigger: SyncTrigger;
  stats: Record<string, number>;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

/**
 * The first half of a sync: talking to the provider.
 *
 * It carries the credential and NO database handle, on purpose. The engine
 * calls `fetch` with no transaction open, so a slow provider cannot hold one of
 * the pool's eight connections for the length of an HTTP conversation — the
 * defect Task 2 removed from the Wallet path, made unrepeatable by the type.
 */
export interface SyncFetchContext {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
  runId: string;
  clock: Clock;
  /** The `sync_jobs.cursor` value for this (connection, kind), or null. */
  cursor: unknown;
}

/**
 * The second half: writing what `fetch` brought back.
 *
 * It carries the database handle and NO credential — an `apply` that wanted to
 * call the provider would have nothing to call it with. `setCursor` records
 * where the next pass should resume; the engine persists it only if the run
 * ends `success` (Ruling P2-C5).
 */
export interface SyncApplyContext {
  connection: IntegrationConnection;
  runId: string;
  db: DbClient;
  clock: Clock;
  cursor: unknown;
  setCursor(next: unknown): void;
  audit(e: AuditInput): Promise<void>;
}

export interface SyncHandler<P = unknown> {
  /** The tier the `sync_jobs` row for this kind is created on. */
  schedule: SyncSchedule;
  /** Provider I/O only. No transaction is open while this runs. */
  fetch(ctx: SyncFetchContext): Promise<P>;
  /** Database work only, inside one user-scoped transaction. Returns the run's stats. */
  apply(ctx: SyncApplyContext, payload: P): Promise<Record<string, number>>;
}

export interface DisconnectContext {
  connection: IntegrationConnection;
  policy: DisconnectPolicy;
  db: DbClient;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
}

export interface SyncRequest {
  kind: SyncKind;
  event: string;
}

/**
 * One provider, in the framework's terms (spec §6).
 *
 * `verify(req, secret)` and `toSyncRequests(payload)` deviate from the spec's
 * illustrative sketch (`verify(req)`, `toJobs(payload)`) — Ruling P2-C8: the
 * secret is per connection, so a verifier cannot resolve it itself, and what
 * comes back is a sync request, not a job row.
 */
export interface IntegrationProvider {
  code: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialSchema: ZodType<Record<string, string>>;
  credentialFields: readonly CredentialField[];
  testConnection(
    credentials: Record<string, string>,
    settings: Record<string, unknown>,
  ): Promise<TestResult>;
  syncs: Partial<Record<SyncKind, SyncHandler>>;
  webhook?: {
    verify(req: WebhookRequest, secret: string): boolean;
    toSyncRequests(payload: unknown): SyncRequest[];
  };
  onDisconnect(ctx: DisconnectContext): Promise<void>;
}

export interface ProviderRegistry {
  get(code: string): IntegrationProvider | null;
  list(): IntegrationProvider[];
}
