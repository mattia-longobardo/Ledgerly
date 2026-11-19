// The archived accounts that double another account (decision H58): which open account an account
// repeats, and the rows that keep its movements out of the months. The rule is `isDoubleOf`
// (`switch-rules.ts`); `conditions` (`queries/filters.ts`) reads the table in every total.
import { and, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { addDays } from "../../../shared/dates";
import { duplicateAccounts } from "../schema";
import { isDoubleOf, matchDoubles, SWITCH_MATCH_MAX_DAYS } from "../switch-rules";
import { doubleMovements } from "../switching/doubles";
import { movementsToCompare } from "../switching/transfers";

type Who = Pick<Ctx, "userId" | "timeZone">;

/**
 * The first account of `candidates` whose movements hold every movement of `accountId`, or `null`.
 * The caller gives the open accounts in the order it prefers; the account itself is never one.
 */
export async function twinOf(
  ctx: Who,
  accountId: string,
  candidates: readonly string[],
): Promise<string | null> {
  const doubles = await doubleMovements(ctx, accountId);
  const account = { movements: doubles.movements.length, manual: doubles.manual };
  if (!isDoubleOf(account, { unmatched: [] })) return null;
  const days = doubles.movements.map((one) => one.day).sort();
  const from = addDays(days[0], -SWITCH_MATCH_MAX_DAYS);
  const to = addDays(days[days.length - 1], SWITCH_MATCH_MAX_DAYS);
  for (const candidate of candidates) {
    if (candidate === accountId) continue;
    const kept = await movementsToCompare(ctx, candidate, from, to);
    if (isDoubleOf(account, matchDoubles(doubles.movements, kept))) return candidate;
  }
  return null;
}

/** Records `accountId` as a double of `twinId`, or forgets it with `null`. */
export async function markDuplicate(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  twinId: string | null,
): Promise<void> {
  await getDb()
    .delete(duplicateAccounts)
    .where(and(userScoped(ctx).owns(duplicateAccounts), eq(duplicateAccounts.accountId, accountId)));
  if (twinId !== null) {
    await getDb()
      .insert(duplicateAccounts)
      .values(userScoped(ctx).stamp({ accountId, twinAccountId: twinId }));
  }
}

/** The twin of each of these accounts that is recorded as a double. */
export async function duplicatesOf(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ accountId: duplicateAccounts.accountId, twinId: duplicateAccounts.twinAccountId })
    .from(duplicateAccounts)
    .where(
      and(userScoped(ctx).owns(duplicateAccounts), inArray(duplicateAccounts.accountId, [...accountIds])),
    );
  return new Map(rows.map((row) => [row.accountId, row.twinId]));
}
