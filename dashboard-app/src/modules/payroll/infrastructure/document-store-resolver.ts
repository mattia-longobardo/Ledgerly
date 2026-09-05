import type { DocumentStore } from "../application/ports";
import { createLocalDocumentStore } from "./local-document-store";
import { createS3DocumentStore } from "./s3-document-store";

export interface DocumentStoreResolution {
  store: DocumentStore;
  driver: "silo" | "local";
}

/**
 * Stub shape for Task 3. Task 7's `silo-provider-adapter.ts` defines the real
 * `SiloCredentials` (and `SILO_PROVIDER`, `siloCredentialSchema`); this file
 * is replaced there to import and re-export it instead of declaring its own
 * copy. Kept structurally identical to `S3StoreConfig` on purpose — a silo
 * credential is exactly what the S3 adapter needs to talk to it.
 */
export interface SiloCredentials {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
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
 * `resolveDocumentStore` and `documentStoreConfigured` — the impure half that
 * reads the user's `payroll_silo` integration connection — are added in
 * Task 7, once `silo-provider-adapter.ts` exists to supply `SILO_PROVIDER`
 * and `siloCredentialSchema`. Until then this file has nothing to import them
 * from.
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
