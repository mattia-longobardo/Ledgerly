import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    setupFiles: ["./src/test/integration-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://app_test:app_test@localhost:55432/dashboard_test",
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
