import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The integration project runs inside a throwaway container on the homelab's internal network
// (scripts/test-integration.sh), against the separate `ledgerly_test` database and Silo (the app's
// bucket, `tests/` prefix only): the script passes those as TEST_*. Nothing here may point at the
// production database.

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
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            BETTER_AUTH_URL: "http://127.0.0.1:3000",
            BETTER_AUTH_SECRET: "integration-secret-integration-secret-32",
            // Never contacted: no integration test signs in through Authentik any more.
            OIDC_DISCOVERY_URL: "http://127.0.0.1:9/.well-known/openid-configuration",
            OIDC_CLIENT_ID: "ledgerly",
            OIDC_CLIENT_SECRET: "unused",
            OIDC_ADMIN_GROUP: "ledgerly-admins",
            // Never contacted either: nothing here reads a mailbox.
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: "9",
            MAIL_FROM: "Ledgerly <ledgerly@example.test>",
            S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "",
            S3_REGION: process.env.TEST_S3_REGION ?? "us-east-1",
            S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? "",
            S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "",
            S3_BUCKET: process.env.TEST_S3_BUCKET ?? "",
            // Every object a service writes lands under `tests/` (see the note above).
            S3_KEY_PREFIX: "tests/",
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
