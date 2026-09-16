import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Matches test/integration-setup.ts's own DEFAULT_TEST_DATABASE_URL fallback (not imported here:
// that file's own imports are unsafe for Vite's config-loading, see its comment).
const DEFAULT_TEST_DATABASE_URL = "postgres://ledgerly:ledgerly@127.0.0.1:55432/ledgerly_test";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit-node", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./test/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.itest.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ["./test/integration-setup.ts"],
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
            BETTER_AUTH_URL: "http://127.0.0.1:3000",
            BETTER_AUTH_SECRET: "integration-secret-integration-secret-32",
            OIDC_DISCOVERY_URL: "http://127.0.0.1:58090/default/.well-known/openid-configuration",
            OIDC_CLIENT_ID: "ledgerly",
            OIDC_CLIENT_SECRET: "ledgerly-dev",
            OIDC_ADMIN_GROUP: "ledgerly-admins",
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: "51025",
            MAIL_FROM: "Ledgerly <ledgerly@example.test>",
            S3_ENDPOINT: "http://127.0.0.1:59000",
            S3_ACCESS_KEY_ID: "ledgerly",
            S3_SECRET_ACCESS_KEY: "ledgerly-dev-secret",
            S3_BUCKET: "ledgerly-test",
            APP_ENCRYPTION_KEY: "k1:gBubFxNEhi1CSofEa9MtLb5lSXHXROI4WupEIGMhsZU=",
            CRON_SECRET: "integration-cron-secret-integration",
            HEARTBEAT_FILE: "/tmp/ledgerly-heartbeat-test",
            METRICS_TOKEN: "integration-metrics-token-integration-metrics-token",
            // One reverse-proxy hop (TEST-NET-1), for the rate-limit test in auth.itest.ts.
            TRUSTED_PROXY_IPS: "192.0.2.10",
          },
        },
      },
    ],
  },
});
