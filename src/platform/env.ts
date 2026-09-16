import "server-only";
import { z } from "zod";
import { parseKeyRing } from "@/platform/keyring";

/** Compose passes unset variables as "", which must behave like "absent". */
const blankAsUndefined = (value: unknown) => (value === "" ? undefined : value);

/** The values committed in `.env.example`; a production deployment must generate its own. */
const PLACEHOLDER_BETTER_AUTH_SECRET = "change-me-change-me-change-me-change-me";
const PLACEHOLDER_CRON_SECRET = "dev-cron-secret-dev-cron-secret-dev";
const PLACEHOLDER_METRICS_TOKEN = "dev-metrics-token-dev-metrics-token";
const PLACEHOLDER_ENCRYPTION_KEY = "dev:1fXJEH66bW3y0iE+bgEqimdJ1uEjw3fXyqeUmHosTdA=";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const ipOrCidr = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

/**
 * Plain http is only acceptable on the machine itself (the end-to-end suite serves
 * http://127.0.0.1). A value that is not a parseable URL is skipped here: `z.url()` on the field
 * itself already reported that issue, and `new URL()` on it would throw a bare `TypeError` that
 * would escape `safeParse` and hide every other issue.
 */
export function isHttpsOrLoopback(value: string): boolean {
  if (!URL.canParse(value)) return true;
  const { protocol, hostname } = new URL(value);
  return protocol === "https:" || (protocol === "http:" && LOOPBACK_HOSTS.has(hostname));
}

export const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    OIDC_DISCOVERY_URL: z.url(),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_CLIENT_SECRET: z.string().min(1),
    OIDC_ADMIN_GROUP: z.string().min(1).default("ledgerly-admins"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_REQUIRE_TLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MAIL_FROM: z.string().min(3),
    // Silo (the homelab's S3-compatible store) is reached at http://silo:9000 on the internal
    // `db_internal` network, never through the public app origin: intentionally exempt from the
    // https gate below.
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    // `id:base64[,older…]` (spec §9.4): the first key seals new credentials, every key can still
    // open old ones. Validated here, not on first use, so a rotation typo fails at boot.
    APP_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .superRefine((value, ctx) => {
        try {
          parseKeyRing(value);
        } catch (error) {
          ctx.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid key ring",
          });
        }
      }),
    CRON_SECRET: z.string().min(32),
    HEARTBEAT_FILE: z.string().min(1).default("/tmp/ledgerly-heartbeat"),
    METRICS_TOKEN: z.string().min(32).optional(),
    // The reverse proxies in front of the app (comma-separated IPs or CIDR ranges): Better Auth
    // reads the client IP from X-Forwarded-For past these hops, so each client gets its own
    // rate-limit bucket. Empty: only a single-value X-Forwarded-For is trusted.
    TRUSTED_PROXY_IPS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .pipe(z.array(ipOrCidr)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const key of ["BETTER_AUTH_URL", "OIDC_DISCOVERY_URL"] as const) {
      if (!isHttpsOrLoopback(env[key])) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Must be https in production (http only on loopback)",
        });
      }
    }
    const placeholders: ReadonlyArray<
      ["BETTER_AUTH_SECRET" | "CRON_SECRET" | "METRICS_TOKEN" | "APP_ENCRYPTION_KEY", string]
    > = [
      ["BETTER_AUTH_SECRET", PLACEHOLDER_BETTER_AUTH_SECRET],
      ["CRON_SECRET", PLACEHOLDER_CRON_SECRET],
      ["METRICS_TOKEN", PLACEHOLDER_METRICS_TOKEN],
      ["APP_ENCRYPTION_KEY", PLACEHOLDER_ENCRYPTION_KEY],
    ];
    for (const [key, placeholder] of placeholders) {
      if (env[key] === placeholder) {
        ctx.addIssue({ code: "custom", path: [key], message: "Replace the .env.example placeholder" });
      }
    }
    if (env.SMTP_USER && !env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_REQUIRE_TLS"],
        message:
          "Set SMTP_SECURE or SMTP_REQUIRE_TLS when SMTP_USER is set: credentials must not travel in plaintext",
      });
    }
    if (!env.METRICS_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["METRICS_TOKEN"],
        message: "Required in production: GET /api/metrics must never be unauthenticated",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * The validated environment. Parsed on first use, never at import time (the build has no
 * secrets). `src/instrumentation.ts` also calls this once, at server start — after the process
 * has its real environment, never during `next build` — so a misconfigured deployment fails
 * loudly at boot instead of on the first request.
 */
export function readEnv(): Env {
  cached ??= envSchema.parse(
    Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, blankAsUndefined(value)])),
  );
  return cached;
}
