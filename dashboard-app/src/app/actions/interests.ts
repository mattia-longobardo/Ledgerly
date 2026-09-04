"use server";

import { revalidatePath } from "next/cache";
import { romeDate } from "@/lib/time";
import { createInterestRule, type CreateInterestRuleInput } from "@/modules/interests/application/create-interest-rule";
import type { InterestRule } from "@/modules/interests/application/ports";
import { runForPrincipal } from "@/modules/interests/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

/**
 * The one place every interests action turns a thrown error into copy the
 * page can show, mirroring `app/actions/expenses.ts`. `InvalidInputError`
 * (an out-of-range rate, an impossible date) is not special-cased — its own
 * `.message` is already the right thing to show, same as the API layer's
 * `toApiError` relies on.
 */
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to manage interest rules.";
  return errorMessage(err);
}

export async function createInterestRuleAction(formData: FormData): Promise<ActionResult<InterestRule>> {
  const input: CreateInterestRuleInput = {
    accountId: text(formData.get("accountId")) ?? "",
    annualRate: text(formData.get("annualRate")) ?? "0",
    taxRate: text(formData.get("taxRate")) ?? "0",
    dayCount: 365,
    effectiveFrom: text(formData.get("effectiveFrom")) ?? romeDate(),
  };
  try {
    const rule = await runForPrincipal((deps, principal) => createInterestRule(deps)(principal, input));
    revalidatePath("/finance/interests");
    return succeed(rule);
  } catch (err) {
    return fail(mapError(err));
  }
}
