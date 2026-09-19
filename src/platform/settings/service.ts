import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { type KeyRing, openJson, parseKeyRing, sealJson } from "@/platform/crypto";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { appSettings } from "./schema";

/** The key of the OpenAI fallback's settings (spec D12, D18). */
export const LLM_FALLBACK = "llm.fallback";

let ring: KeyRing | undefined;

/** The key ring of spec §9.4, parsed once: the first key seals, every key still opens. */
function keyRing(): KeyRing {
  ring ??= parseKeyRing(readEnv().APP_ENCRYPTION_KEY);
  return ring;
}

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

/** Whether the fallback is configured, for everyone's review page (no detail). */
export async function llmFallbackAvailable(): Promise<boolean> {
  const [row] = await getDb()
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, LLM_FALLBACK));
  return row !== undefined;
}
