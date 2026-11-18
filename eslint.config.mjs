import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["apps/web/src/app/**/*.{ts,tsx}", "apps/web/src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/schema"],
              message: "Pages and UI read data through a module's service or queries, never its tables.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "apps/web/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "apps/web/next-env.d.ts",
    "drizzle/**",
    "test-results/**",
    "playwright-report/**",
    "Fondo Cometa/**",
    "Payroll/**",
    "UI Recreation and branding decisions/**",
    // Copied from node_modules before each build (scripts/copy-pdfjs.mjs).
    "apps/web/public/pdfjs/**",
  ]),
]);
