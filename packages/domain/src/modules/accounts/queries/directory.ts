// The accounts as other modules name and offer them (audit POC-7, BUD-7): one map of names, one
// list of choices, one check of «an open account of the person». The map and the list work on the
// accounts a view already read, so a view reads them once (G9: no query more per view).
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { accounts } from "../schema";

type Named = { id: string; name: string };

/** Each account's name by its id. */
export function accountNames(list: readonly Named[]): Map<string, string> {
  return new Map(list.map((account) => [account.id, account.name]));
}

/** What a picker offers: the open accounts, by id and name, in the order they came. */
export function accountOptions(list: readonly (Named & { state: string })[]): Named[] {
  return list
    .filter((account) => account.state !== "archived")
    .map((account) => ({ id: account.id, name: account.name }));
}

/** One of the person's accounts that is not archived; otherwise the caller's own refusal. */
export async function requireOpenAccount(
  ctx: Pick<Ctx, "userId">,
  id: string,
  refusal: () => Error,
): Promise<typeof accounts.$inferSelect> {
  const [account] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  if (!account || account.state === "archived") throw refusal();
  return account;
}
