import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { investmentAccounts } from "./schema";

/**
 * Which accounts Investments writes (docs/design/investments.md §1.3): from `managed_since` the
 * module is their only writer, and Accounts refuses a manual balance from that day on. Its own file
 * with no import of another module, so Accounts can ask without a cycle.
 */
export async function managedSince(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, CivilDate>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ accountId: investmentAccounts.accountId, managedSince: investmentAccounts.managedSince })
    .from(investmentAccounts)
    .where(
      and(userScoped(ctx).owns(investmentAccounts), inArray(investmentAccounts.accountId, [...accountIds])),
    );
  return new Map(rows.map((row) => [row.accountId, row.managedSince]));
}

/** `managed_since` of one account, `null` when Investments does not manage it. */
export async function managedSinceOf(ctx: Pick<Ctx, "userId">, accountId: string): Promise<CivilDate | null> {
  const [row] = await getDb()
    .select({ managedSince: investmentAccounts.managedSince })
    .from(investmentAccounts)
    .where(and(userScoped(ctx).owns(investmentAccounts), eq(investmentAccounts.accountId, accountId)));
  return row?.managedSince ?? null;
}
