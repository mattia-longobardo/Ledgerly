// src/app/(app)/accounts/[id]/delete-actions.ts — the Server Actions of "Delete account": validate →
// use case (`delete.ts`) → revalidate, nothing else.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listAccounts } from "@ledgerly/domain/accounts";
import { requireSession } from "@/platform/auth/session";
import {
  accountDependents,
  DEPENDENT_KINDS,
  type Dependent,
  DeleteError,
  type DeleteErrorCode,
  deleteAccount,
  moveDependent,
} from "./delete";

type Failure = { ok: false; error: DeleteErrorCode | "failed" };

function failed(error: unknown): Failure {
  if (error instanceof DeleteError) return { ok: false, error: error.code };
  throw error;
}

/** What the dialog shows when it opens: what rests on the account, and where it can go. */
export async function accountDependentsAction(
  accountId: string,
): Promise<{ ok: true; dependents: Dependent[]; targets: { id: string; name: string }[] } | Failure> {
  const ctx = await requireSession();
  const id = z.uuid().safeParse(accountId);
  if (!id.success) return { ok: false, error: "not_found" };
  try {
    const dependents = await accountDependents(ctx, id.data);
    // Only when something has to move: the open accounts, without this one.
    const targets =
      dependents.length === 0
        ? []
        : (await listAccounts(ctx))
            .filter((account) => account.id !== id.data && account.state !== "archived")
            .map((account) => ({ id: account.id, name: account.name }));
    return { ok: true, dependents, targets };
  } catch (error) {
    return failed(error);
  }
}

const moveSchema = z.object({
  accountId: z.uuid(),
  kind: z.enum(DEPENDENT_KINDS),
  // A budget limit on the account alone has no category: its id is "".
  id: z.union([z.uuid(), z.literal("")]),
  to: z.uuid(),
});

export async function moveDependentAction(input: {
  accountId: string;
  kind: string;
  id: string;
  to: string;
}): Promise<{ ok: true } | Failure> {
  const ctx = await requireSession();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  try {
    await moveDependent(ctx, parsed.data.accountId, parsed.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath(`/accounts/${parsed.data.to}`);
  return { ok: true };
}

export async function deleteAccountAction(accountId: string): Promise<{ ok: true } | Failure> {
  const ctx = await requireSession();
  const id = z.uuid().safeParse(accountId);
  if (!id.success) return { ok: false, error: "not_found" };
  try {
    await deleteAccount(ctx, id.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  return { ok: true };
}
