// src/app/(app)/settings/server/actions.ts — Admin › Server (spec §7.10), in F5 only its OpenAI
// fallback (plan F5 §3.6.6). Admins only; the key goes in and never comes back out.
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/platform/auth/session";
import { removeLlmFallback, saveLlmFallback, SettingsError } from "@/platform/settings/service";

export type ServerActionResult = { ok: true } | { ok: false; error: "invalid" | "forbidden" };

export async function saveLlmFallbackAction(model: string, apiKey: string): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  try {
    await saveLlmFallback(ctx, { model, apiKey });
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, error: error.code };
    throw error;
  }
  revalidatePath("/settings/server");
  return { ok: true };
}

export async function removeLlmFallbackAction(): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  await removeLlmFallback(ctx);
  revalidatePath("/settings/server");
  return { ok: true };
}
