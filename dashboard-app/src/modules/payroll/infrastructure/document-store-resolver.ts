import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { DocumentStore } from "../application/ports";
import { createLocalDocumentStore } from "./local-document-store";
import { createS3DocumentStore } from "./s3-document-store";
import { SILO_PROVIDER, siloCredentialSchema, type SiloCredentials } from "./silo-provider-adapter";

export type { SiloCredentials };

export interface DocumentStoreResolution {
  store: DocumentStore;
  driver: "silo" | "local";
}

export interface StoreFromDriverInput {
  driver: "silo" | "local";
  localPath: string | undefined;
  nodeEnv: string;
  credentials: SiloCredentials | null;
}

/**
 * The pure half, so the decision is unit-testable without a database.
 *
 * `null` means "not configured" — a setup state the pages render as an empty
 * state with a link to Settings › Integrations, never as a zero or an error.
 * The one hard refusal is the local driver in production (Ruling R4-16), which
 * throws rather than returning null: silently falling back to the silo there
 * would hide a misconfiguration behind a store the operator did not choose.
 *
 * `resolveDocumentStore` and `documentStoreConfigured` below are the impure
 * half that reads the user's `payroll_silo` integration connection.
 */
export function storeFromDriver(input: StoreFromDriverInput): DocumentStoreResolution | null {
  if (input.driver === "local") {
    if (input.nodeEnv === "production") {
      throw new Error(
        "local document store is not usable in production: the container is read-only (see docs/deploy/phase-4-runbook.md)",
      );
    }
    if (!input.localPath) return null;
    return { store: createLocalDocumentStore(input.localPath), driver: "local" };
  }
  if (!input.credentials) return null;
  return { store: createS3DocumentStore(input.credentials), driver: "silo" };
}

/**
 * The impure half. Reads the user's `payroll_silo` connection and decrypts its
 * credential, both **outside** any caller's transaction — this is exactly the
 * I/O Ruling R4-8 keeps out of the use-case transaction, which is why the store
 * is resolved before `withUserContext` opens and handed in as a dep.
 *
 * `openConnection` opens its own `inUserContext` transaction, so this must not
 * be called from inside one (the "never nested" global constraint).
 */
export async function resolveDocumentStore(userId: string): Promise<DocumentStoreResolution | null> {
  const e = env();
  if (e.DOCUMENT_STORE_DRIVER === "local") {
    return storeFromDriver({ driver: "local", localPath: e.DOCUMENT_STORE_LOCAL_PATH, nodeEnv: e.NODE_ENV, credentials: null });
  }
  const { integrationDeps } = await import("@/modules/integrations/infrastructure/deps");
  const { openConnection } = await import("@/modules/integrations/application/open-connection");
  const opened = await openConnection(integrationDeps(db))(userId, SILO_PROVIDER);
  if (!opened) return null;
  const parsed = siloCredentialSchema.safeParse(opened.credentials);
  if (!parsed.success) return null;
  return storeFromDriver({ driver: "silo", localPath: undefined, nodeEnv: e.NODE_ENV, credentials: parsed.data });
}

/**
 * Whether a store could be configured at all — the capability probe's question
 * (spec §6's feature matrix: "payroll feature (silo or local store
 * configured)"). Deliberately does not open a connection: the probe runs on
 * every request, and `resolveCapabilities` already asks `connectionStates`
 * separately.
 */
export function documentStoreConfigured(): boolean {
  const e = env();
  return e.DOCUMENT_STORE_DRIVER === "silo" || Boolean(e.DOCUMENT_STORE_LOCAL_PATH);
}
