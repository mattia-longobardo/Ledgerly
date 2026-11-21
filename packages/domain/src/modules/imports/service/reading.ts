import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { enqueue } from "../../../platform/jobs";
import { type DocumentKind, MAX_DOCUMENT_BYTES } from "../rules";
import {
  claimForExtraction,
  type Document,
  type EvidenceInput,
  failExtraction,
  getDocument,
  ImportError,
  type ImportErrorCode,
  readOriginal,
  saveEvidence,
  type StoredKind,
  transition,
  uploadDocument,
} from "./index";

/**
 * What a reader made of an original (spec §9.3 step 3): a failure with its code, a scan with too
 * little text that waits for OCR (spec D11), or the values with their evidence and the kind's own
 * rows, written by `write` in the transaction that moves the document to review.
 */
export type Reading =
  | { outcome: "failed"; reason: string }
  | { outcome: "needs_ocr"; parserVersion: string }
  | {
      outcome: "read";
      parserVersion: string;
      evidence: readonly EvidenceInput[];
      write: (tx: Tx) => Promise<void>;
    };

/**
 * A kind of document the app reads (extension point E1, 10-modularity.md §10.11): its formats, its
 * folder, its reader. The module that owns the data declares it (payroll the payslip); the app
 * registers it, so this module never names a kind's owner (audit IMP-1, IMP-2).
 */
export interface DocumentReader extends StoredKind {
  read(ctx: Pick<Ctx, "userId">, documentId: string, bytes: Uint8Array): Promise<Reading>;
  /** The code a failure of the reader leaves on the document; null: `extraction_failed`. */
  failureOf(error: unknown): string | null;
}

const READERS = new Map<DocumentKind, DocumentReader>();

export function registerDocumentKind(reader: DocumentReader): void {
  READERS.set(reader.kind, reader);
}

/** The reader of a kind; null for a kind nobody reads (a fund's, decision H19). */
export function documentReaderOf(kind: DocumentKind): DocumentReader | null {
  return READERS.get(kind) ?? null;
}

/** The kinds registered: the ones the sweep looks after. */
export function readKinds(): DocumentKind[] {
  return [...READERS.keys()];
}

/** A database conflict between the claim and the end of the reading: someone else moved it. */
class ReadConflict extends Error {}

/**
 * The one pipeline of every kind (audit PAY-3): claim → read the original (outside any transaction)
 * → parse → evidence and the kind's rows in one short transaction → `needs_review`. Anything
 * unexpected fails the document with a code, never with its text. `reader`: the kind's own, for
 * its module; otherwise the registered reader of the document's kind.
 */
export async function readDocument(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  options: { stuckBefore?: Date; reader?: DocumentReader } = {},
): Promise<Document | null> {
  const claimed = await claimForExtraction(ctx, documentId, options);
  if (!claimed) return null;
  const reader = options.reader ?? READERS.get(claimed.kind);
  if (!reader || reader.kind !== claimed.kind) return null;
  try {
    const original = await readOriginal(ctx, documentId);
    if (!original) {
      await failExtraction(ctx, documentId, "original_missing");
      return getDocument(ctx, documentId);
    }
    const reading = await reader.read(ctx, documentId, original.bytes);
    if (reading.outcome === "failed") {
      await failExtraction(ctx, documentId, reading.reason);
      return getDocument(ctx, documentId);
    }
    if (reading.outcome === "needs_ocr") {
      return transition(ctx, documentId, "needs_ocr", {
        parserVersion: reading.parserVersion,
        extractedAt: new Date(),
      });
    }
    return await getDb().transaction(async (transaction) => {
      await saveEvidence(ctx, documentId, reading.evidence, { prune: true }, transaction);
      await reading.write(transaction);
      const done = await transition(
        ctx,
        documentId,
        "needs_review",
        { parserVersion: reading.parserVersion, extractedAt: new Date(), error: null },
        transaction,
      );
      if (!done) throw new ReadConflict();
      return done;
    });
  } catch (error) {
    const reason = error instanceof ReadConflict ? "conflict" : reader.failureOf(error);
    await failExtraction(ctx, documentId, reason ?? "extraction_failed");
    return getDocument(ctx, documentId);
  }
}

/** At most this many files in one upload. */
const MAX_FILES = 24;

/** A file as it arrives, before its bytes are read: a `File` of a form. */
interface IncomingFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface Uploaded {
  uploaded: { document: Document; duplicate: boolean }[];
  refused: { name: string; error: ImportErrorCode }[];
}

/**
 * Steps 1–2 of spec §9.3 for each file, the one use case of the screen and of `POST /imports`
 * (audit PAY-2, IMP-4): the size before any byte is read, then the upload; the reading of each new
 * document goes to the worker right after (spec §7.8 "subito dopo"). A file refused stays in
 * `refused` with its code; no file, or too many, refuses the whole upload.
 */
export async function uploadDocuments(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  reader: DocumentReader,
  files: readonly IncomingFile[],
): Promise<Uploaded> {
  if (files.length === 0) throw new ImportError("empty");
  if (files.length > MAX_FILES) throw new ImportError("too_many");
  const result: Uploaded = { uploaded: [], refused: [] };
  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      result.refused.push({ name: file.name, error: "too_large" });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { document, duplicate } = await uploadDocument(ctx, reader, { fileName: file.name, bytes });
      result.uploaded.push({ document, duplicate });
      if (!duplicate) await enqueue(readTask(ctx.userId, document.id));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      result.refused.push({ name: file.name, error: error.code });
    }
  }
  return result;
}

/** The worker's task that reads one document (`readDocument`); one waiting task per document. */
const readTask = (userId: string, documentId: string) => ({
  kind: "document-read",
  key: `document-read:${documentId}`,
  payload: { userId, documentId },
});
