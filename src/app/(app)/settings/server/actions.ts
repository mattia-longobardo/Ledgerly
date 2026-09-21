// src/app/(app)/settings/server/actions.ts — Admin › Server (spec §7.10), in F5 only its OpenAI
// fallback (plan F5 §3.6.6). Admins only; the key goes in and never comes back out.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redactForLog } from "@/platform/auth/logger";
import { requireAdmin } from "@/platform/auth/session";
import { BackupError, type BackupErrorCode, backupNow } from "@/platform/backup/service";
import { JOBS } from "@/platform/jobs/registry";
import { runJobByHand } from "@/platform/jobs/tick";
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

/* Maintenance (design rows 886–891) — plan F8 P4/P5. */

/** "Back up now" (design row 890): the real `pg_dump`, awaited, because an admin wants the size. */
export async function backupNowAction(): Promise<
  { ok: true; size: number } | { ok: false; error: BackupErrorCode }
> {
  const ctx = await requireAdmin();
  try {
    const result = await backupNow(ctx);
    revalidatePath("/settings/server");
    return { ok: true, size: result.bytes };
  } catch (error) {
    if (error instanceof BackupError) return { ok: false, error: error.code };
    console.error("[settings] the backup failed", redactForLog(error));
    return { ok: false, error: "dump_failed" };
  }
}

/**
 * Starts one job because an admin asked (spec §10.3). It answers as soon as the job has been
 * *started*, not when it finishes: "Export all data" gathers everybody's documents and a Server
 * Action that waited for it would time out. How it went is in `job_runs`, which is the record of
 * every run whoever asked for it.
 */
export async function runJobAction(name: string): Promise<ServerActionResult> {
  await requireAdmin();
  if (!JOBS.some((job) => job.name === name)) return { ok: false, error: "invalid" };
  after(async () => {
    try {
      await runJobByHand(name);
    } catch (error) {
      console.error(`[settings] the ${name} job failed`, redactForLog(error));
    }
  });
  return { ok: true };
}
