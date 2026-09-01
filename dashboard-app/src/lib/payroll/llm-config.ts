/**
 * Where the payslip LLM's credentials, model and base URL come from.
 *
 * RESOLUTION ORDER — **Settings beats the environment, field by field.**
 * The whole point of the Settings section is that the owner can repoint the
 * provider (say, from api.openai.com to a llama.cpp shim on the LAN) without
 * editing compose and redeploying. If the environment won, a value left in
 * compose would silently override what was just typed and saved, and the UI
 * would be lying — the worse of the two failure modes. The environment stays
 * as the bootstrap layer: it is the only way to inject a key that never touches
 * the database, and it is what a fresh install runs on before anyone opens
 * Settings. Each of the three fields resolves independently, so "key from the
 * environment, model from Settings" is a legal, useful combination.
 *
 * With nothing configured anywhere the pass is simply skipped with an
 * explanatory `error` string and the deterministic rules pass stands alone —
 * `runLlmPass` never throws and neither does anything here, so an unconfigured
 * (or unreachable) LLM can never crash the payslip pipeline.
 *
 * SERVER ONLY. `LlmConfigStatus` exists precisely so a server component can
 * render the *state* of the key without ever holding its value.
 */

import { env } from "@/lib/env";
import { DEFAULT_BASE_URL, type LlmOptions } from "@/lib/payroll/llm";
import { SETTING_KEYS, getSetting } from "@/lib/repo/settings";

export type ConfigSource = "settings" | "env" | "default";

/** What the payslip pass needs. Shaped so it can be spread into `LlmOptions`. */
export interface LlmResolvedConfig {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
}

/** Everything the Settings UI may know. Deliberately carries no key value. */
export interface LlmConfigStatus {
  readonly baseUrl: string;
  readonly baseUrlSource: ConfigSource;
  readonly model: string;
  readonly modelSource: ConfigSource;
  readonly hasKey: boolean;
  /** Where the key in force comes from; `null` when there is none. */
  readonly keySource: "settings" | "env" | null;
  /** True when a key is stored in `app_settings`, i.e. there is one to clear. */
  readonly hasStoredKey: boolean;
  /** Non-null when the pass would be skipped; a sentence for the UI. */
  readonly disabledReason: string | null;
}

function asString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

interface Layers {
  readonly settingsKey?: string;
  readonly settingsBaseUrl?: string;
  readonly settingsModel?: string;
  readonly envKey?: string;
  readonly envBaseUrl?: string;
  readonly envModel?: string;
}

/**
 * Reads both layers, tolerating either being unavailable. `env()` throws when
 * the *whole* environment is unparseable (and at build time there is none at
 * all); `getSetting` throws when Postgres is down. Neither says anything about
 * the LLM, so both degrade to "this layer contributed nothing".
 */
async function readLayers(): Promise<Layers> {
  let envKey: string | undefined;
  let envBaseUrl: string | undefined;
  let envModel: string | undefined;
  try {
    const e = env();
    envKey = asString(e.OPENAI_API_KEY);
    envBaseUrl = asString(e.OPENAI_BASE_URL);
    envModel = asString(e.LLM_MODEL);
  } catch {
    /* no usable environment */
  }

  let settingsKey: string | undefined;
  let settingsBaseUrl: string | undefined;
  let settingsModel: string | undefined;
  try {
    const [key, baseUrl, model] = await Promise.all([
      getSetting<unknown>(SETTING_KEYS.llmApiKey, null),
      getSetting<unknown>(SETTING_KEYS.llmBaseUrl, null),
      getSetting<unknown>(SETTING_KEYS.llmModel, null),
    ]);
    settingsKey = asString(key);
    settingsBaseUrl = asString(baseUrl);
    settingsModel = asString(model);
  } catch {
    /* no database, or the table is not migrated yet */
  }

  return { settingsKey, settingsBaseUrl, settingsModel, envKey, envBaseUrl, envModel };
}

/** The config the payslip pass actually runs with. Never throws. */
export async function resolveLlmConfig(): Promise<LlmResolvedConfig> {
  const l = await readLayers();
  const apiKey = l.settingsKey ?? l.envKey;
  return {
    ...(apiKey ? { apiKey } : {}),
    baseUrl: l.settingsBaseUrl ?? l.envBaseUrl ?? DEFAULT_BASE_URL,
    model: l.settingsModel ?? l.envModel ?? "",
  };
}

/** `resolveLlmConfig` in the shape `parsePayslip` wants. Never throws. */
export async function llmOptionsFromConfig(): Promise<LlmOptions> {
  const config = await resolveLlmConfig();
  return {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    baseUrl: config.baseUrl,
    ...(config.model ? { model: config.model } : {}),
  };
}

/** What Settings renders. Never throws, and never returns the key itself. */
export async function llmConfigStatus(): Promise<LlmConfigStatus> {
  const l = await readLayers();
  const keySource = l.settingsKey ? "settings" : l.envKey ? "env" : null;
  const model = l.settingsModel ?? l.envModel ?? "";
  return {
    baseUrl: l.settingsBaseUrl ?? l.envBaseUrl ?? DEFAULT_BASE_URL,
    baseUrlSource: l.settingsBaseUrl ? "settings" : l.envBaseUrl ? "env" : "default",
    model,
    modelSource: l.settingsModel ? "settings" : l.envModel ? "env" : "default",
    hasKey: keySource !== null,
    keySource,
    hasStoredKey: l.settingsKey !== undefined,
    disabledReason:
      keySource === null
        ? "No API key. Payslips are parsed by the deterministic rules alone."
        : model === ""
          ? "No model — payslips are parsed by the deterministic rules alone."
          : null,
  };
}

export type BaseUrlCheck = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

/**
 * Hostnames that cannot leave the LAN. A self-hosted OpenAI shim on
 * `http://ollama:11434/v1` or `http://192.168.1.20:8080/v1` is a legitimate
 * setup, so plain HTTP is allowed *there* — but never to a public host, where
 * it would put the API key on the wire in cleartext.
 */
function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host.startsWith("fe80:")) return true;
  // IPv6 unique-local, fc00::/7.
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // A dotless name resolves only inside a Docker network or the local search
  // domain; the listed suffixes are the reserved LAN ones.
  if (!host.includes(".")) return true;
  return /\.(local|internal|lan|home\.arpa)$/.test(host);
}

/**
 * Validates and normalises a user-supplied base URL. Returns the origin plus
 * path with query, fragment and trailing slashes stripped — `runLlmPass`
 * appends `/chat/completions` to it.
 */
export function checkBaseUrl(raw: string): BaseUrlCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "Enter a base URL, e.g. https://api.openai.com/v1." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That is not a valid URL. Include the scheme, e.g. https://api.openai.com/v1." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The base URL must start with https:// (or http:// for a host on your own network)." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Do not put credentials in the URL — use the API key field." };
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    return {
      ok: false,
      reason: "Plain http:// is only allowed for a host on your own network — a public endpoint must use https://.",
    };
  }

  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.origin}${path}` };
}
