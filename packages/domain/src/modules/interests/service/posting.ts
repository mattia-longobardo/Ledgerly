// What is left of publishing a settlement on the source (spec §7.6): nothing is published any more
// (decision H37, ST-14, release R5c). A settlement keeps the state it had, and one left unsure can
// still be marked as posted by the person who checked the source. A rule in `credit_account` has
// each settlement written as a movement on its manual account: the application writes it
// (`app/(app)/interests/credit.ts`), this file says which and records that it is done.
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { PostingState } from "../rules";
import { interestEntries, interestRules } from "../schema";
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

/** A settlement to write as a movement: its id is the movement's idempotency key. */
interface SettlementCredit {
  entryId: string;
  accountId: string;
  categoryId: string | null;
  payeeMatch: string | null;
  netCents: bigint;
  settleOn: string;
}

type CreditWriter = (ctx: Pick<Ctx, "userId" | "timeZone">, credit: SettlementCredit) => Promise<void>;
let writer: CreditWriter | null = null;

/**
 * How a settlement becomes a movement: the application registers it (`app/interest-credit.ts`), as
 * this module must not import transactions. Unregistered, nothing is credited and the settlements wait.
 */
export function registerCreditWriter(write: CreditWriter): void {
  writer = write;
}

/**
 * Writes each settlement of a `credit_account` rule not written yet, oldest first, then marks it
 * posted. The writer must be idempotent on `entryId`: a pass that stops between the two writes the
 * same movement once on the next pass. A zero net writes nothing. Returns how many it wrote.
 */
export async function creditSettlements(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  ruleId: string,
  now: Date = new Date(),
): Promise<number> {
  if (writer === null) return 0;
  const due = await getDb()
    .select({
      entryId: interestEntries.id,
      accountId: interestRules.accountId,
      categoryId: interestRules.postingCategoryId,
      payeeMatch: interestRules.payeeMatch,
      netCents: interestEntries.netCents,
      settleOn: interestEntries.settleOn,
    })
    .from(interestEntries)
    .innerJoin(interestRules, eq(interestRules.id, interestEntries.ruleId))
    .where(
      and(
        eq(interestEntries.ruleId, ruleId),
        userScoped(ctx).owns(interestEntries),
        eq(interestRules.mode, "credit_account"),
        eq(interestEntries.posting, "none"),
        gt(interestEntries.netCents, 0n),
      ),
    )
    .orderBy(asc(interestEntries.periodFrom));
  for (const credit of due) {
    await writer(ctx, credit);
    await getDb()
      .update(interestEntries)
      .set({ posting: "posted", postedAt: now, postingError: null })
      .where(
        and(
          eq(interestEntries.id, credit.entryId),
          userScoped(ctx).owns(interestEntries),
          eq(interestEntries.posting, "none"),
        ),
      );
  }
  return due.length;
}
