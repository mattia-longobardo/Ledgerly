import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError } from "./errors";
import type { TimeoffEvent, UseCaseDeps } from "./ports";

export interface ListEventsInput {
  from: string;
  to: string;
}

/**
 * Every booked day in a closed date range, `date asc`.
 *
 * A thin read, but it is a use case rather than a repository call from the
 * route for the reason every other module's reads are: the permission check
 * and the range validation belong on this side of the API boundary, where the
 * server actions and any future loader reach them too.
 */
export function listEvents(deps: UseCaseDeps) {
  return async (principal: Principal, input: ListEventsInput): Promise<TimeoffEvent[]> => {
    assertPermission(principal, "timeoff.read");
    if (input.from > input.to) throw new InvalidInputError("`from` must not be after `to`.");
    return deps.events.inRange(principal.userId, input.from, input.to);
  };
}
