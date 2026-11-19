import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** Pages whose URL carries a secret token (invitation path, reset query): no Referer ever. */
const TOKEN_PAGES = ["/invite/:path*", "/reset-password"];

/** The root of the monorepo: the app compiles the workspaces' sources and reads `messages/` from it. */
const MONOREPO = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: MONOREPO,
  turbopack: { root: MONOREPO },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Otherwise `next dev` writes its own CLAUDE.md/AGENTS.md into the repository.
  agentRules: false,
  // ccxt (Investments, docs/design/investments.md §3.2) is ~70 MB: required at run time from
  // node_modules, never bundled. Listed before the package is added so the phase that adds it
  // changes no build setting.
  serverExternalPackages: ["ccxt"],
  // The workspaces of the monorepo (R0) ship TypeScript sources: Next compiles them with the app.
  transpilePackages: [
    "@ledgerly/api",
    "@ledgerly/api-contract",
    "@ledgerly/design-tokens",
    "@ledgerly/domain",
    "@ledgerly/plugin-contract",
    "@ledgerly/plugin-host",
    "@ledgerly/ui",
  ],
  // A document is at most 10 MB (spec §9.3); the multipart envelope needs a little more.
  experimental: { proxyClientMaxBodySize: "11mb", serverActions: { bodySizeLimit: "11mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Listed last: for the same header key, the last matching entry wins.
      ...TOKEN_PAGES.map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
};

export default createNextIntlPlugin("./src/platform/i18n/request.ts")(nextConfig);
