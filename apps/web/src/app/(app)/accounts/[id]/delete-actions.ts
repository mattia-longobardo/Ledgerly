// src/app/(app)/accounts/[id]/delete-actions.ts — the Server Actions of "Delete account": the use
// cases of `../api-cases.ts`, which `/api/v1` calls too, then revalidate, nothing else.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import { deleteAccountOf, dependentsOf, moveDependentOf } from "../api-cases";

/** What the dialog shows when it opens: what rests on the account, and where it can go. */
export async function accountDependentsAction(accountId: string) {
  return dependentsOf(await requireSession(), accountId);
}

export async function moveDependentAction(input: {
  accountId: string;
  kind: string;
  id: string;
  to: string;
}) {
  const outcome = await moveDependentOf(await requireSession(), input);
  if (!outcome.ok) return outcome;
  revalidatePath(`/accounts/${outcome.accountId}`);
  revalidatePath(`/accounts/${outcome.to}`);
  return { ok: true as const };
}

export async function deleteAccountAction(accountId: string) {
  const outcome = await deleteAccountOf(await requireSession(), accountId);
  if (!outcome.ok) return outcome;
  revalidatePath("/accounts");
  revalidatePath("/");
  return outcome;
}
