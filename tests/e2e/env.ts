// tests/e2e/env.ts — one environment for the e2e server, the seed and the specs.
export const E2E_PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Better Auth rate-limits sign-ins per client IP, and every test signs in from 127.0.0.1: 5 password
// sign-ins per minute (/sign-in/email, src/platform/auth/auth.ts) and 3 Authentik starts per 10 s
// (/sign-in/social, Better Auth's default for /sign-in/*). One run uses all 5 and all 3: one more
// sign-in is answered with HTTP 429 unless it replaces one of them.
export const USERS = {
  owner: { email: "owner@example.test", password: "owner-password-123", name: "Owner" },
  prefs: { email: "prefs@example.test", password: "prefs-password-123", name: "Prefs" },
  reset: { email: "reset@example.test", password: "reset-password-123", name: "Reset" },
} as const;

/** Pending invitations created by the seed; each token is written to `tests/e2e/.state/<file>`. */
export const INVITATIONS = {
  password: { email: "invitee@example.test", role: "user", file: "invite-token" },
  sso: { email: "sso-invitee@example.test", role: "admin", file: "sso-invite-token" },
  ssoMismatch: { email: "sso-mismatch@example.test", role: "user", file: "sso-mismatch-invite-token" },
} as const;

export const STATE_DIR = "tests/e2e/.state";

// The server runs the production build (NODE_ENV=production), so this satisfies the production
// checks in src/platform/env.ts: loopback http, a non-placeholder secret, a metrics token, no SMTP_USER.
export const E2E_ENV: Record<string, string> = {
  PORT: String(E2E_PORT),
  HOSTNAME: "127.0.0.1",
  DATABASE_URL: "postgres://finance:finance@127.0.0.1:55432/finance_e2e",
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET: "C4xCHKh9Mn+vqDxmFFkYqBDvEABVTob17HmmDDJqCf0=",
  OIDC_DISCOVERY_URL: "http://127.0.0.1:58090/default/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "finance",
  OIDC_CLIENT_SECRET: "finance-dev",
  OIDC_ADMIN_GROUP: "finance-admins",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "51025",
  MAIL_FROM: "Finance Dashboard <finance@example.test>",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: "finance",
  S3_SECRET_ACCESS_KEY: "finance-dev-secret",
  S3_BUCKET: "finance-e2e",
  CRON_SECRET: "e2e-cron-secret-e2e-cron-secret-e2e",
  HEARTBEAT_FILE: "/tmp/finance-heartbeat-e2e",
  METRICS_TOKEN: "e2e-metrics-token-e2e-metrics-token",
  // No proxy in front of the e2e server: X-Forwarded-For is the one address Next.js sets, 127.0.0.1.
  TRUSTED_PROXY_IPS: "",
};
