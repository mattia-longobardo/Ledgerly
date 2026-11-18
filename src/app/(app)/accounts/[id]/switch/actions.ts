// src/app/(app)/accounts/[id]/switch/actions.ts — the Server Actions of "move an account to the
// bank" (ux/n4-account-switch.md): thin wrappers around `switch.ts`, which answer a code of a closed
// list and never what a bank or a source said.
"use server";

import { revalidatePath } from "next/cache";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import { runAfterSync } from "@/platform/jobs/after-sync";
import { requestPresence } from "../../../banks/presence";
import {
  applySwitch,
  checkSwitch,
  type SwitchError,
  SwitchFailure,
  type SwitchReport,
  undoSwitch,
} from "./switch";

export type SwitchRefusal = { ok: false; error: SwitchError; retryAt: string | null };

function refusal(error: unknown): SwitchRefusal {
  if (error instanceof SwitchFailure) {
    return { ok: false, error: error.code, retryAt: error.retryAt?.toISOString() ?? null };
  }
  console.error("[accounts] a switch failed", redactForLog(error));
  return { ok: false, error: "failed", retryAt: null };
}

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
): Promise<{ ok: true; report: SwitchReport } | SwitchRefusal> {
  const ctx = await requireSession();
  try {
    return { ok: true, report: await checkSwitch(ctx, accountId, target, await requestPresence()) };
  } catch (error) {
    return refusal(error);
  }
}

/** "Apply" (§8): only with the print of the report the person read. */
export async function applySwitchAction(
  accountId: string,
  target: { connectionId: string; bankAccountId: string; fingerprint: string },
): Promise<{ ok: true; matched: number; transfers: number; fresh: number } | SwitchRefusal> {
  const ctx = await requireSession();
  try {
    const outcome = await applySwitch(ctx, accountId, target, await requestPresence());
    await runAfterSync("manual");
    revalidate(accountId);
    return { ok: true, ...outcome };
  } catch (error) {
    return refusal(error);
  }
}

/** "Undo switch" (§10). */
export async function undoSwitchAction(accountId: string): Promise<{ ok: true } | SwitchRefusal> {
  const ctx = await requireSession();
  try {
    await undoSwitch(ctx, accountId);
    await runAfterSync("manual");
    revalidate(accountId);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}
