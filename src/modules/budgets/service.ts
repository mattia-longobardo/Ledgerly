import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import { getCategory, TaxonomyError } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import type { MonthKey } from "@/platform/dates";
import { getDb, type Tx } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  type AlertSettings,
  type BudgetScope,
  saveAlertsSchema,
  setLimitSchema,
  stopLimitSchema,
} from "./rules";
import { budgetAlerts, budgetLimits } from "./schema";

export type BudgetErrorCode = "not_found" | "invalid" | "conflict";

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
        accountId: parsed.accountId,
        fromMonth: parsed.month,
        amountCents: null,
        stopped: true,
      }),
    );
  });
}

/**
 * When a budget emails its owner (one row per scope, written whole). Saved for a scope that has no
 * limit too: the setting outlives a budget stopped for a month and taken up again.
 */
export async function saveAlerts(
  ctx: Pick<Ctx, "userId">,
  input: BudgetScope & AlertSettings,
): Promise<AlertSettings> {
  const parsed = saveAlertsSchema.parse(input);
  await requireScope(ctx, parsed);
  await getDb()
    .insert(budgetAlerts)
    .values(
      userScoped(ctx).stamp({
        categoryId: parsed.categoryId,
        accountId: parsed.accountId,
        enabled: parsed.enabled,
        thresholds: parsed.thresholds,
      }),
    )
    .onConflictDoUpdate({
      target: [budgetAlerts.userId, budgetAlerts.categoryId, budgetAlerts.accountId],
      set: { enabled: parsed.enabled, thresholds: parsed.thresholds, updatedAt: new Date() },
    });
  return { enabled: parsed.enabled, thresholds: parsed.thresholds };
}

/**
 * The limits of two categories that become one (rewrite plan N3; ux/n3-categories-manual.md §6.3,
 * decision H35 point 7): from `month` on, the category that stays has the sum of the two limits,
 * scope by scope — the budget on the category and each budget on the category and an account —
 * and the other has none. The months before keep what they had. Inside the caller's transaction,
 * with the merge of the categories. Returns how many limits were summed.
 */
export async function mergeLimits(
  ctx: Pick<Ctx, "userId">,
  input: { keepId: string; dropId: string; month: MonthKey },
  tx: Tx,
): Promise<number> {
  const rows = await tx
    .select()
    .from(budgetLimits)
    .where(
      and(
        userScoped(ctx).owns(budgetLimits),
        inArray(budgetLimits.categoryId, [input.keepId, input.dropId]),
        lte(budgetLimits.fromMonth, input.month),
      ),
    )
    .orderBy(asc(budgetLimits.fromMonth), asc(budgetLimits.id));
  /** The limit in force in `month` for a category and an account: the latest version, if not stopped. */
  const inForce = (categoryId: string, accountId: string | null): Cents | null => {
    const last = rows.filter((row) => row.categoryId === categoryId && row.accountId === accountId).at(-1);
    return last && !last.stopped ? last.amountCents : null;
  };
  const scopes = [
    ...new Set(rows.filter((row) => row.categoryId === input.dropId).map((row) => row.accountId)),
  ];
  let summed = 0;
  for (const accountId of scopes) {
    const dropped = inForce(input.dropId, accountId);
    if (dropped === null) continue;
    const kept = inForce(input.keepId, accountId) ?? 0n;
    for (const categoryId of [input.keepId, input.dropId]) {
      await tx
        .delete(budgetLimits)
        .where(and(sameScope(ctx, { categoryId, accountId }), gte(budgetLimits.fromMonth, input.month)));
    }
    await tx.insert(budgetLimits).values([
      userScoped(ctx).stamp({
        categoryId: input.keepId,
        accountId,
        fromMonth: input.month,
        amountCents: kept + dropped,
        stopped: false,
      }),
      userScoped(ctx).stamp({
        categoryId: input.dropId,
        accountId,
        fromMonth: input.month,
        amountCents: null,
        stopped: true,
      }),
    ]);
    summed += 1;
  }
  return summed;
}

/** The limits of some categories from `month` on, as they are: what `restoreLimits` puts back. */
export interface LimitsSnapshot {
  month: MonthKey;
  categoryIds: string[];
  rows: {
    categoryId: string;
    accountId: string | null;
    fromMonth: string;
    /** In cents, as text: the snapshot is kept as JSON, which has no exact integer of this size. */
    amountCents: string | null;
    stopped: boolean;
  }[];
}

/**
 * Reads the limits of some categories from `month` on, before a change that sums them
 * (`mergeLimits`) and that a person may undo. Inside the caller's transaction.
 */
export async function limitsSnapshot(
  ctx: Pick<Ctx, "userId">,
  categoryIds: readonly string[],
  month: MonthKey,
  tx: Tx,
): Promise<LimitsSnapshot> {
  const rows = await tx
    .select()
    .from(budgetLimits)
    .where(
      and(
        userScoped(ctx).owns(budgetLimits),
        inArray(budgetLimits.categoryId, [...categoryIds]),
        gte(budgetLimits.fromMonth, month),
      ),
    )
    .orderBy(asc(budgetLimits.fromMonth), asc(budgetLimits.id));
  return {
    month,
    categoryIds: [...categoryIds],
    rows: rows.map((row) => ({
      categoryId: row.categoryId as string,
      accountId: row.accountId,
      fromMonth: row.fromMonth,
      amountCents: row.amountCents === null ? null : row.amountCents.toString(),
      stopped: row.stopped,
    })),
  };
}

/** Puts the limits of a snapshot back: what was written from its month on goes, what was there returns. */
export async function restoreLimits(
  ctx: Pick<Ctx, "userId">,
  snapshot: LimitsSnapshot,
  tx: Tx,
): Promise<void> {
  if (snapshot.categoryIds.length === 0) return;
  await tx
    .delete(budgetLimits)
    .where(
      and(
        userScoped(ctx).owns(budgetLimits),
        inArray(budgetLimits.categoryId, snapshot.categoryIds),
        gte(budgetLimits.fromMonth, snapshot.month),
      ),
    );
  if (snapshot.rows.length === 0) return;
  await tx.insert(budgetLimits).values(
    snapshot.rows.map((row) =>
      userScoped(ctx).stamp({
        categoryId: row.categoryId,
        accountId: row.accountId,
        fromMonth: row.fromMonth,
        amountCents: row.amountCents === null ? null : BigInt(row.amountCents),
        stopped: row.stopped,
      }),
    ),
  );
}

/** Whether each of some categories has a limit in force in `month`: what a merge says it will sum. */
export async function categoriesWithLimit(
  ctx: Pick<Ctx, "userId">,
  categoryIds: readonly string[],
  month: MonthKey,
): Promise<Set<string>> {
  if (categoryIds.length === 0) return new Set();
  const rows = await getDb()
    .select({
      categoryId: budgetLimits.categoryId,
      accountId: budgetLimits.accountId,
      stopped: budgetLimits.stopped,
    })
    .from(budgetLimits)
    .where(
      and(
        userScoped(ctx).owns(budgetLimits),
        inArray(budgetLimits.categoryId, [...categoryIds]),
        lte(budgetLimits.fromMonth, month),
      ),
    )
    .orderBy(asc(budgetLimits.fromMonth), asc(budgetLimits.id));
  const latest = new Map<string, { categoryId: string; stopped: boolean }>();
  for (const row of rows) {
    if (row.categoryId !== null)
      latest.set(`${row.categoryId}|${row.accountId ?? ""}`, {
        categoryId: row.categoryId,
        stopped: row.stopped,
      });
  }
  return new Set([...latest.values()].filter((one) => !one.stopped).map((one) => one.categoryId));
}

// ——— What rests on an account (PERS-419) ——————————————————————————————————————————————————————
// The deletion of an account lists these and moves each to another account first: the foreign key
// is `on delete no action`, so one left behind makes the deletion refuse.

/**
 * The budget limits on an account, one entry per scope: the account alone (`categoryId` null) or
 * the account with a category. A scope is one limit for the person, however many months it has.
 */
export async function limitsOnAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ categoryId: string | null; categoryName: string | null }[]> {
  const rows = await getDb()
    .selectDistinct({ categoryId: budgetLimits.categoryId })
    .from(budgetLimits)
    .where(and(userScoped(ctx).owns(budgetLimits), eq(budgetLimits.accountId, accountId)))
    .orderBy(asc(budgetLimits.categoryId));
  return Promise.all(
    rows.map(async ({ categoryId }) => {
      if (categoryId === null) return { categoryId, categoryName: null };
      try {
        return { categoryId, categoryName: (await getCategory(ctx, categoryId)).name };
      } catch (error) {
        if (error instanceof TaxonomyError) return { categoryId, categoryName: null };
        throw error;
      }
    }),
  );
}

/**
 * Every month of one scope moved to another account. `conflict` when that account already has a
 * limit of the same scope for one of those months: the two would be one row.
 */
export async function moveLimitsAccount(
  ctx: Pick<Ctx, "userId">,
  scope: { accountId: string; categoryId: string | null },
  accountId: string,
): Promise<void> {
  await requireScope(ctx, { categoryId: null, accountId });
  try {
    const moved = await getDb()
      .update(budgetLimits)
      .set({ accountId })
      .where(sameScope(ctx, scope))
      .returning({ id: budgetLimits.id });
    if (moved.length === 0) throw new BudgetError("not_found");
  } catch (error) {
    if (hasPgError(error, UNIQUE_VIOLATION)) throw new BudgetError("conflict");
    throw error;
  }
}
