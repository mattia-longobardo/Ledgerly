// src/modules/users/actions.ts — the users module's Server Actions (spec §3): validate → service → revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import type { TimeOffPreferences } from "@ledgerly/domain/users";
import { updateTimeOffPreferences } from "@ledgerly/domain/users";

/**
 * Every settings Server Action reports failure this way instead of throwing: a form calls it
 * inside a transition with no error boundary, so a Zod or provider error must not crash the page.
 * `error` is a catalogued message key under the calling component's own `next-intl` namespace.
 */
type ActionResult = { ok: true } | { ok: false; error: string };

/** Time off › Settings: the working day and the patron saint, each form on its own. */
export async function saveTimeOffPreferencesAction(input: TimeOffPreferences): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateTimeOffPreferences(ctx, input);
    revalidatePath("/timeoff", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
    throw error;
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  await requireSession();
  try {
    await (await getAuth()).api.revokeOtherSessions({ headers: await headers() });
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return revocationFailed(error);
  }
}

function revocationFailed(error: unknown): ActionResult {
  console.error("[users] session revocation failed", redactForLog(error));
  return { ok: false, error: "failed" };
}

/* Admin › Users (spec §7.10) — plan F8 P1. Admins only; every service re-checks that for itself. */
