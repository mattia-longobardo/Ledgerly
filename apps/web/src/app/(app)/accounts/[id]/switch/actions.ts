// src/app/(app)/accounts/[id]/switch/actions.ts — the Server Actions of "move an account to the
// bank" (ux/n4-account-switch.md): the use cases of `../../api-cases.ts`, which `/api/v1` calls
// too. They answer a code of a closed list and never what a bank or a source said.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import { requestPresence } from "../../../banks/presence";
import { applySwitchOf, checkSwitchOf, undoSwitchOf } from "../../api-cases";

function revalidate(accountId: string) {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/expenses");
  revalidatePath("/settings/integrations");
  revalidatePath("/");
}

/** The dry run (§6): nothing is written but the normal update of the source of before. */
export async function checkSwitchAction(
  accountId: string,
  target: { connectionId: string; bankAccountId: string },
) {
  return checkSwitchOf(await requireSession(), accountId, target, await requestPresence());
}

/** "Apply" (§8): only with the print of the report the person read. */
export async function applySwitchAction(
  accountId: string,
  target: { connectionId: string; bankAccountId: string; fingerprint: string },
) {
  const outcome = await applySwitchOf(await requireSession(), accountId, target, await requestPresence());
  if (outcome.ok) revalidate(accountId);
  return outcome;
}

/** "Undo switch" (§10). */
export async function undoSwitchAction(accountId: string) {
  const outcome = await undoSwitchOf(await requireSession(), accountId);
  if (outcome.ok) revalidate(accountId);
  return outcome;
}
