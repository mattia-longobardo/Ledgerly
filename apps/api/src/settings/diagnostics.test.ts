// `GET /server/diagnostics`: a plugin that does not answer is `down` in its row and the route answers
// 200; only a check that cannot run at all answers 503.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { AccountCases } from "../accounts/routes";
import type { TransactionCases } from "../transactions/cases";
import { apiRoutes } from "../index";
import type { ConnectionCases } from "./connections";
import type { SourceReads } from "./sources";
import type { ServerCases } from "./server";
import type { InvestmentCases } from "../investments/routes";

const plugins = vi.hoisted(() => ({ rows: [] as unknown[], fails: false }));
vi.mock("@ledgerly/domain/platform/plugins", () => ({
  pluginDiagnostics: async () => {
    if (plugins.fails) throw new Error("database down");
    return plugins.rows;
  },
}));

const admin = { userId: "admin", role: "admin", locale: "en", timeZone: "Europe/Rome" } as Ctx;

const app = () =>
  apiRoutes({
    guard: () => async (context, next) => {
      context.set("ctx", admin);
      await next();
    },
    sourceName: async (provider) => provider,
    connections: {} as ConnectionCases,
    server: {} as ServerCases,
    accounts: {} as AccountCases,
    transactions: {} as TransactionCases,
    investments: {} as InvestmentCases,
    sources: {} as SourceReads,
  });

describe("GET /server/diagnostics", () => {
  beforeEach(() => {
    plugins.fails = false;
  });

  it("answers 200 with the row of a plugin that does not answer as down", async () => {
    plugins.rows = [
      {
        id: "enablebanking",
        name: "Enable Banking",
        version: "1.0.0",
        contract: "1",
        state: "down",
        at: new Date("2026-11-19T07:00:00Z"),
      },
    ];
    const response = await app().request("/server/diagnostics");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plugins: [
        {
          id: "enablebanking",
          name: "Enable Banking",
          version: "1.0.0",
          contract: "1",
          state: "down",
          at: "2026-11-19T07:00:00.000Z",
        },
      ],
    });
  });

  it("answers 503 unavailable when the check cannot run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    plugins.fails = true;
    const response = await app().request("/server/diagnostics");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
