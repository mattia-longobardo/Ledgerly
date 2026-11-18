import { describe, expect, it } from "vitest";
import { API_LEVEL, MIN_CLIENT_LEVEL, metaRoute } from "@ledgerly/api-contract";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import { apiRoutes } from "./index";

describe("GET /meta", () => {
  it("answers without a token: version, levels, capabilities and the scopes granted today", async () => {
    const response = await apiRoutes({
      guard: () => async (_context, next) => next(),
      sourceName: async (provider) => provider,
    }).request("/meta");
    expect(response.status).toBe(200);
    const body = metaRoute.response.parse(await response.json());
    expect(body).toEqual({
      version: APP_VERSION,
      apiLevel: API_LEVEL,
      minClientLevel: MIN_CLIENT_LEVEL,
      capabilities: ["categories", "meta", "preferences", "profile"],
      scopes: ["read", "write", "imports", "investments:read"],
    });
  });
});
