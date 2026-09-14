import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    passWithNoTests: true,
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
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ?? "postgres://finance:finance@127.0.0.1:55432/finance_test",
            BETTER_AUTH_URL: "http://127.0.0.1:3000",
            BETTER_AUTH_SECRET: "integration-secret-integration-secret-32",
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
            S3_BUCKET: "finance-test",
            CRON_SECRET: "integration-cron-secret",
            HEARTBEAT_FILE: "/tmp/finance-heartbeat-test",
          },
        },
      },
    ],
  },
});
