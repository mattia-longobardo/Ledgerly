import { db } from "@/lib/db";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { PURGE_BATCH, purgeOne, type PurgeResult } from "../application/purge-expired-originals";
import type { DocumentStore } from "../application/ports";
import { payrollDeps } from "./deps";
import { noopScanner } from "./noop-scanner";
import { resolveDocumentStore } from "./document-store-resolver";

export { PURGE_BATCH };
export type { PurgeResult };

function unreachableStore(caller: string): DocumentStore {
  const boom = async () => {
    throw new Error(`${caller} must never touch the document store`);
  };
  return { provider: "local", put: boom, get: boom, delete: boom, listPrefix: async () => [] };
}

export interface PurgeExpiredOriginalsOptions {
  /**
   * Injected by the integration suite — to make one specific key's delete
   * fail without touching the real store, or to avoid resolving a live store
   * per user in a fixture. Defaults to `resolveDocumentStore(item.userId)`,
   * called once per item because the driver's credentials are per-user under
   * the silo provider (Ruling R4-1).
   */
  documents?: DocumentStore;
}

/**
 * The job body Task 14 schedules on the daily tier (Ruling R4-5). Follows
 * `src/lib/jobs/interest-accrual.ts`'s shape for a cross-user batch: one
 * short `withSystemContext` transaction reads the batch, then each item's
 * actual work — the network delete and the DB write that follows it — is
 * written as its own short transaction, opened and closed per item, never
 * shared with the batch read or with any other item.
 *
 * That holds when `payroll-retention.ts` (the job) calls it too: `withJobLock`
 * takes a *session*-level advisory lock on a client of its own and runs this
 * function with no transaction open on it (Ruling R9-1), so the per-item
 * transactions below really are per-item and the sequential network deletes
 * do not sit inside a held-open transaction.
 *
 * What actually makes an interrupted or retried run safe is idempotency, not
 * transaction isolation: `listPurgeableForAllUsers` never selects a row
 * whose `storage_key` is already null, so a half-finished run (or a retried
 * failure) resumes cleanly. One item's failure (a delete that throws, a
 * store that is not configured for that user, a write that fails) is caught,
 * counted in `failed`, and the loop moves on — the row keeps its
 * `storage_key`, so the next run retries it, and it cannot jam any other
 * user's purge for the day. Capped at `PURGE_BATCH` per run so a
 * misconfigured retention window cannot wipe the archive in one tick.
 */
export async function purgeExpiredOriginals(
  now: Date,
  limit: number = PURGE_BATCH,
  opts: PurgeExpiredOriginalsOptions = {},
): Promise<PurgeResult> {
  const due = await withSystemContext(db, (tx) =>
    payrollDeps(tx, { documents: unreachableStore("purgeExpiredOriginals' batch read"), scanner: noopScanner }).imports.listPurgeableForAllUsers(
      now,
      limit,
    ),
  );

  let purged = 0;
  let failed = 0;
  for (const item of due) {
    try {
      const store = opts.documents ?? (await resolveDocumentStore(item.userId))?.store;
      if (!store) throw new Error(`no payroll document store is configured for user ${item.userId}`);
      // I/O — no transaction open.
      await store.delete(item.storageKey!);
      // A fresh, short transaction for this one item's write only.
      await withUserContext(db, { userId: item.userId, role: "system" }, (tx) =>
        purgeOne(payrollDeps(tx, { documents: store, scanner: noopScanner }))(item, now),
      );
      purged += 1;
    } catch {
      // Counted, not thrown. The key stays on the row, so the next run tries
      // again; an unreachable store or a failed write must not stop the rest
      // of the batch.
      failed += 1;
    }
  }
  return { considered: due.length, purged, failed };
}
