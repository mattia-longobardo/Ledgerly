// src/app/(app)/settings/server/actions.ts — Admin › Server (spec §7.10), in F5 only its OpenAI
// fallback (plan F5 §3.6.6). Admins only; the key goes in and never comes back out.
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/platform/auth/session";
import type { LlmProbeResult } from "@/platform/settings/llm-probe";
import type { OidcInput } from "@/platform/settings/oidc";
import type { OidcProbeOutcome } from "@/platform/settings/oidc-probe";
import {
  type MailProbeResult,
  removeLlmFallback,
  removeOidc,
  removeSmtp,
  saveLlmFallback,
  saveOidc,
  saveSmtp,
  sendTestEmail,
  SettingsError,
  testLlmFallback,
  testOidc,
} from "@/platform/settings/service";
import type { SmtpInput } from "@/platform/settings/smtp";

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

/**
 * Tries the saved key and model against OpenAI and says what came back, as a message key. The
 * request is made here, on the server: the key never reaches the browser, and what comes back
 * carries neither the key nor OpenAI's answer body (spec §5.4, §9.4). It saves nothing.
 */
export async function testLlmFallbackAction(): Promise<LlmProbeResult> {
  const ctx = await requireAdmin();
  return await testLlmFallback(ctx);
}

export async function removeLlmFallbackAction(): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  await removeLlmFallback(ctx);
  revalidatePath("/settings/server");
  return { ok: true };
}

/* Authentik and SMTP (spec §5.1, §9.4) — plan F8 P0. */

export type OidcSaveResult =
  { ok: true; signedEveryoneOut: boolean } | { ok: false; error: "invalid" | "forbidden" };

export async function saveOidcAction(input: OidcInput): Promise<OidcSaveResult> {
  const ctx = await requireAdmin();
  let signedEveryoneOut: boolean;
  try {
    ({ signedEveryoneOut } = await saveOidc(ctx, input));
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, error: error.code };
    throw error;
  }
  revalidatePath("/settings/server");
  return { ok: true, signedEveryoneOut };
}

/**
 * Reads the discovery document of the saved provider and records the verdict. Nothing the provider
 * answered comes back — only a message key (spec §5.4).
 */
export async function testOidcAction(): Promise<OidcProbeOutcome> {
  const ctx = await requireAdmin();
  const result = await testOidc(ctx);
  revalidatePath("/settings/server");
  return result.outcome;
}

export async function removeOidcAction(): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  await removeOidc(ctx);
  revalidatePath("/settings/server");
  return { ok: true };
}

export async function saveSmtpAction(input: SmtpInput): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  try {
    await saveSmtp(ctx, input);
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, error: error.code };
    throw error;
  }
  revalidatePath("/settings/server");
  return { ok: true };
}

export async function removeSmtpAction(): Promise<ServerActionResult> {
  const ctx = await requireAdmin();
  await removeSmtp(ctx);
  revalidatePath("/settings/server");
  return { ok: true };
}

/** Sends one email to the admin who asked, through the transport exactly as it is saved. */
export async function sendTestEmailAction(): Promise<MailProbeResult> {
  const ctx = await requireAdmin();
  return await sendTestEmail(ctx);
}
