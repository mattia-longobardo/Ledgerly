import { db } from "@/lib/db";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { markUploadFailed, markUploaded, reserveImport, type UploadCandidate } from "../application/create-import";
import { InvalidInputError } from "../application/errors";
import type { PayrollImport, UploadedVia } from "../application/ports";
import { payrollDeps } from "./deps";
import { resolveDocumentStore } from "./document-store-resolver";
import { readRetentionYears } from "./retention-settings";
import { resolveScanner } from "./scanner-resolver";

export interface UploadInput extends UploadCandidate {
  idempotencyKey?: string | null;
  replacesImportId?: string | null;
  uploadedVia?: UploadedVia;
  requestId?: string | null;
}

/**
 * The upload, as three short steps with the network call between two of them.
 *
 * 1. Resolve the store and the scanner — network I/O and credential decryption,
 *    done before any transaction opens (Ruling R4-8).
 * 2. Transaction one: validate and reserve the row.
 * 3. **No transaction**: write the bytes. A 10 MB PUT inside a transaction
 *    would pin one of the pool's connections for the length of the round trip,
 *    the defect Phase 2 removed from the Wallet path.
 * 4. Transaction two: confirm, or record the failure.
 *
 * A `DuplicateImportError` escapes from step 2 with transaction one already
 * rolled back — nothing else was in it — so there is no savepoint here and none
 * is needed (Ruling R4-3, corrected).
 */
export async function uploadPayslip(principal: Principal, input: UploadInput): Promise<PayrollImport> {
  const resolution = await resolveDocumentStore(principal.userId);
  if (!resolution) {
    throw new InvalidInputError("No payroll document store is configured. Connect one in Settings › Integrations.");
  }
  const scanner = resolveScanner();
  const opts = { documents: resolution.store, scanner, requestId: input.requestId ?? null };

  const reserved = await withUserContext(db, { userId: principal.userId }, async (tx) => {
    const years = await readRetentionYears(tx);
    return reserveImport(payrollDeps(tx, opts))(principal, {
      ...input,
      storageProvider: resolution.driver,
      retentionYears: years,
    });
  });

  try {
    await resolution.store.put(reserved.storageKey!, input.bytes, "application/pdf");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withUserContext(db, { userId: principal.userId }, (tx) =>
      markUploadFailed(payrollDeps(tx, opts))(principal, reserved.id, message),
    );
    throw err;
  }

  return withUserContext(db, { userId: principal.userId }, (tx) =>
    markUploaded(payrollDeps(tx, opts))(principal, reserved.id),
  );
}
