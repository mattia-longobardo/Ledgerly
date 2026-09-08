import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { ConflictError, InvalidInputError } from "../application/errors";
import { beginReadOriginal, recordOriginalRead, type OriginalDocument } from "../application/read-original";
import type { DocumentStore } from "../application/ports";
import { payrollDeps } from "./deps";
import { resolveDocumentStore } from "./document-store-resolver";
import { noopScanner } from "./noop-scanner";

const NO_STORE_MESSAGE = "No payroll document store is configured. Connect one in Settings › Integrations.";

export interface ReadOriginalOptions {
  requestId?: string | null;
  /** Injected in the integration suite to observe or interfere with the fetch. Defaults to the resolved store. */
  documents?: DocumentStore;
}

/**
 * The orchestrator for "serve payslip bytes back to a person" (Task 15's API
 * route calls this as one atomic unit), decomposed the same way
 * `scanImport`/`parseImport` decompose the scan and parse boundaries
 * (PH4-C7):
 *
 * 1. Resolve the store — network I/O and credential decryption, done before
 *    any transaction opens (Ruling R4-8).
 * 2. Transaction one: `beginReadOriginal` — permission, existence, the scan
 *    gate (Ruling R4-2) and the retention gate (Ruling R4-5). No I/O.
 * 3. **No transaction**: fetch the bytes. A store that has lost an object it
 *    should still hold is a `409`, not an empty success — handing back zero
 *    bytes with a PDF content type would render as a blank document.
 * 4. Transaction two: `recordOriginalRead` — the audit write, only once the
 *    bytes actually came back.
 *
 * No transaction here ever spans the document-store round trip.
 */
export async function readOriginal(principal: Principal, importId: string, opts: ReadOriginalOptions = {}): Promise<OriginalDocument> {
  const resolution = opts.documents ? null : await resolveDocumentStore(principal.userId);
  const documents = opts.documents ?? resolution?.store;
  if (!documents) {
    throw new InvalidInputError(NO_STORE_MESSAGE);
  }
  const depsOpts = { documents, scanner: noopScanner, requestId: opts.requestId ?? null };

  const readiness = await withUserContext(db, { userId: principal.userId }, (tx) =>
    beginReadOriginal(payrollDeps(tx, depsOpts))(principal, importId),
  );

  const bytes = await documents.get(readiness.storageKey);
  if (bytes === null) {
    throw new ConflictError("The original is no longer in the document store.", "bytes_missing");
  }

  await withUserContext(db, { userId: principal.userId }, (tx) =>
    recordOriginalRead(payrollDeps(tx, depsOpts))(principal, importId, { sha256: readiness.sha256, sizeBytes: readiness.sizeBytes }),
  );

  return { bytes, mime: readiness.mime, fileName: readiness.fileName };
}
