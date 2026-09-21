import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { invalidateAuth } from "@/platform/auth/auth";
import { testEmail } from "@/platform/auth/emails";
import { redactForLog } from "@/platform/auth/logger";
import { sessions, users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { openJson, sealJson } from "@/platform/crypto";
import { getDb } from "@/platform/db/client";
import { invalidateMailTransport, sendMail } from "@/platform/mail";
import {
  keyRing,
  LLM_FALLBACK,
  OIDC_PROBE,
  OIDC_PROVIDER,
  oidcConfig,
  readSetting,
  SMTP_TRANSPORT,
  smtpConfig,
} from "./config";
import { type LlmProbeResult, probeLlmFallback } from "./llm-probe";
import { discoveryUrlFor, issuerChanged, oidcInputSchema } from "./oidc";
import { type OidcProbeOutcome, type OidcProbeResult, probeOidc } from "./oidc-probe";
import { appSettings } from "./schema";
import { type MailPolicy, mailPolicyFrom, smtpInputSchema } from "./smtp";

export { LLM_FALLBACK } from "./config";

export class SettingsError extends Error {
  constructor(readonly code: "forbidden" | "invalid") {
    super(code);
    this.name = "SettingsError";
  }
}

function requireAdminCtx(ctx: Pick<Ctx, "role">): void {
  if (ctx.role !== "admin") throw new SettingsError("forbidden");
}

/** What Admin › Server shows of the fallback: never the key, only its last four characters. */
export interface LlmFallbackView {
  model: string;
  keyHint: string;
  updatedAt: Date;
}

/** An OpenAI model id as the API names them (spec D18): no URL, no other provider. */
const MODEL = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9.:_-]{1,63}$/i);

/** An OpenAI secret key: `sk-` and the rest, sealed at rest (spec §9.4). */
const API_KEY = z
  .string()
  .trim()
  .regex(/^sk-[A-Za-z0-9_-]{20,200}$/);

export async function llmFallbackView(ctx: Pick<Ctx, "role">): Promise<LlmFallbackView | null> {
  requireAdminCtx(ctx);
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, LLM_FALLBACK));
  if (!row?.value) return null;
  return {
    model: String(row.value.model ?? ""),
    keyHint: String(row.value.keyHint ?? ""),
    updatedAt: row.updatedAt,
  };
}

/**
 * Sets the fallback (admin only): the model, and the key when one is given — an empty key keeps
 * the stored one. The key is sealed before it reaches the database and never comes back out here.
 */
export async function saveLlmFallback(
  ctx: Pick<Ctx, "role" | "userId">,
  input: { model: string; apiKey: string },
): Promise<void> {
  requireAdminCtx(ctx);
  const model = MODEL.safeParse(input.model);
  if (!model.success) throw new SettingsError("invalid");
  const typed = input.apiKey.trim();
  const [current] = await getDb().select().from(appSettings).where(eq(appSettings.key, LLM_FALLBACK));
  if (typed === "" && !current?.sealed) throw new SettingsError("invalid");
  const key = typed === "" ? null : API_KEY.safeParse(typed);
  if (key && !key.success) throw new SettingsError("invalid");
  const sealed = key?.success ? sealJson(keyRing(), { apiKey: key.data }) : current!.sealed!;
  const keyHint = key?.success ? key.data.slice(-4) : String(current?.value?.keyHint ?? "");
  const value = { model: model.data, keyHint };
  await getDb()
    .insert(appSettings)
    .values({ key: LLM_FALLBACK, value, sealed, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, sealed, updatedBy: ctx.userId, updatedAt: new Date() },
    });
}

export async function removeLlmFallback(ctx: Pick<Ctx, "role">): Promise<void> {
  requireAdminCtx(ctx);
  await getDb().delete(appSettings).where(eq(appSettings.key, LLM_FALLBACK));
}

/**
 * The fallback's model and key, for the one caller that sends a request with them. `null` when no
 * admin configured it: then nothing is ever sent (spec §7.8).
 */
export async function llmFallbackCredentials(): Promise<{ model: string; apiKey: string } | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, LLM_FALLBACK));
  if (!row?.sealed || !row.value?.model) return null;
  const { apiKey } = openJson(keyRing(), row.sealed);
  return apiKey ? { model: String(row.value.model), apiKey } : null;
}

/**
 * "Test connection" (admin only): asks OpenAI whether the *saved* key and model still work, with
 * the cheapest request that proves both — see {@link probeLlmFallback}. It changes nothing: the
 * fallback's own behaviour and the sealed key are left exactly as they are.
 */
export async function testLlmFallback(
  ctx: Pick<Ctx, "role">,
  deps: { fetch: typeof fetch } = { fetch: globalThis.fetch },
): Promise<LlmProbeResult> {
  requireAdminCtx(ctx);
  return probeLlmFallback(await llmFallbackCredentials(), deps);
}

/** Whether the fallback is configured, for everyone's review page (no detail). */
export async function llmFallbackAvailable(): Promise<boolean> {
  const [row] = await getDb()
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, LLM_FALLBACK));
  return row !== undefined;
}

/* Authentik (spec §5.1, design row 884) */

/** What the card shows: every field except the secret, which is only ever four characters of hint. */
export interface OidcView {
  issuer: string;
  clientId: string;
  adminGroup: string;
  secretHint: string;
  /** false while nothing is saved: the values come from `.env.homelab` (plan F8 §3.4.3). */
  saved: boolean;
  updatedAt: Date | null;
  lastCheck: OidcProbeResult | null;
}

/** The recorded verdict of the last "Test connection", from its own key (never the provider's). */
async function lastOidcCheck(): Promise<OidcProbeResult | null> {
  const row = await readSetting(OIDC_PROBE);
  const outcome = row?.value?.outcome;
  if (typeof outcome !== "string") return null;
  return { outcome: outcome as OidcProbeOutcome, checkedAt: row!.updatedAt };
}

export async function oidcView(ctx: Pick<Ctx, "role">): Promise<OidcView> {
  requireAdminCtx(ctx);
  const [config, lastCheck] = await Promise.all([oidcConfig(), lastOidcCheck()]);
  return {
    issuer: config.issuer,
    clientId: config.clientId,
    adminGroup: config.adminGroup,
    secretHint: config.clientSecret.slice(-4),
    saved: config.updatedAt !== null,
    updatedAt: config.updatedAt,
    lastCheck,
  };
}

/**
 * Saves the identity provider (admin only) and reports whether it signed everyone out.
 *
 * A changed issuer **revokes every session** (spec §5.1): those sessions stand for identities that
 * the old provider vouched for, and nobody vouches for them any more. The caller's own session
 * goes with them — that is the point, and the card says so before the button is pressed.
 */
export async function saveOidc(
  ctx: Pick<Ctx, "role" | "userId">,
  input: unknown,
): Promise<{ signedEveryoneOut: boolean }> {
  requireAdminCtx(ctx);
  const parsed = oidcInputSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("invalid");
  // A URL that `discoveryUrlFor` cannot build from is not an issuer, whatever `z.url()` thinks.
  try {
    discoveryUrlFor(parsed.data.issuer);
  } catch {
    throw new SettingsError("invalid");
  }
  const current = await readSetting(OIDC_PROVIDER);
  const typed = parsed.data.clientSecret.trim();
  if (typed === "" && !current?.sealed) throw new SettingsError("invalid");
  const sealed = typed === "" ? current!.sealed! : sealJson(keyRing(), { clientSecret: typed });
  const secretHint = typed === "" ? String(current?.value?.secretHint ?? "") : typed.slice(-4);
  const value = {
    issuer: parsed.data.issuer.trim(),
    clientId: parsed.data.clientId,
    adminGroup: parsed.data.adminGroup,
    secretHint,
  };
  const before = typeof current?.value?.issuer === "string" ? String(current.value.issuer) : null;
  const signedEveryoneOut = issuerChanged(before, value.issuer);
  await getDb()
    .insert(appSettings)
    .values({ key: OIDC_PROVIDER, value, sealed, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, sealed, updatedBy: ctx.userId, updatedAt: new Date() },
    });
  if (signedEveryoneOut) await getDb().delete(sessions);
  invalidateAuth();
  return { signedEveryoneOut };
}

/** Forgets the saved provider: the instance falls back to `.env.homelab` (plan F8 §3.4.3). */
export async function removeOidc(ctx: Pick<Ctx, "role">): Promise<void> {
  requireAdminCtx(ctx);
  await getDb().delete(appSettings).where(eq(appSettings.key, OIDC_PROVIDER));
  invalidateAuth();
}

/**
 * Fetches the discovery document of the *effective* provider and records the verdict, so the card
 * can say "last check 07:10" on its next render. The verdict goes to its own key: writing it into
 * `oidc.provider` would bump that row's `updated_at` and make every worker rebuild Better Auth for
 * a fact that changes nothing about it (plan F8 §3.4.4).
 */
export async function testOidc(
  ctx: Pick<Ctx, "role" | "userId">,
  deps: { fetch: typeof fetch } = { fetch: globalThis.fetch },
): Promise<OidcProbeResult> {
  requireAdminCtx(ctx);
  const config = await oidcConfig();
  const result = await probeOidc(config, deps);
  const value = { outcome: result.outcome };
  await getDb()
    .insert(appSettings)
    .values({ key: OIDC_PROBE, value, updatedBy: ctx.userId, updatedAt: result.checkedAt })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: ctx.userId, updatedAt: result.checkedAt },
    });
  return result;
}

/* Outgoing mail (spec §9.4, design row 885) */

export interface SmtpView {
  host: string;
  port: number;
  encryption: "ssl" | "starttls" | "none";
  user: string;
  passwordHint: string;
  from: string;
  policy: MailPolicy;
  saved: boolean;
  updatedAt: Date | null;
}

export async function smtpView(ctx: Pick<Ctx, "role">): Promise<SmtpView> {
  requireAdminCtx(ctx);
  const [config, row] = await Promise.all([smtpConfig(), readSetting(SMTP_TRANSPORT)]);
  return {
    host: config.host,
    port: config.port,
    encryption: config.encryption,
    user: config.user ?? "",
    passwordHint: (config.password ?? "").slice(-4),
    from: config.from,
    policy: mailPolicyFrom(row?.value),
    saved: config.updatedAt !== null,
    updatedAt: config.updatedAt,
  };
}

export async function saveSmtp(ctx: Pick<Ctx, "role" | "userId">, input: unknown): Promise<void> {
  requireAdminCtx(ctx);
  const parsed = smtpInputSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("invalid");
  const current = await readSetting(SMTP_TRANSPORT);
  const typed = parsed.data.password;
  // A username with no password at all is refused only when none was ever stored: an admin who
  // leaves the field empty is keeping the sealed one, which is the whole point of the hint.
  if (parsed.data.user !== "" && typed === "" && !current?.sealed) throw new SettingsError("invalid");
  const sealed = typed === "" ? (current?.sealed ?? null) : sealJson(keyRing(), { password: typed });
  const value = {
    host: parsed.data.host,
    port: parsed.data.port,
    encryption: parsed.data.encryption,
    user: parsed.data.user,
    passwordHint: typed === "" ? String(current?.value?.passwordHint ?? "") : typed.slice(-4),
    from: parsed.data.from,
    invitations: parsed.data.invitations,
    syncAlerts: parsed.data.syncAlerts,
    monthlySummary: parsed.data.monthlySummary,
  };
  await getDb()
    .insert(appSettings)
    .values({ key: SMTP_TRANSPORT, value, sealed, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, sealed, updatedBy: ctx.userId, updatedAt: new Date() },
    });
  invalidateMailTransport();
}

/** Forgets the saved transport: the instance falls back to `.env.homelab`. */
export async function removeSmtp(ctx: Pick<Ctx, "role">): Promise<void> {
  requireAdminCtx(ctx);
  await getDb().delete(appSettings).where(eq(appSettings.key, SMTP_TRANSPORT));
  invalidateMailTransport();
}

/**
 * What "Send test email" found. `reason` is the transport's own error *code* — `ECONNREFUSED`,
 * `EAUTH`, `ETIMEDOUT` — and never its message: the message quotes the conversation with the
 * server, and the credentials travel in that conversation (spec §5.4). A code is what tells an
 * admin whether the host, the port or the password is wrong, which is all they need.
 */
export type MailProbeResult =
  { outcome: "ok"; to: string } | { outcome: "noAddress" } | { outcome: "failed"; reason: string };

const MAIL_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

function mailFailureReason(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return MAIL_ERROR_CODE.test(code) ? code : "UNKNOWN";
}

/**
 * Sends one email to the admin who pressed the button, through the transport as it is saved right
 * now. Deliberately ignores the three switches: they decide what the *application* sends on its
 * own, and a diagnostic an admin asked for by name is not that.
 */
export async function sendTestEmail(
  ctx: Pick<Ctx, "role" | "userId" | "locale">,
  deps: { sendMail: typeof sendMail } = { sendMail },
): Promise<MailProbeResult> {
  requireAdminCtx(ctx);
  const [person] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, ctx.userId));
  if (!person?.email) return { outcome: "noAddress" };
  try {
    await deps.sendMail({ to: person.email, ...testEmail(ctx.locale) });
    return { outcome: "ok", to: person.email };
  } catch (error) {
    console.error("[settings] test email failed", redactForLog(error));
    return { outcome: "failed", reason: mailFailureReason(error) };
  }
}
