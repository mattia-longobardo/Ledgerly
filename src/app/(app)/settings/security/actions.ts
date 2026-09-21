// src/app/(app)/settings/security/actions.ts — personal access tokens (spec §5.3). They are
// managed only with a session: nothing under /api/v1 can mint or revoke one.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import type { ExpiryChoice } from "@/platform/tokens/rules";
import { createToken, revokeToken, TokenError } from "@/platform/tokens/service";

export type TokenActionResult =
  { ok: true; token: string; prefix: string } | { ok: false; error: "invalid" | "not_found" };

/** Mints a token and hands its value back **once**: it is not stored and cannot be shown again. */
export async function createTokenAction(input: {
  name: string;
  scopes: string[];
  expiresInDays: ExpiryChoice;
}): Promise<TokenActionResult> {
  const ctx = await requireSession();
  try {
    const { view, token } = await createToken(ctx, input);
    revalidatePath("/settings/security");
    return { ok: true, token, prefix: view.prefix };
  } catch (error) {
    if (error instanceof TokenError) return { ok: false, error: error.code };
    throw error;
  }
}

export async function revokeTokenAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    await revokeToken(ctx, id);
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    if (error instanceof TokenError) return { ok: false, error: error.code };
    throw error;
  }
}
