import "server-only";
import { z } from "zod";

/** Compose passes unset variables as "", which must behave like "absent". */
const blankAsUndefined = (value: unknown) => (value === "" ? undefined : value);

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  OIDC_DISCOVERY_URL: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_ADMIN_GROUP: z.string().min(1).default("finance-admins"),
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
