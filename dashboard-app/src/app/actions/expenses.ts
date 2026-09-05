"use server";

import { revalidatePath } from "next/cache";
import type { Transaction } from "@/modules/expenses/domain/transaction";
import { NotFoundError, VersionMismatchError } from "@/modules/expenses/application/errors";
import { updateTransaction, type UpdateTransactionInput } from "@/modules/expenses/application/update-transaction";
import { runForPrincipal } from "@/modules/expenses/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

/**
 * The one place every expenses action turns a thrown error into copy the
 * transaction detail page can show, mirroring `app/actions/accounts.ts`.
 */
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change transactions.";
  if (err instanceof VersionMismatchError) return "This transaction changed in the meantime. Reload and try again.";
  if (err instanceof NotFoundError) return "This transaction no longer exists.";
  return errorMessage(err);
}

export async function updateTransactionAction(formData: FormData): Promise<ActionResult<Transaction>> {
  const id = text(formData.get("id")) ?? "";
  const version = Number(text(formData.get("version")) ?? "0");
  const patch: UpdateTransactionInput = {
    categoryId: formData.has("categoryId") ? text(formData.get("categoryId")) : undefined,
    note: formData.has("note") ? text(formData.get("note")) : undefined,
  };

  try {
    const updated = await runForPrincipal((deps, principal) =>
      updateTransaction(deps)(principal, id, version, patch),
    );
    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${id}`);
    return succeed(updated);
  } catch (err) {
    return fail(mapError(err));
  }
}
