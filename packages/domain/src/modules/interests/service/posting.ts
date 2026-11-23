// What is left of publishing a settlement on the source (spec §7.6): nothing is published any more
// (decision H37, ST-14, release R5c). A settlement keeps the state it had, and one left unsure can
// still be marked as posted by the person who checked the source.
import { and, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { PostingState } from "../rules";
import { interestEntries } from "../schema";
import { InterestError } from "./records";

type Who = Pick<Ctx, "userId">;

/**
 * "Publish" of a settlement: since R5c it publishes nothing and answers the state the settlement
 * has. With `ruleId`, only a settlement of that rule.
 */
export async function postEntry(
  ctx: Who,
  entryId: string,
  options: { ruleId?: string } = {},
): Promise<PostingState> {
  const [row] = await getDb()
    .select({ posting: interestEntries.posting })
    .from(interestEntries)
    .where(
      and(
        eq(interestEntries.id, entryId),
        userScoped(ctx).owns(interestEntries),
        options.ruleId === undefined ? undefined : eq(interestEntries.ruleId, options.ruleId),
      ),
    );
  if (!row) throw new InterestError("not_found");
  return row.posting;
}

/** "Mark as posted": the person checked the source and the record is there; one of `ruleId`'s. */
export async function markPosted(ctx: Who, ruleId: string, entryId: string): Promise<void> {
  const updated = await getDb()
    .update(interestEntries)
    .set({ posting: "posted", postedAt: new Date(), postingError: null })
    .where(
      and(
        eq(interestEntries.id, entryId),
        eq(interestEntries.ruleId, ruleId),
        userScoped(ctx).owns(interestEntries),
        inArray(interestEntries.posting, ["indeterminate"]),
      ),
    )
    .returning({ id: interestEntries.id });
  if (updated.length === 0) throw new InterestError("not_found");
}
