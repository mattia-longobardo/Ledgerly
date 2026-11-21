import { describe, expect, it } from "vitest";
import { API_LEVEL, MIN_CLIENT_LEVEL, metaRoute } from "@ledgerly/api-contract";
import { APP_VERSION } from "@ledgerly/domain/platform/version";
import type { AccountCases } from "./accounts/routes";
import type { TransactionCases } from "./transactions/cases";
import { apiRoutes } from "./index";
import type { ConnectionCases } from "./settings/connections";
import type { ServerCases } from "./settings/server";

describe("GET /meta", () => {
  it("answers without a token: version, levels, capabilities and the scopes granted today", async () => {
    const response = await apiRoutes({
      guard: () => async (_context, next) => next(),
      sourceName: async (provider) => provider,
      // `/meta` calls no use case of the connections.
      connections: {} as ConnectionCases,
      server: {} as ServerCases,
      accounts: {} as AccountCases,
      transactions: {} as TransactionCases,
    }).request("/meta");
    expect(response.status).toBe(200);
    const body = metaRoute.response.parse(await response.json());
    expect(body).toEqual({
      version: APP_VERSION,
      apiLevel: API_LEVEL,
      minClientLevel: MIN_CLIENT_LEVEL,
      capabilities: [
        "accounts",
        "budgets",
        "categories",
        "connections",
        "imports",
        "interests",
        "meta",
        "payroll",
        "people",
        "pockets",
        "preferences",
        "profile",
        "rules",
        "search",
        "security",
        "server",
        "subscriptions",
        "timeoff",
        "transactions",
      ],
      scopes: ["read", "write", "imports", "investments:read"],
    });
  });
});
