import "server-only";
import { processCometaDocument, uploadCometaDocument } from "@/modules/funds/pension/imports";
import { MAX_DOCUMENT_BYTES } from "@/modules/imports/rules";
import { ImportError } from "@/modules/imports/service";
import { processPayslip, uploadPayslip } from "@/modules/payroll/service";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { withJobLock } from "@/platform/jobs/lock";
import { PAPERLESS_PROVIDER } from "../rules";
import {
  type Connection,
  finishRun,
  listConnections,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  saveSyncJob,
  skipRun,
} from "../service";
import { createPaperlessClient, isTokenRejected, type PaperlessClient } from "./client";
import { MAX_DOCUMENTS_PER_PASS, resolveTypes, startCursor, storedName } from "./mapping";

/**
 * The Paperless pass (docs/auth-design.md D5): Ledgerly asks Paperless for the documents of the
 * configured types modified since the last pass, downloads each original and hands it to the same
 * pipeline the upload screen and `POST /api/v1/imports` use. The pipeline deduplicates on the
 * file's sha256 per user, so a payslip the webhook already delivered comes back `duplicate` and
 * nothing happens twice — which is what lets the webhook and the pull run side by side (§3).
 *
 * The network is never inside a transaction: each download is finished before the upload's own
 * short write, and the cursor moves only past documents that were actually handled.
 */

const SYNC_LOCK_PREFIX = "sync:paperless:";
const KIND = "documents" as const;

export class PaperlessBusyError extends Error {
  constructor() {
    super("A Paperless pass is already running for this user");
    this.name = "PaperlessBusyError";
  }
}

export function isPaperlessBusy(error: unknown): boolean {
  return (
    error instanceof PaperlessBusyError || (error instanceof Error && error.name === "PaperlessBusyError")
  );
}

export interface PaperlessSyncResult {
  counts: Record<string, number>;
  /** `"revoked"` when nothing was attempted because the token is already refused. */
  refused: "revoked" | null;
}

async function paperlessConnection(ctx: Pick<Ctx, "userId">): Promise<Connection | null> {
  return (await listConnections(ctx)).find((one) => one.provider === PAPERLESS_PROVIDER) ?? null;
}

/** The client of a stored connection; the credential is opened here and goes nowhere else. */
export async function paperlessClientOf(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<{ client: PaperlessClient; credentials: Record<string, string> }> {
  const credentials = await readCredentials(ctx, connectionId);
  return {
    client: createPaperlessClient({ baseUrl: credentials.baseUrl ?? "", token: credentials.token ?? "" }),
    credentials,
  };
}

async function importOne(
  ctx: Ctx,
  client: PaperlessClient,
  document: { id: number; originalFileName: string | null },
  kind: "payslip" | "cometa_operations" | "cometa_position",
): Promise<"created" | "duplicate" | "rejected"> {
  const file = await client.download(document.id);
  if (file.bytes.byteLength > MAX_DOCUMENT_BYTES) return "rejected";
  const upload = {
    name: storedName({ header: file.name, original: document.originalFileName, id: document.id }),
    bytes: file.bytes,
  };
  try {
    const result =
      kind === "payslip" ? await uploadPayslip(ctx, upload) : await uploadCometaDocument(ctx, kind, upload);
    if (result.duplicate) return "duplicate";
    // Read now, in the pass: there is no request whose answer it would delay. A reading that
    // fails leaves the document `extracting` for the hourly sweep, as an upload's would.
    try {
      if (kind === "payslip") await processPayslip(ctx, result.document.id);
      else await processCometaDocument(ctx, result.document.id);
    } catch (error) {
      console.error(`[paperless] reading ${result.document.id} failed`, redactForLog(error));
    }
    return "created";
  } catch (error) {
    // Not a PDF the pipeline takes, or empty: the document is skipped, the pass goes on.
    if (error instanceof ImportError) return "rejected";
    throw error;
  }
}

async function paperlessPass(ctx: Ctx, connection: Connection, now: Date): Promise<PaperlessSyncResult> {
  const run = await recordRun(ctx, { connectionId: connection.id, kind: KIND });
  if (connection.state === "revoked") {
    await skipRun(ctx, run.id, "Paperless refused the token: save a new one in Settings › Integrations");
    return { counts: {}, refused: "revoked" };
  }
  const counts = { created: 0, skipped: 0, removed: 0, updated: 0 };
  try {
    const { client, credentials } = await paperlessClientOf(ctx, connection.id);
    const { byType, missing } = resolveTypes(credentials, await client.documentTypes());
    if (missing.length > 0) throw new Error(`Paperless has no document type named ${missing.join(", ")}`);
    const job = await readSyncJob(ctx, connection.id, KIND);
    const documents = await client.documents({
      typeIds: [...byType.keys()],
      modifiedAfter: startCursor(job?.cursor, now),
      limit: MAX_DOCUMENTS_PER_PASS,
    });
    let cursor: string | null = null;
    for (const document of documents) {
      const kind = document.documentType === null ? undefined : byType.get(document.documentType);
      if (kind) {
        const outcome = await importOne(ctx, client, document, kind);
        if (outcome === "created") counts.created += 1;
        else counts.skipped += 1;
      }
      cursor = document.modified;
    }
    if (cursor !== null) await saveSyncJob(ctx, connection.id, KIND, { cursor: { modified: cursor } }, now);
    await finishRun(ctx, run.id, { counts }, now);
    return { counts, refused: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await finishRun(ctx, run.id, { counts, error: message }, now);
    if (isTokenRejected(error)) await markConnection(ctx, connection.id, "revoked", message, now);
    throw error;
  }
}

/** One pass for the person's Paperless connection, or null when they have none. */
export async function syncPaperlessNow(
  ctx: Ctx,
  now: Date = new Date(),
): Promise<PaperlessSyncResult | null> {
  const connection = await paperlessConnection(ctx);
  if (!connection) return null;
  const outcome = await withJobLock(`${SYNC_LOCK_PREFIX}${ctx.userId}`, () =>
    paperlessPass(ctx, connection, now),
  );
  if (!outcome.ran) throw new PaperlessBusyError();
  return outcome.value;
}

/** The pass as the integrations dispatcher counts it (D7). */
export async function runPaperlessPass(
  ctx: Ctx,
): Promise<"answered" | "failed" | "refused" | "busy" | "absent"> {
  try {
    const result = await syncPaperlessNow(ctx);
    if (result === null) return "absent";
    return result.refused === null ? "answered" : "refused";
  } catch (error) {
    if (isPaperlessBusy(error)) return "busy";
    console.error("[integrations-sync] the Paperless pass failed", redactForLog(error));
    return "failed";
  }
}
