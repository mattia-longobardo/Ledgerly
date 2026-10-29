import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** Pages whose URL carries a secret token (invitation path, reset query): no Referer ever. */
const TOKEN_PAGES = ["/invite/:path*", "/reset-password"];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Otherwise `next dev` writes its own CLAUDE.md/AGENTS.md into the repository.
  agentRules: false,
  // ccxt (Investments, docs/design/investments.md §3.2) is ~70 MB: required at run time from
  // node_modules, never bundled. Listed before the package is added so the phase that adds it
  // changes no build setting.
  serverExternalPackages: ["ccxt"],
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
