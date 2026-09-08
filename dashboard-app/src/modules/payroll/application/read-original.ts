import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { UseCaseDeps } from "./ports";
import { ConflictError, NotFoundError } from "./errors";

export interface OriginalDocument {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
}

/**
 * The two DB-only halves of "serve payslip bytes back to a person" (spec
 * §7.8), split the same way Task 10 split scanning and parsing
 * (`beginScan`/`applyScanConclusion` in `ingest-import.ts`), and for the same
 * reason: `documents.get` is a network round trip, and `imports.get`/`audit`
 * only ever run inside a Postgres transaction opened by
 * `withUserContext` (RLS's `set_config(..., true)` is transaction-scoped —
 * see `platform/db/context.ts`). A function that did the DB read, the network
 * fetch and the audit write all through one `deps` would hold that
 * transaction open for the length of the document-store round trip, pinning
 * a pool connection the same way a 10 MB PUT would (Ruling R4-8's discipline,
 * applied here).
 *
 * Neither function in this file ever touches `deps.documents` — the
 * orchestrator (`infrastructure/read-original.ts`) is the only place that
 * does, strictly between the two, with no transaction open.
 */

export interface ReadOriginalReadiness {
  storageKey: string;
  mime: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Read-only half. Permission (Ruling R4-17), existence, and the two gates
 * that must clear before any byte is ever fetched: the scan boundary (Ruling
 * R4-2 — **never served before `scan_status = 'clean'`**) and retention
 * (Ruling R4-5 — a purged original is a `409` naming retention, not a `404`,
 * because the import plainly exists and the user is entitled to know why the
 * bytes do not). No I/O of its own.
 */
export function beginReadOriginal(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string): Promise<ReadOriginalReadiness> => {
    assertPermission(principal, "payroll.read_original");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.scanStatus !== "clean") {
      throw new ConflictError("This document has not cleared the malware scan.", "not_scanned");
    }
    if (found.storageKey === null) {
      throw new ConflictError("The original has been removed under the retention policy.", "purged");
    }
    return {
      storageKey: found.storageKey,
      mime: found.mime,
      fileName: found.fileName,
      sha256: found.sha256,
      sizeBytes: found.sizeBytes,
    };
  };
}

/**
 * Write-only half. The orchestrator calls this only after the bytes were
 * actually fetched — never on a `bytes_missing` conflict, which is not a
 * "read" that happened. Spec §3.2: sensitive reads are audited. The id and
 * the digest, never the bytes (global constraint: an audit row must not
 * become a second copy of the payslip). No I/O of its own.
 */
export function recordOriginalRead(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, meta: { sha256: string; sizeBytes: number }): Promise<void> => {
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.original_read",
      entityType: "payroll_import",
      entityId: importId,
      after: { sha256: meta.sha256, sizeBytes: meta.sizeBytes },
    });
  };
}
