import { isRealDate } from "@/lib/calc/leave-day";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

/**
 * Removes one day.
 *
 * Two outcomes, and the difference matters. The question the choice turns on is
 * "does Trek hold an entry for this date right now", and the only thing that
 * answers it is the `provider_links` row — NOT `origin`, which records where
 * the day came from historically and stays `'trek'` for ever afterwards. A day
 * Trek once owned and no longer does (the owner retyped it to `permits` and the
 * sync removed the entry upstream) has nothing left to push, and treating it as
 * if it did would stage a delete for something already gone.
 *
 * So: no link, no upstream counterpart, delete outright. A linked day is kept
 * as a tombstone with `pendingOp = 'delete'` — that row is the only record that
 * a removal still has to be carried upstream, and `clearPending` deletes it once
 * the push lands.
 *
 * Known narrow window, unchanged by this rule and older than it: the link is
 * written by the PULL half of a sync pass, so a day whose push landed and whose
 * pull then failed has no link for an entry Trek does hold. Removing it in that
 * gap deletes it here and leaves it there until the owner books it again. Closing
 * it means writing the link at push time, which needs the entry id Trek only
 * reports on the read — Phase 9 territory, with `withJobLock`.
 */
export function removeEvent(deps: UseCaseDeps) {
  return async (principal: Principal, date: string): Promise<void> => {
    assertPermission(principal, "timeoff.write");
    // Same guard as `setEvent`: a well-shaped but non-existent day
    // (`2026-02-31`) rolls over in `Date` and reaches Postgres as a cast
    // error — a client mistake surfacing as a 500 instead of a clean 4xx.
    if (!isRealDate(date)) throw new InvalidInputError("A day must be a real YYYY-MM-DD date.");
    const now = deps.clock.now();
    const existing = await deps.events.at(principal.userId, date);
    if (!existing) throw new NotFoundError();

    const heldByTrek = existing.trekEntryId !== null;
    if (!heldByTrek) await deps.events.deleteDates(principal.userId, [date]);
    else await deps.events.stageDelete(principal.userId, date, now);

    await deps.audit({
      actorUserId: principal.userId,
      action: "timeoff.event_removed",
      entityType: "timeoff_event",
      entityId: existing.id,
      before: {
        date: existing.date,
        fraction: existing.fraction,
        typeCode: existing.typeCode,
        origin: existing.origin,
      },
      after: { deleted: !heldByTrek, pendingOp: heldByTrek ? "delete" : null },
    });
  };
}
