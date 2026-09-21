import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { deleteObject, getObject, putObject } from "@/platform/storage";
import {
  cleanFileName,
  type DocumentKind,
  type DocumentState,
  type EvidenceOrigin,
  type EvidenceUnit,
  FORMATS_OF,
  IN_FLIGHT,
  MAX_DOCUMENT_BYTES,
  MIME_OF,
  retentionEnd,
  sniffFormat,
  sourcesOf,
  storageKeyFor,
} from "./rules";
import { documentEvidence, documents } from "./schema";

export type Document = typeof documents.$inferSelect;
export type Evidence = typeof documentEvidence.$inferSelect;
type Executor = Db | Tx;

export type ImportErrorCode =
  "not_found" | "empty" | "too_large" | "unsupported_format" | "storage_failed" | "invalid_state";

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = "ImportError";
  }
}

export interface Upload {
  kind: DocumentKind;
  fileName: string;
  bytes: Uint8Array;
}

/**
 * Steps 1 and 2 of the pipeline (spec §9.3): the format from the content, the SHA-256 per user —
 * the same file twice is one document —, then the original to S3 **outside** any transaction. The
 * row is reserved first so a failed upload leaves nothing behind: it is removed again if S3 refuses.
 * Reading (step 3) is the caller's to start, right after (spec §7.8).
 */
export async function uploadDocument(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  upload: Upload,
  now: Date = new Date(),
): Promise<{ document: Document; duplicate: boolean }> {
  if (upload.bytes.length === 0) throw new ImportError("empty");
  if (upload.bytes.length > MAX_DOCUMENT_BYTES) throw new ImportError("too_large");
  const format = sniffFormat(upload.bytes);
  if (format === null || !FORMATS_OF[upload.kind].includes(format))
    throw new ImportError("unsupported_format");

  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");
  const existing = await findBySha(ctx, sha256);
  if (existing) return { document: existing, duplicate: true };

  const receivedOn = today(ctx.timeZone, now);
  const storageKey = storageKeyFor(
    upload.kind,
    ctx.userId,
    Number(receivedOn.slice(0, 4)),
    randomBytes(16).toString("hex"),
    format,
  );
  let document: Document;
  try {
    [document] = await getDb()
      .insert(documents)
      .values(
        userScoped(ctx).stamp({
          kind: upload.kind,
          sha256,
          fileName: cleanFileName(upload.fileName),
          mime: MIME_OF[format],
          sizeBytes: upload.bytes.length,
          storageKey,
          retainUntil: retentionEnd(receivedOn),
          receivedAt: now,
        }),
      )
      .returning();
  } catch (error) {
    // The same file sent twice at once: the other request reserved it first.
    if (!hasPgError(error, UNIQUE_VIOLATION, "documents_user_sha_uq")) throw error;
    const winner = await findBySha(ctx, sha256);
    if (!winner) throw error;
    return { document: winner, duplicate: true };
  }

  try {
    await putObject(storageKey, upload.bytes, MIME_OF[format]);
  } catch {
    await getDb()
      .delete(documents)
      .where(and(eq(documents.id, document.id), userScoped(ctx).owns(documents)));
    throw new ImportError("storage_failed");
  }
  return { document, duplicate: false };
}

async function findBySha(ctx: Pick<Ctx, "userId">, sha256: string): Promise<Document | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.sha256, sha256), userScoped(ctx).owns(documents)));
  return row ?? null;
}

export async function getDocument(ctx: Pick<Ctx, "userId">, id: string): Promise<Document | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), userScoped(ctx).owns(documents)));
  return row ?? null;
}

export async function requireDocument(ctx: Pick<Ctx, "userId">, id: string): Promise<Document> {
  const document = await getDocument(ctx, id);
  if (!document) throw new ImportError("not_found");
  return document;
}

/** A person's documents of some kinds, newest first. */
export async function listDocuments(
  ctx: Pick<Ctx, "userId">,
  kinds: readonly DocumentKind[],
): Promise<Document[]> {
  return getDb()
    .select()
    .from(documents)
    .where(and(userScoped(ctx).owns(documents), inArray(documents.kind, [...kinds])))
    .orderBy(sql`${documents.receivedAt} desc`, sql`${documents.id} desc`);
}

type StatePatch = Partial<Pick<Document, "error" | "parserVersion" | "extractedAt">>;

/**
 * Moves a document to `to` if, and only if, the rules of spec §7.8 allow it from the state it is
 * in *now*: one conditional `UPDATE`, so a job and a person racing on the same document cannot both
 * win. Returns the updated row, or `null` when the move was not allowed.
 */
export async function transition(
  ctx: Pick<Ctx, "userId">,
  id: string,
  to: DocumentState,
  patch: StatePatch = {},
  executor: Executor = getDb(),
): Promise<Document | null> {
  const [row] = await executor
    .update(documents)
    .set({ ...patch, state: to, stateChangedAt: new Date() })
    .where(
      and(eq(documents.id, id), userScoped(ctx).owns(documents), inArray(documents.state, sourcesOf(to))),
    )
    .returning();
  return row ?? null;
}

/**
 * Claims a document for reading: through `scanning` (a pass-through until ClamAV is configured,
 * plan F5 §3.6.5) to `extracting`. `null` when someone else holds it or it is in no state to read.
 */
export async function claimForExtraction(
  ctx: Pick<Ctx, "userId">,
  id: string,
  options: { stuckBefore?: Date } = {},
): Promise<Document | null> {
  const document = await getDocument(ctx, id);
  if (!document) return null;
  if (document.state === "extracting") {
    // A reading that died half way (a restart): only the sweep takes it over, once it is old.
    if (!options.stuckBefore) return null;
    const [row] = await getDb()
      .update(documents)
      .set({ stateChangedAt: new Date() })
      .where(
        and(
          eq(documents.id, id),
          userScoped(ctx).owns(documents),
          eq(documents.state, "extracting"),
          lt(documents.stateChangedAt, options.stuckBefore),
        ),
      )
      .returning();
    return row ?? null;
  }
  if (document.state === "received" && !(await transition(ctx, id, "scanning"))) return null;
  return transition(ctx, id, "extracting", { error: null });
}

/** The reading failed: the reason is a short code, never the document's text (spec §5.4). */
export async function failExtraction(ctx: Pick<Ctx, "userId">, id: string, reason: string): Promise<void> {
  await transition(ctx, id, "failed", { error: reason.slice(0, 200) });
}

/** The original's bytes, for the viewer and for re-reading; null once retention deleted it. */
export async function readOriginal(
  ctx: Pick<Ctx, "userId">,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string } | null> {
  const document = await getDocument(ctx, id);
  if (!document?.storageKey) return null;
  const bytes = await getObject(document.storageKey);
  return bytes && { bytes, mime: document.mime, fileName: document.fileName };
}

/** Documents stuck mid-reading for longer than `olderThanMs`: the hourly sweep's work (spec §10.2). */
export async function stuckDocuments(
  ctx: Pick<Ctx, "userId">,
  kinds: readonly DocumentKind[],
  now: Date = new Date(),
  olderThanMs = 10 * 60_000,
): Promise<Document[]> {
  return getDb()
    .select()
    .from(documents)
    .where(
      and(
        userScoped(ctx).owns(documents),
        inArray(documents.kind, [...kinds]),
        inArray(documents.state, [...IN_FLIGHT]),
        lt(documents.stateChangedAt, new Date(now.getTime() - olderThanMs)),
      ),
    )
    .orderBy(asc(documents.receivedAt), asc(documents.id));
}

/** States from which a document may be deleted: nothing was applied from it. */
const DELETABLE: readonly DocumentState[] = ["needs_review", "needs_ocr", "verified", "rejected", "failed"];

/**
 * Deletes a document nothing was applied from, with its original: the object first, outside the
 * transaction, so a failure leaves a row that can be deleted again rather than a lost object.
 */
export async function deleteDocument(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const document = await requireDocument(ctx, id);
  if (!DELETABLE.includes(document.state)) throw new ImportError("invalid_state");
  if (document.storageKey) await deleteObject(document.storageKey);
  await getDb()
    .delete(documents)
    .where(
      and(eq(documents.id, id), userScoped(ctx).owns(documents), inArray(documents.state, [...DELETABLE])),
    );
}

/**
 * Step 6 (spec §9.3, §10.2): originals past their retention are deleted from S3; the row, the data
 * and the evidence stay. Returns how many originals went.
 */
export async function expireOriginals(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<number> {
  const due = await getDb()
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(
      and(
        userScoped(ctx).owns(documents),
        isNotNull(documents.storageKey),
        lt(documents.retainUntil, today(ctx.timeZone, now)),
      ),
    )
    .orderBy(asc(documents.id));
  let deleted = 0;
  for (const row of due) {
    if (!row.storageKey) continue;
    await deleteObject(row.storageKey);
    await getDb()
      .update(documents)
      .set({ storageKey: null, originalDeletedAt: now })
      .where(and(eq(documents.id, row.id), userScoped(ctx).owns(documents)));
    deleted += 1;
  }
  return deleted;
}

export interface EvidenceInput {
  field: string;
  value: string | null;
  unit: EvidenceUnit;
  sourceLabel: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  origin: EvidenceOrigin;
  confidence: number;
  rawText: string | null;
  derivedFrom?: string[] | null;
}

/**
 * Writes what a reading found (spec §7.8 "Evidenza per ogni valore"), one row per field. A field
 * read again with the same value keeps what the person decided about it; a field whose value
 * changed goes back to `unverified`, its old correction dropped, since it was about another value.
 * Fields no longer produced are removed.
 */
export async function writeEvidence(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  rows: readonly EvidenceInput[],
  tx: Tx,
): Promise<void> {
  const current = await tx
    .select()
    .from(documentEvidence)
    .where(and(eq(documentEvidence.documentId, documentId), userScoped(ctx).owns(documentEvidence)));
  const fields = new Set(rows.map((row) => row.field));
  const gone = current.filter((row) => !fields.has(row.field)).map((row) => row.id);
  if (gone.length > 0) {
    await tx
      .delete(documentEvidence)
      .where(and(inArray(documentEvidence.id, gone), userScoped(ctx).owns(documentEvidence)));
  }
  await upsertRows(ctx, documentId, rows, current, tx);
}

/** Like `writeEvidence` for some fields only, leaving the others as they are: derived values. */
export async function upsertEvidence(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  rows: readonly EvidenceInput[],
  tx: Tx,
): Promise<void> {
  const current = await tx
    .select()
    .from(documentEvidence)
    .where(and(eq(documentEvidence.documentId, documentId), userScoped(ctx).owns(documentEvidence)));
  await upsertRows(ctx, documentId, rows, current, tx);
}

async function upsertRows(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  rows: readonly EvidenceInput[],
  current: readonly Evidence[],
  tx: Tx,
): Promise<void> {
  const byField = new Map(current.map((row) => [row.field, row]));
  for (const row of rows) {
    const values = {
      value: row.value,
      unit: row.unit,
      sourceLabel: row.sourceLabel,
      page: row.page,
      bbox: row.bbox,
      origin: row.origin,
      confidence: row.confidence.toFixed(2),
      rawText: row.rawText,
      derivedFrom: row.derivedFrom ?? null,
    };
    const before = byField.get(row.field);
    if (!before) {
      await tx
        .insert(documentEvidence)
        .values(userScoped(ctx).stamp({ documentId, field: row.field, ...values }));
      continue;
    }
    const same = before.value === row.value && before.origin === row.origin;
    await tx
      .update(documentEvidence)
      .set(
        same || row.origin === "derived"
          ? values
          : {
              ...values,
              verification: "unverified",
              correctedValue: null,
              correctedBy: null,
              correctedAt: null,
            },
      )
      .where(and(eq(documentEvidence.id, before.id), userScoped(ctx).owns(documentEvidence)));
  }
}

export async function listEvidence(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  executor: Executor = getDb(),
): Promise<Evidence[]> {
  return executor
    .select()
    .from(documentEvidence)
    .where(and(eq(documentEvidence.documentId, documentId), userScoped(ctx).owns(documentEvidence)))
    .orderBy(asc(documentEvidence.field));
}

/**
 * A person's decision on one value (spec §7.8): `confirmed` as read, or `corrected` to another
 * value that sits beside the original (owner's spec L249). `null` confirms without correcting.
 */
export async function decideEvidence(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  field: string,
  correctedValue: string | null,
  tx: Tx,
  now: Date = new Date(),
): Promise<Evidence | null> {
  const [row] = await tx
    .update(documentEvidence)
    .set(
      correctedValue === null
        ? { verification: "confirmed", correctedValue: null, correctedBy: null, correctedAt: null }
        : { verification: "corrected", correctedValue, correctedBy: ctx.userId, correctedAt: now },
    )
    .where(
      and(
        eq(documentEvidence.documentId, documentId),
        eq(documentEvidence.field, field),
        userScoped(ctx).owns(documentEvidence),
      ),
    )
    .returning();
  return row ?? null;
}
