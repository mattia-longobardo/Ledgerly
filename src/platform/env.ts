import "server-only";
import { z } from "zod";

/** Compose passes unset variables as "", which must behave like "absent". */
const blankAsUndefined = (value: unknown) => (value === "" ? undefined : value);

/** The secret committed in `.env.example`; a production deployment must generate its own. */
const PLACEHOLDER_SECRET = "change-me-change-me-change-me-change-me";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Plain http is only acceptable on the machine itself (the end-to-end suite serves http://127.0.0.1). */
function isHttpsOrLoopback(value: string): boolean {
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
    OIDC_ADMIN_GROUP: z.string().min(1).default("finance-admins"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().min(3),
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
    if (env.BETTER_AUTH_SECRET === PLACEHOLDER_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Replace the .env.example placeholder",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** The validated environment. Parsed on first use, never at import time (the build has no secrets). */
export function readEnv(): Env {
  cached ??= envSchema.parse(
    Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, blankAsUndefined(value)])),
  );
  return cached;
}
