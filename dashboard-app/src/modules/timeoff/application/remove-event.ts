import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

/**
 * Removes one day.
 *
 * Two outcomes, and the difference matters. A row the owner created here that
 * Trek has never seen (`origin 'manual'`, no `provider_links` entry) has no
 * upstream counterpart, so it is simply deleted. Anything Trek knows about is
 * kept as a tombstone with `pendingOp = 'delete'` — that row is the only
 * record that a removal still has to be carried upstream, and `clearPending`
 * deletes it once the push lands.
 */
export function removeEvent(deps: UseCaseDeps) {
  return async (principal: Principal, date: string): Promise<void> => {
    assertPermission(principal, "timeoff.write");
    const now = deps.clock.now();
    const existing = await deps.events.at(principal.userId, date);
    if (!existing) throw new NotFoundError();

    const neverSynced = existing.trekEntryId === null && existing.origin === "manual";
    if (neverSynced) await deps.events.deleteDates(principal.userId, [date]);
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
      after: { deleted: neverSynced, pendingOp: neverSynced ? null : "delete" },
    });
  };
}
