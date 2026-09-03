import { writeFileSync } from "node:fs";
import { createApiApp } from "@/platform/http/app";
import { testPrincipal } from "@/test/principal";

export async function buildOpenApiDocument(): Promise<unknown> {
  const app = createApiApp({
    db: {} as never,
    authenticate: async () => ({ principal: testPrincipal(), method: "session" as const }),
    now: () => new Date(0),
    rateLimitEnabled: false,
  });
  const res = await app.request("/api/v1/openapi.json");
  return res.json();
}

if (process.argv[1]?.endsWith("openapi.ts")) {
  const doc = await buildOpenApiDocument();
  writeFileSync(new URL("../../docs/api/openapi.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
  console.log("docs/api/openapi.json written");
}
