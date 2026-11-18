import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import known from "./baselines/cleanliness.json" with { type: "json" };
import cleanliness from "./scripts/cleanliness-rules.json" with { type: "json" };

// Rules Q5-Q8 and Q10 of the rewrite plan (10-modularity.md §10.8) on the product code, each turned
// off only for the files on its known list (`baselines/cleanliness.json`, `npm run cleanliness`).
/** A path as a glob that names only it: Next.js folders carry `[`, `]`, `(` and `)`. */
const literalPath = (path) => path.replace(/[[\](){}*?!+@]/g, "\\$&");
const knownLists = Object.entries(known)
  .filter(([rule]) => rule in cleanliness.rules)
  .map(([rule, files]) => ({ files: Object.keys(files).map(literalPath), rules: { [rule]: "off" } }));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Next.js app is the workspace apps/web (R0).
  { settings: { next: { rootDir: "apps/web/" } } },
  { files: cleanliness.files, ignores: cleanliness.ignores, rules: cleanliness.rules },
  ...knownLists,
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
