import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { MAX_UPLOAD_BYTES, looksLikePdf, newStorageKey, sha256Hex } from "../domain/document";
import type { PayrollImport, StorageProvider, UploadedVia, UseCaseDeps } from "./ports";
import { DuplicateImportError, InvalidInputError, NotFoundError } from "./errors";

/** Spec §13.5: the Italian statutory horizon for payslips. Overridable per deployment. */
export const DEFAULT_RETENTION_YEARS = 10;

export interface UploadCandidate {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ReserveImportInput extends UploadCandidate {
  storageProvider: StorageProvider;
  idempotencyKey?: string | null;
  replacesImportId?: string | null;
  uploadedVia?: UploadedVia;
  retentionYears?: number;
}

/**
 * Spec §8.3's upload gate, in one pure function so the API, the server action
 * and the migration script all reject the same things for the same reasons.
 *
 * The magic-byte check is the one that matters: `mime` is a claim the client
 * makes about a file it chose, and a store that accepts whatever it is told is
 * a store that will later hand an HTML page to a PDF viewer.
 */
export function validateUpload(candidate: UploadCandidate): { ok: true } | { ok: false; message: string } {
  if (candidate.bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (candidate.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "The file is larger than 10 MB." };
  if (candidate.mime !== "application/pdf") return { ok: false, message: "Only PDF payslips can be uploaded." };
  if (!looksLikePdf(candidate.bytes)) return { ok: false, message: "That file is not a PDF." };
  return { ok: true };
}

function retentionUntil(now: Date, years: number): Date {
  const at = new Date(now.getTime());
  at.setUTCFullYear(at.getUTCFullYear() + years);
  return at;
}

/**
 * Step one of three. Validates, claims the sha256 and writes the row — and
 * writes **nothing** to the document store, because this runs inside the
 * caller's transaction (Ruling R4-8's discipline applied to the upload path).
 *
 * Ruling R4-3's refinement lives here: an existing import in status `failed`
 * means the bytes never landed, so the row is reset and reused rather than
 * refused. Anything else is a real duplicate and raises
 * `DuplicateImportError` carrying the id the user should be sent to.
 *
 * The reused row gets a **fresh** storage key, never the old one: the failed
 * attempt may have left a partial object behind, and reusing the key would
 * make a later read return truncated bytes that still parse.
 */
export function reserveImport(deps: UseCaseDeps) {
  return async (principal: Principal, input: ReserveImportInput): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.upload");
    const validation = validateUpload(input);
    if (!validation.ok) throw new InvalidInputError(validation.message);

    const sha256 = sha256Hex(input.bytes);
    const now = deps.clock.now();
    const storageKey = newStorageKey(principal.userId, now);

    const existing = await deps.imports.findBySha(principal.userId, sha256);
    if (existing && existing.status !== "failed") throw new DuplicateImportError(existing.id);
    if (existing) {
      const reset = await deps.imports.patch(principal.userId, existing.id, {
        status: "received",
        storageKey,
        error: null,
        scanStatus: "pending",
        scanner: null,
        scanSignature: null,
        scannedAt: null,
      });
      if (!reset) throw new NotFoundError();
      await deps.audit({
        actorUserId: principal.userId,
        action: "payroll.import_reserved",
        entityType: "payroll_import",
        entityId: reset.id,
        after: { sha256, sizeBytes: input.bytes.byteLength, fileName: input.fileName },
      });
      return reset;
    }

    let created: PayrollImport;
    try {
      created = await deps.imports.create({
        userId: principal.userId,
        fileName: input.fileName,
        mime: input.mime,
        sizeBytes: input.bytes.byteLength,
        sha256,
        storageProvider: input.storageProvider,
        storageKey,
        idempotencyKey: input.idempotencyKey ?? null,
        replacesImportId: input.replacesImportId ?? null,
        retentionUntil: retentionUntil(now, input.retentionYears ?? DEFAULT_RETENTION_YEARS),
        uploadedVia: input.uploadedVia ?? "ui",
      });
    } catch (err) {
      // Ruling R4-3: a concurrent upload of the same bytes can win the race
      // between this request's `findBySha` miss (above) and this `create` —
      // the `payroll_imports_user_sha_uq` index then rejects this insert
      // rather than letting two rows exist. The database-level race is
      // already closed (no duplicate row can ever exist); what's left is to
      // make the loser see the same `DuplicateImportError` the pre-check
      // path throws, instead of a raw unique-violation escaping.
      const cause = (err as { cause?: { message?: string } }).cause?.message;
      if (cause?.includes("payroll_imports_user_sha_uq")) {
        const winner = await deps.imports.findBySha(principal.userId, sha256);
        if (winner) throw new DuplicateImportError(winner.id);
      }
      throw err;
    }
    // The audit records the digest and the size, never a byte of the payslip
    // (global constraint: an audit row records the import id and a sha256).
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_reserved",
      entityType: "payroll_import",
      entityId: created.id,
      after: { sha256, sizeBytes: input.bytes.byteLength, fileName: input.fileName },
    });
    return created;
  };
}

/** Step three: the bytes are in the store, so the import may enter the pipeline. */
export function markUploaded(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.upload");
    const updated = await deps.imports.patch(principal.userId, importId, { status: "scanning", error: null });
    if (!updated) throw new NotFoundError();
    return updated;
  };
}

/**
 * The failure branch of step three. Clears `storageKey` as well as recording
 * the reason: after a failed write nothing may claim to know where the bytes
 * are, and the retention job must never try to delete an object that was never
 * created.
 */
export function markUploadFailed(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, error: string): Promise<void> => {
    await deps.imports.patch(principal.userId, importId, { status: "failed", error, storageKey: null });
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_failed",
      entityType: "payroll_import",
      entityId: importId,
      after: { error },
    });
  };
}
