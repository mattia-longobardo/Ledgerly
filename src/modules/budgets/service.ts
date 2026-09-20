import "server-only";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import { getCategory, TaxonomyError } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import type { MonthKey } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { type BudgetScope, setLimitSchema, stopLimitSchema } from "./rules";
import { budgetLimits } from "./schema";

export type BudgetErrorCode = "not_found" | "invalid";

export class BudgetError extends Error {
  constructor(readonly code: BudgetErrorCode) {
    super(code);
    this.name = "BudgetError";
  }
}

/**
 * A limit only goes on one of this user's spending categories and one of their open accounts
 * (spec §7.3, F3); a stranger's id is "not found", never a budget on someone else's data.
 */
async function requireScope(ctx: Pick<Ctx, "userId">, scope: BudgetScope): Promise<void> {
  if (scope.categoryId !== null) {
    try {
      const category = await getCategory(ctx, scope.categoryId);
      if (category.type !== "expense") throw new BudgetError("invalid");
    } catch (error) {
      if (error instanceof TaxonomyError) throw new BudgetError("not_found");
      throw error;
    }
  }
  if (scope.accountId !== null) {
    const account = await getAccount(ctx, scope.accountId);
    if (!account || account.state === "archived") throw new BudgetError("not_found");
  }
}

/** The rows of one scope: `null` compared as "none", which `=` alone would never match. */
function sameScope(ctx: Pick<Ctx, "userId">, scope: BudgetScope) {
  return and(
    userScoped(ctx).owns(budgetLimits),
    scope.categoryId === null
      ? isNull(budgetLimits.categoryId)
      : eq(budgetLimits.categoryId, scope.categoryId),
    scope.accountId === null ? isNull(budgetLimits.accountId) : eq(budgetLimits.accountId, scope.accountId),
  );
}

/**
 * A new version of a scope's limit from `month` onwards (spec §7.3). "Onwards" is taken
 * literally (plan F3 §3.6.2): versions already set for later months are replaced, so the amount
 * typed is the one every following month shows.
 */
export async function setLimit(
  ctx: Pick<Ctx, "userId">,
  input: BudgetScope & { month: MonthKey; cents: Cents },
): Promise<void> {
  const parsed = setLimitSchema.parse(input);
  await requireScope(ctx, parsed);
  await getDb().transaction(async (tx) => {
    await tx
      .delete(budgetLimits)
      .where(and(sameScope(ctx, parsed), gte(budgetLimits.fromMonth, parsed.month)));
    await tx.insert(budgetLimits).values(
      userScoped(ctx).stamp({
        categoryId: parsed.categoryId,
        accountId: parsed.accountId,
        fromMonth: parsed.month,
        amountCents: parsed.cents,
        stopped: false,
      }),
    );
  });
}

/**
 * Takes a scope's budget away from `month` onwards: every version from that month on goes, and
 * a `stopped` version is written only when an earlier limit would otherwise carry on — so a budget
 * removed in the month it began leaves nothing behind.
 */
export async function stopLimit(
  ctx: Pick<Ctx, "userId">,
  input: BudgetScope & { month: MonthKey },
): Promise<void> {
  const parsed = stopLimitSchema.parse(input);
  await requireScope(ctx, parsed);
  await getDb().transaction(async (tx) => {
    const scope = sameScope(ctx, parsed);
    await tx.delete(budgetLimits).where(and(scope, gte(budgetLimits.fromMonth, parsed.month)));
    const earlier = await tx
      .select({ id: budgetLimits.id })
      .from(budgetLimits)
      .where(and(scope, lt(budgetLimits.fromMonth, parsed.month), eq(budgetLimits.stopped, false)))
      .limit(1);
    if (earlier.length === 0) return;
    await tx.insert(budgetLimits).values(
      userScoped(ctx).stamp({
        categoryId: parsed.categoryId,
        fromMonth: parsed.month,
        amountCents: null,
        stopped: true,
      }),
    );
  });
}
