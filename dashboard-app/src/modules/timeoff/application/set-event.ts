import { isWeekendBlocked } from "@/lib/calc/leave-day";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { seedDefaultTypes } from "./ensure-default-types";
import { InvalidInputError } from "./errors";
import type { TimeoffCode, TimeoffEvent, UseCaseDeps } from "./ports";

export interface SetEventInput {
  date: string;
  fraction: "1.00" | "0.50";
  typeCode: TimeoffCode;
  note?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Books or changes one day.
 *
 * The write is always STAGED, never sent: `pendingOp = 'upsert'` is the whole
 * contract with the Trek sync, which is the only thing allowed to talk to the
 * provider. A day that Trek does not model (`permits`) is staged the same way
 * and simply never leaves — see `infrastructure/trek-diff.ts`.
 */
export function setEvent(deps: UseCaseDeps) {
  return async (principal: Principal, input: SetEventInput): Promise<TimeoffEvent> => {
    assertPermission(principal, "timeoff.write");
    if (!ISO_DATE.test(input.date)) throw new InvalidInputError("A day must be a YYYY-MM-DD date.");
    // Trek's own plan refuses weekends, so refusing them here saves a round
    // trip that could only ever come back `weekend_blocked`.
    if (isWeekendBlocked(input.date)) {
      throw new InvalidInputError("Time off cannot be booked on a Saturday or a Sunday.");
    }
    if (input.fraction !== "1.00" && input.fraction !== "0.50") {
      throw new InvalidInputError("A day is booked either whole (1.00) or half (0.50).");
    }

    const types = await seedDefaultTypes(
      deps.types,
      principal.userId,
      await deps.settings.hoursPerDay(),
    );
    const type = types.find((candidate) => candidate.code === input.typeCode);
    if (!type) throw new InvalidInputError(`No time off type "${input.typeCode}".`);

    const saved = await deps.events.stageUpsert(
      principal.userId,
      {
        date: input.date,
        fraction: input.fraction,
        typeId: type.id,
        note: input.note ?? null,
      },
      deps.clock.now(),
    );

    await deps.audit({
      actorUserId: principal.userId,
      action: "timeoff.event_set",
      entityType: "timeoff_event",
      entityId: saved.id,
      after: {
        date: saved.date,
        fraction: saved.fraction,
        typeCode: saved.typeCode,
        pendingOp: saved.pendingOp,
      },
    });

    return saved;
  };
}
