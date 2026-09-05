/**
 * The payroll document store as an `IntegrationProvider`.
 *
 * The only new file in this phase that names the silo, which is what keeps the
 * "provider names only in `*-adapter.ts`" rule true: `sigv4.ts` and
 * `s3-document-store.ts` name S3 (a protocol) and know nothing about which
 * container answers.
 *
 * Ruling R4-15: `syncs` is empty and no `SyncKind` is added. A document store
 * has nothing to pull on a schedule; it registers here only so its credentials
 * get the same AES-256-GCM vault and the same Settings › Integrations
 * connect/test/disconnect UI as Wallet and Trek.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { errorMessage } from "@/lib/clients/http";
import type { DisconnectContext, IntegrationProvider, TestResult } from "@/platform/integrations/types";
import type { DocumentStore } from "../application/ports";
import { createS3DocumentStore } from "./s3-document-store";

export const SILO_PROVIDER = "payroll_silo" as const;

export interface SiloCredentials {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const siloCredentialSchema = z.object({
  endpoint: z.url(),
  bucket: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

/**
 * The framework's `DisconnectContext` plus the store the purge policy needs.
 * The store is resolved by the disconnect caller — it is network I/O, and
 * Ruling R4-8 keeps that outside the use case's transaction — so it arrives as
 * an extra field rather than being opened here.
 */
export type SiloDisconnectContext = DisconnectContext & { store?: DocumentStore };

/** `settings` may carry a `fetchImpl` in tests; production passes an empty object. */
function storeFor(credentials: Record<string, string>, settings: Record<string, unknown>): DocumentStore {
  const parsed = siloCredentialSchema.parse(credentials);
  const fetchImpl = settings.fetchImpl as typeof fetch | undefined;
  return createS3DocumentStore({ ...parsed, ...(fetchImpl ? { fetchImpl } : {}) });
}

/**
 * A real write-read-delete round trip, not a HEAD.
 *
 * A credential that can list but not write would pass any read-only check and
 * then fail on the user's first real upload — after the connect form has told
 * them everything is fine. The probe key lives under `payroll/_probe/`, outside
 * every user's own `payroll/{userId}/` prefix, so a leftover probe from a
 * crashed run can never be mistaken for somebody's payslip.
 */
async function testConnection(
  credentials: Record<string, string>,
  settings: Record<string, unknown>,
): Promise<TestResult> {
  const key = `payroll/_probe/${randomBytes(8).toString("hex")}`;
  try {
    const store = storeFor(credentials, settings);
    await store.put(key, new Uint8Array([0x70, 0x72, 0x6f, 0x62, 0x65]), "application/octet-stream");
    const read = await store.get(key);
    await store.delete(key);
    if (read === null) return { ok: false, message: "Wrote a probe object but could not read it back." };
    return { ok: true, message: "Wrote, read and deleted a probe object in the payroll bucket." };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/**
 * `purge` is the only policy that touches bytes, and it deletes exactly the
 * disconnecting user's own prefix — never the bucket, never another user's
 * objects. It does **not** delete `payroll_imports` rows: the provenance
 * outlives the bytes, the same asymmetry the retention job holds (Ruling R4-5).
 * Nulling the affected `storage_key`s is the caller's job, done in the
 * disconnect use case's own transaction; this adapter is given no repository.
 */
async function onDisconnect(ctx: SiloDisconnectContext): Promise<void> {
  let purged = 0;
  if (ctx.policy === "purge" && ctx.store) {
    const keys = await ctx.store.listPrefix(`payroll/${ctx.connection.userId}/`);
    for (const key of keys) {
      await ctx.store.delete(key);
      purged += 1;
    }
  }
  await ctx.audit({
    actorUserId: ctx.connection.userId,
    action: "integration.disconnect_applied",
    entityType: "integration_connection",
    entityId: ctx.connection.id,
    after: { provider: SILO_PROVIDER, policy: ctx.policy, objectsPurged: purged },
  });
}

export const siloProvider: IntegrationProvider = {
  code: SILO_PROVIDER,
  label: "Payroll document store",
  capabilities: ["documents"],
  credentialSchema: siloCredentialSchema as unknown as IntegrationProvider["credentialSchema"],
  credentialFields: [
    { name: "endpoint", label: "Endpoint URL", secret: false, placeholder: "https://silo.internal" },
    { name: "bucket", label: "Bucket", secret: false, placeholder: "payroll" },
    { name: "region", label: "Region", secret: false, placeholder: "us-east-1" },
    { name: "accessKeyId", label: "Access key id", secret: true },
    { name: "secretAccessKey", label: "Secret access key", secret: true },
  ],
  testConnection,
  syncs: {},
  onDisconnect,
};
