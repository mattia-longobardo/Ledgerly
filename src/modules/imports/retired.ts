import "server-only";
import { asc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { deleteObject, getObject } from "@/platform/storage";
import { DOCUMENT_KINDS, READ_KINDS } from "./rules";
import { documents } from "./schema";

// The documents of the kinds the app no longer reads (rewrite plan, decisions H19 and H24, step A4
// of release N6): the rows and the originals a fund's import left before the import was removed.
// What was read from them — the fund's operations and values — is the fund's own data and stays;
// only the pointer to the document goes (`on delete set null`).
//
// Deleting them cannot be undone without a copy. So nothing here runs by itself: it is a step an
// operator takes after the copy is made and checked (`scripts/fund-documents.ts`).

/** The kinds a document row may still have and nothing reads. */
export const RETIRED_KINDS = DOCUMENT_KINDS.filter(
  (kind) => !(READ_KINDS as readonly string[]).includes(kind),
);

export interface RetiredDocument {
  id: string;
  kind: string;
  sha256: string;
  sizeBytes: number;
  /** `null` when the original already went at the end of its retention. */
  storageKey: string | null;
}

/** Every document of a retired kind, of every person, in a stable order. */
export async function retiredDocuments(): Promise<RetiredDocument[]> {
  if (RETIRED_KINDS.length === 0) return [];
  return getDb()
    .select({
      id: documents.id,
      kind: documents.kind,
      sha256: documents.sha256,
      sizeBytes: documents.sizeBytes,
      storageKey: documents.storageKey,
    })
    .from(documents)
    .where(inArray(documents.kind, RETIRED_KINDS))
    .orderBy(asc(documents.storageKey), asc(documents.id));
}

/** The original of one of them, as the store holds it now. */
export const retiredOriginal = (document: Pick<RetiredDocument, "storageKey">) =>
  document.storageKey === null ? Promise.resolve(null) : getObject(document.storageKey);

/**
 * Deletes the originals from the store, then the rows — in that order, so that a row never points
 * at a file that is gone while the row is still there to be read. `expected` is the number of rows
 * the operator saw and copied: with any other number nothing is deleted.
 *
 * The rows go in one statement with its `WHERE` on the kind; the evidence under a document goes
 * with it, and the operations and positions that named it keep everything but the pointer.
 */
export async function deleteRetiredDocuments(expected: number): Promise<{ files: number; rows: number }> {
  const found = await retiredDocuments();
  if (found.length !== expected) {
    throw new RangeError(`Expected ${expected} documents of the retired kinds, found ${found.length}`);
  }
  let files = 0;
  for (const document of found) {
    if (document.storageKey === null) continue;
    await deleteObject(document.storageKey);
    files += 1;
  }
  const rows = await getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(documents)
      .where(inArray(documents.kind, RETIRED_KINDS))
      .returning({ id: documents.id });
    if (deleted.length !== expected) {
      throw new RangeError(`Expected to delete ${expected} rows, the statement took ${deleted.length}`);
    }
    return deleted.length;
  });
  return { files, rows };
}

/** How many rows of the retired kinds are left: 0 after the step. */
export async function retiredCount(): Promise<number> {
  if (RETIRED_KINDS.length === 0) return 0;
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(documents)
    .where(inArray(documents.kind, RETIRED_KINDS));
  return row.total;
}
