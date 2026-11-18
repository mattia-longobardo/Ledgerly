// src/app/(app)/settings/integrations/plugin-actions.ts — the plugin of a person and the section
// "Banks" (ux/n1-plugin-bank.md §2-§5). Thin wrappers: the rules are in `platform/plugins`.
//
// Every action is the signed-in person's own. None returns a credential: a result is `ok` or a
// code, so there is no field a key could travel in.
"use server";

import { revalidatePath } from "next/cache";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import { runAfterSync } from "@/platform/jobs/after-sync";
import { readBank } from "@ledgerly/plugin-host";
import { requestPresence } from "../../banks/presence";
import { bankSink } from "../../banks/sink";
import { formatInstant } from "./format-instant";
import {
  disconnectBank,
  type PluginActionCode,
  PluginActionError,
  removeUserCredentials,
  saveUserCredentials,
  setPluginActive,
} from "@ledgerly/plugin-host";

export type PluginActionResult = { ok: true } | { ok: false; error: PluginActionCode };

/** Runs one service call and turns its refusal into a code; anything else is `failed`, logged redacted. */
async function attempt(work: () => Promise<void>): Promise<PluginActionResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof PluginActionError) return { ok: false, error: error.code };
    console.error("[plugins] an action failed", redactForLog(error));
    return { ok: false, error: "failed" };
  }
  revalidatePath("/settings/integrations", "layout");
  return { ok: true };
}

export async function setPluginActiveAction(pluginId: string, active: boolean): Promise<PluginActionResult> {
  const ctx = await requireSession();
  return attempt(() => setPluginActive(ctx, { pluginId, active }));
}

const MAX_KEY_FILE_BYTES = 16_384;

/**
 * Checks and saves the credentials of the form (§4.1, §4.2). The key comes as text or as a file;
 * with both, the file wins. The file is read here, on the server: the browser never reads it.
 */
export async function saveBankCredentialsAction(
  pluginId: string,
  form: FormData,
): Promise<PluginActionResult> {
  const ctx = await requireSession();
  const file = form.get("keyFile");
  const typed = form.get("privateKey");
  let privateKey = typeof typed === "string" ? typed : "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_KEY_FILE_BYTES) return { ok: false, error: "key_format" };
    privateKey = await file.text();
  }
  const applicationId = form.get("applicationId");
  return attempt(() =>
    saveUserCredentials(ctx, {
      pluginId,
      applicationId: typeof applicationId === "string" ? applicationId : "",
      privateKey,
    }),
  );
}

export async function removeBankCredentialsAction(pluginId: string): Promise<PluginActionResult> {
  const ctx = await requireSession();
  return attempt(() => removeUserCredentials(ctx, pluginId));
}

export async function disconnectBankAction(
  pluginId: string,
  connectionId: string,
): Promise<PluginActionResult> {
  const ctx = await requireSession();
  return attempt(() => disconnectBank(ctx, { pluginId, connectionId }));
}

/** What "Sync now" answers: how many movements are new, or why nothing was read and until when. */
export type SyncNowResult =
  { ok: true; created: number } | { ok: false; error: string; retryAt: string | null };

/**
 * "Sync now" for one bank (§5.2): a reading the person asked for, so the bank is told they are
 * there. The jobs that read the movements run after it, as after any sync that changed them.
 */
export async function syncBankNowAction(pluginId: string, connectionId: string): Promise<SyncNowResult> {
  const ctx = await requireSession();
  try {
    const outcome = await readBank(
      ctx,
      { pluginId, connectionId, presence: await requestPresence() },
      bankSink,
    );
    revalidatePath("/settings/integrations", "layout");
    if (!outcome.ok) {
      return {
        ok: false,
        error: outcome.error,
        retryAt: outcome.retryAt ? formatInstant(outcome.retryAt, ctx) : null,
      };
    }
    if (outcome.created + outcome.updated > 0) await runAfterSync("manual");
    return { ok: true, created: outcome.created };
  } catch (error) {
    if (error instanceof PluginActionError) return { ok: false, error: error.code, retryAt: null };
    console.error("[plugins] a reading failed", redactForLog(error));
    return { ok: false, error: "failed", retryAt: null };
  }
}
