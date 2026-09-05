import type { PayrollImport, UseCaseDeps } from "./ports";

/**
 * The per-run cap (Ruling R4-5). A misconfigured retention window cannot wipe
 * the archive in a single tick, and a human has a day to notice between runs.
 */
export const PURGE_BATCH = 100;

export interface PurgeResult {
  considered: number;
  purged: number;
  failed: number;
}

/**
 * The DB-only half of "purge one expired original" — the same split
 * `beginScan`/`applyScanConclusion` apply to the scan boundary, for the same
 * reason (Ruling R4-8's discipline): `documents.delete` is a network call,
 * and `imports.patch`/`audit` only ever run inside a Postgres transaction
 * (RLS's `set_config(..., true)` is transaction-scoped). Batching this
 * function's caller-side transaction across many items' deletes — one giant
 * transaction wrapping up to a hundred sequential network calls — is exactly
 * the pattern Task 10 was fixed to avoid, worse here because it is a batch
 * rather than a single call.
 *
 * The orchestrator (`infrastructure/purge-expired-originals.ts`) is the only
 * place that calls `documents.delete`, once per item, with no transaction
 * open, and calls this function afterwards in its own short transaction — so
 * one failed delete or write cannot leave a half-purged row: the object is
 * gone and `storage_key`/`purged_at` are the very next thing recorded, never
 * the other way around (an orphan row is tolerated by a re-run; a `storage_key`
 * pointing at nothing is not).
 *
 * Deletes **document bytes only** — this never touches a payroll record. The
 * provenance outlives the original, which is what lets a superseded payslip
 * still explain a figure in Earnings ten years later.
 */
export function purgeOne(deps: UseCaseDeps) {
  return async (item: Pick<PayrollImport, "id" | "userId" | "status" | "retentionUntil">, now: Date): Promise<void> => {
    await deps.imports.patch(item.userId, item.id, { storageKey: null, purgedAt: now });
    await deps.audit({
      actorUserId: null,
      action: "payroll.original_purged",
      entityType: "payroll_import",
      entityId: item.id,
      after: { retentionUntil: item.retentionUntil.toISOString(), status: item.status },
    });
  };
}
