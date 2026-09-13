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
    ],
  },
});
