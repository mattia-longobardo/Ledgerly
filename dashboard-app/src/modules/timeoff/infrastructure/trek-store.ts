import type { DbClient } from "@/lib/db/client";
import { withUserContext } from "@/platform/db/context";
import type { EventsRepository, TimeoffStore, TypesRepository } from "../application/ports";
import { DrizzleEventsRepository } from "./drizzle-events-repository";
import { DrizzleTypesRepository } from "./drizzle-types-repository";

/**
 * The seam that keeps the Trek sync honest about transactions.
 *
 * A pass is read → push (network) → write → pull (network) → write. Each of
 * those database steps takes its own short `withUserContext`, and the network
 * calls happen between them, outside every transaction — the shared
 * conventions' rule, and the reason the sync cannot simply be handed a `tx`.
 */
export function drizzleTimeoffStore(db: DbClient): TimeoffStore {
  return {
    withEvents<T>(
      userId: string,
      fn: (events: EventsRepository, types: TypesRepository) => Promise<T>,
    ): Promise<T> {
      return withUserContext(db, { userId }, (tx) =>
        fn(new DrizzleEventsRepository(tx), new DrizzleTypesRepository(tx)));
    },
  };
}
