import { z } from "zod";

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

  /**
   * Credential encryption keys, `keyId:base64key[,keyId:base64key]…`, active
   * key first (spec §6, §12). Parsed by
   * `src/platform/integrations/crypto.ts`. Required: an integration cannot be
   * connected without it.
   */
  APP_ENCRYPTION_KEY: z.string().min(1),

  WALLET_API_URL: z.url().default("https://rest.budgetbakers.com/wallet/v1/api"),

  PAPERLESS_URL: z.url(),
  PAPERLESS_TOKEN: z.string().min(1),
  PAPERLESS_PAYSLIP_TAG_ID: z.coerce.number().int().default(22),

  CRON_SECRET: z.string().min(16),
  WEBHOOK_SECRET: z.string().min(16),

  GOTIFY_URL: z.url().optional(),
  GOTIFY_TOKEN: z.string().optional(),

  /**
   * OpenAI-compatible LLM used by the payslip extraction pass. All three are
   * optional: with no key the pass is skipped and the deterministic rules pass
   * stands alone (see `src/lib/payroll/llm.ts`).
   *
   * These are the *fallback* layer — Settings → “Payslip AI” overrides each of
   * them per field at runtime (`src/lib/payroll/llm-config.ts`). Blank-tolerant
   * because compose always defines a listed variable, so an unset
   * OPENAI_BASE_URL arrives as `""`, which a bare `z.url()` would reject and
   * take the whole app down at boot over an optional integration.
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
 * Test seam. `env()` memoises the parsed schema in a module-scope `cached`, so
 * a test that rewrites `process.env` after some earlier module already called
 * `env()` would otherwise keep reading the old values — silently, and with no
 * way to tell. Never called outside tests; the production process resolves its
 * environment once and keeps it.
 */
export function resetEnvCache(): void {
  cached = null;
}

export interface TrekConfig {
  baseUrl: string;
  /** A static, non-expiring `trek_…` MCP token — NOT a session JWT. */
  token: string;
}
