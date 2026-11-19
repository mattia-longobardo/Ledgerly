// The static package of the screens (rewrite plan R3, criterion 13; audit UI-AUT-2): the client-only
// screens of R3 built by Vite into plain files, with no Next and no server of their own. The data
// come from `/api/v1` of the same origin; `LEDGERLY_API` names the instance a local run proxies to.
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const api = process.env.LEDGERLY_API ?? "http://localhost:3999";

/** `/api` of the instance, as if it were this origin: its session cookie and its write check. */
const proxy = {
  "/api": {
    target: api,
    changeOrigin: true,
    configure: (server: {
      on: (
        event: "proxyReq",
        listener: (request: { setHeader: (name: string, value: string) => void }) => void,
      ) => void;
    }) => server.on("proxyReq", (request) => request.setHeader("origin", api)),
  },
};

export default defineConfig({
  root: here("."),
  // The screens still name Next's translations and navigation: the two shims hand them `use-intl`
  // and the injected router until the screens move to `packages/ui` (03-releases.md §R3).
  resolve: {
    alias: [
      { find: /^next-intl$/, replacement: here("src/shims/next-intl.ts") },
      { find: /^next\/navigation$/, replacement: here("src/shims/next-navigation.ts") },
      { find: /^next\/link$/, replacement: here("src/shims/next-link.tsx") },
      { find: /^@\//, replacement: `${here("../web/src")}/` },
      { find: /^@domain\//, replacement: `${here("../../packages/domain/src")}/` },
    ],
  },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwind()] } },
  server: { proxy },
  preview: { proxy },
  build: { outDir: here("dist"), emptyOutDir: true },
});
