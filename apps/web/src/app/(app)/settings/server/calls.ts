// The calls of Admin › Server to `/api/v1/server` (rewrite plan R3): each answers what the Server
// Action it replaces answered, so a card reads one shape whatever sent it. A secret goes in and never
// comes back: the view the cards read carries a hint, never the value.
import { server } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

type SaveResult = { ok: true } | { ok: false; error: "invalid" | "forbidden" };

/** A setting the API refused: `invalid` or `forbidden`, as the use case named it; anything else is thrown. */
function refusedSetting(error: unknown): { ok: false; error: "invalid" | "forbidden" } {
  if (error instanceof ApiError && (error.code === "invalid" || error.code === "forbidden")) {
    return { ok: false, error: error.code };
  }
  throw error;
}

/** Saves a setting, then reads the settings again. */
async function saving<T extends object>(
  work: () => Promise<T>,
): Promise<({ ok: true } & T) | { ok: false; error: "invalid" | "forbidden" }> {
  try {
    const answer = await work();
    invalidate(server.getServerSettings);
    return { ok: true, ...answer };
  } catch (error) {
    return refusedSetting(error);
  }
}

/** Removes a setting, then reads the settings again. */
async function removing(work: () => Promise<unknown>): Promise<SaveResult> {
  await work();
  invalidate(server.getServerSettings);
  return { ok: true };
}

export function saveLlmFallbackAction(model: string, apiKey: string): Promise<SaveResult> {
  return saving(async () => {
    await call(server.saveLlm, { body: { model, apiKey } });
    return {};
  });
}

/** Tries the saved key and model; the verdict is a message key, never the key nor OpenAI's words. */
export async function testLlmFallbackAction() {
  const { outcome, model } = await call(server.testLlm, {});
  return outcome === "ok" ? { outcome, model: model ?? "" } : { outcome };
}

export function removeLlmFallbackAction(): Promise<SaveResult> {
  return removing(() => call(server.removeLlm, {}));
}

export function saveOidcAction(input: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  adminGroup: string;
}): Promise<{ ok: true; signedEveryoneOut: boolean } | { ok: false; error: "invalid" | "forbidden" }> {
  return saving(() => call(server.saveOidc, { body: input }));
}

/** Reads the discovery document of the saved provider; the verdict is recorded, and shown again. */
export async function testOidcAction() {
  const { outcome } = await call(server.testOidc, {});
  invalidate(server.getServerSettings);
  return outcome;
}

export function removeOidcAction(): Promise<SaveResult> {
  return removing(() => call(server.removeOidc, {}));
}

export function saveSmtpAction(input: {
  host: string;
  port: number;
  encryption: "ssl" | "starttls" | "none";
  user: string;
  password: string;
  from: string;
  invitations: boolean;
  syncAlerts: boolean;
  monthlySummary: boolean;
}): Promise<SaveResult> {
  return saving(async () => {
    await call(server.saveSmtp, { body: input });
    return {};
  });
}

export function removeSmtpAction(): Promise<SaveResult> {
  return removing(() => call(server.removeSmtp, {}));
}

/** Sends one email to the admin who asked, through the transport exactly as it is saved. */
export async function sendTestEmailAction() {
  const { outcome, to, reason } = await call(server.testSmtp, {});
  if (outcome === "ok") return { outcome, to: to ?? "" };
  if (outcome === "failed") return { outcome, reason: reason ?? "UNKNOWN" };
  return { outcome };
}

type BackupCode = "forbidden" | "dump_failed" | "too_large" | "upload_failed";
const BACKUP_CODES: readonly BackupCode[] = ["forbidden", "dump_failed", "too_large", "upload_failed"];
const isBackupCode = (code: string): code is BackupCode => BACKUP_CODES.some((known) => known === code);

/** "Back up now": the real dump, awaited, because an admin wants the size. A failure the API did not name is a failed dump. */
export async function backupNowAction(): Promise<
  { ok: true; size: number } | { ok: false; error: BackupCode }
> {
  try {
    const { size } = await call(server.backUpNow, {});
    invalidate(server.getServerSettings);
    return { ok: true, size };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const code = error.reason ?? error.code;
    return { ok: false, error: isBackupCode(code) ? code : "dump_failed" };
  }
}

/** Puts one job in the worker's queue; how it went is in the job's last run. */
export async function runJobAction(name: string): Promise<SaveResult> {
  try {
    await call(server.runJob, { params: { name } });
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") return { ok: false, error: "invalid" };
    throw error;
  }
  invalidate(server.listJobs, server.getServerSettings);
  return { ok: true };
}
