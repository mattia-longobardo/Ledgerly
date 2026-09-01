import { z } from "zod";
import { readFileSync } from "node:fs";

/** Compose always defines a listed variable, so "unset" reaches us as `""`. */
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  TZ: z.string().default("Europe/Rome"),

  DATABASE_URL: z.string().min(1),

  AUTH_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  AUTHORIZED_SUB: z.string().min(1),
  AUTHORIZED_EMAIL: z.string().optional(),

  TEABLE_URL: z.url(),
  TEABLE_TOKEN: z.string().min(1),
  TEABLE_TABLE_ID: z.string().default("tblSgA94MQaiutzohCC"),

  WALLET_API_URL: z.url().default("https://rest.budgetbakers.com/wallet/v1/api"),
  WALLET_TOKEN_FILE: z.string().default("/secrets/wallet-token"),

  PAPERLESS_URL: z.url(),
  PAPERLESS_TOKEN: z.string().min(1),
  PAPERLESS_PAYSLIP_TAG_ID: z.coerce.number().int().default(22),

  CRON_SECRET: z.string().min(16),
  WEBHOOK_SECRET: z.string().min(16),

  GOTIFY_URL: z.url().optional(),
  GOTIFY_TOKEN: z.string().optional(),

  /**
   * Trek's Vacay leave planner, reached over its MCP endpoint. Both are optional
   * on purpose: with either missing the leave sync is simply switched off (see
   * `trekConfig()`) rather than failing boot, so the dashboard still runs on a
   * host that has no Trek credential.
   *
   * Blank-tolerant on purpose. Compose always defines a listed variable, so an
   * unset TREK_HOST yields `TREK_URL=""` (or `"https://"`), and a bare
   * `z.url().optional()` REJECTS both — which would fail `env()` and take the
   * whole app down at boot over an integration that is meant to be optional.
   * Empty becomes undefined, and the sync just stays off.
   */
  TREK_URL: z.preprocess(
    (v) => (typeof v === "string" && (v.trim() === "" || v.trim() === "https://") ? undefined : v),
    z.url().optional(),
  ),
  /** Same blank-tolerance: an unset var arrives as `""` and must fall back. */
  TREK_TOKEN_FILE: z.preprocess(blankToUndefined, z.string().default("/secrets/trek-token")),

  /**
   * OpenAI-compatible LLM used by the payslip extraction pass. All three are
   * optional: with no key the pass is skipped and the deterministic rules pass
   * stands alone (see `src/lib/payroll/llm.ts`).
   *
   * These are the *fallback* layer — Settings → “Payslip AI” overrides each of
   * them per field at runtime (`src/lib/payroll/llm-config.ts`). Blank-tolerant
   * for the same reason TREK_URL is: compose always defines a listed variable,
   * so an unset OPENAI_BASE_URL arrives as `""`, which a bare `z.url()` would
   * reject and take the whole app down at boot over an optional integration.
   */
  OPENAI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  LLM_MODEL: z.preprocess(blankToUndefined, z.string().default("gpt-4.1-mini")),

  HEARTBEAT_FILE: z.string().default("/tmp/dashboard-sweep-heartbeat"),
  SNAPSHOT_GRACE_DAYS: z.coerce.number().int().positive().default(3),
  HOURS_PER_DAY: z.coerce.number().positive().default(8),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Read lazily on every job run so a rotated token file takes effect without a
 * restart — the wallet-manager hot-reload pattern.
 */
export function walletToken(): string {
  const token = readFileSync(env().WALLET_TOKEN_FILE, "utf8").trim();
  if (!token) throw new Error(`Wallet token file ${env().WALLET_TOKEN_FILE} is empty`);
  return token;
}

export interface TrekConfig {
  baseUrl: string;
  /** A static, non-expiring `trek_…` MCP token — NOT a session JWT. */
  token: string;
}

/**
 * Trek's credential, resolved per call.
 *
 * Same hot-reload reasoning as `walletToken()`: the token lives in a mounted
 * file, so rotating it takes effect without a restart. It returns `null` rather
 * than throwing on every kind of "not set up" — no URL, no file, an empty file —
 * because the sync's contract is to disable itself when it has no credential,
 * and a thrown error at this depth would surface as a crash on the Work page
 * instead of the plain "sync is off" the UI is meant to show.
 */
export function trekConfig(): TrekConfig | null {
  const e = env();
  if (!e.TREK_URL) return null;

  let token: string;
  try {
    token = readFileSync(e.TREK_TOKEN_FILE, "utf8").trim();
  } catch {
    return null;
  }
  if (!token) return null;

  return {
    baseUrl: e.TREK_URL.replace(/\/+$/, ""),
    token,
  };
}
