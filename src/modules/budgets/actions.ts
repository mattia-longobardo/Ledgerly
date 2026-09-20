// src/modules/budgets/actions.ts — the Budgets Server Actions (spec §4.2): validate → service →
// revalidate. The limit arrives as typed text and becomes cents here, in the user's number format.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import type { BudgetScope } from "./rules";
import { BudgetError, setLimit, stopLimit } from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof BudgetError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/budgets");
  revalidatePath("/");
}

/** Sets the limit of a scope — category, account or both — from `month` (`AAAA-MM-01`) onwards. */
export async function setBudgetLimitAction(
  scope: BudgetScope,
  month: string,
  amount: string,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setLimit(ctx, {
      categoryId: scope.categoryId || null,
      accountId: scope.accountId || null,
      month,
      cents: parseAmount(amount, ctx.numberFormat),
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function stopBudgetAction(scope: BudgetScope, month: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await stopLimit(ctx, { categoryId: scope.categoryId || null, accountId: scope.accountId || null, month });
    revalidate();
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
