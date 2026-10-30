// eToro as an investment source, end to end on the spike's fixtures (docs/design/investments.md
// §3.3): the calls a pass makes, in order, and what they become.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { etoroSource } from "./source";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/etoro");
const body = (name: string): unknown =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown }).body;
const KEYS = { api_key: "fixture-api-key", user_key: "fixture-user-key" };
const NOW = new Date("2026-10-27T10:00:00Z");

function routed(routes: Record<string, () => Response>) {
  const paths: string[] = [];
  const fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    paths.push(pathname);
    const route = Object.entries(routes).find(([prefix]) => pathname.startsWith(prefix));
    if (!route) return new Response("{}", { status: 404 });
    return route[1]();
  }) as unknown as typeof globalThis.fetch;
  return { paths, source: etoroSource({ fetch }) };
}

const ok = (value: unknown) => () => new Response(JSON.stringify(value), { status: 200 });

describe("etoroSource", () => {
  it("verifies the key with /me (E1)", async () => {
    const { source, paths } = routed({ "/api/v1/me": ok(body("me")) });
    expect((await source.verifyReadOnly(KEYS)).result).toBe("read-only");
    expect(paths).toEqual(["/api/v1/me"]);
  });

  it("reads the holdings from the balances and the portfolio with its P/L", async () => {
    const { source, paths } = routed({
      "/api/v1/balances": ok(body("balances-eur-include-zero")),
      "/api/v1/trading/info/real/pnl": ok(body("pnl-empty")),
    });
    const snapshot = await source.fetchHoldings(KEYS, "EUR", NOW);
    expect(snapshot.empty).toBe(true);
    expect(paths).toEqual(["/api/v1/balances", "/api/v1/trading/info/real/pnl"]);
  });

  it("reads the trades and eToro Money's movements, even when the instrument names fail", async () => {
    const { source, paths } = routed({
      "/api/v1/trading/info/trade/history": ok(body("trade-history")),
      "/api/v1/market-data/instruments": () => new Response("{}", { status: 200 }),
      "/api/v1/balances": ok(body("balances-usd-include-zero")),
      "/api/v1/money/accounts/cash/": ok(body("cash-transactions-all")),
    });
    const flows = await source.fetchFlows(KEYS, NOW);
    expect(flows.events.filter((event) => event.externalId.startsWith("trade:"))).toHaveLength(8);
    expect(flows.events.filter((event) => event.externalId.startsWith("cash:"))).toHaveLength(2);
    expect(flows.events[0].legs[0].asset?.name).toBe("eToro 1377");
    expect(paths).toContain("/api/v1/money/accounts/cash/00000000-0000-4000-8000-000000000004/transactions");
  });

  it("covers the deposits from the service's cut-off, not from the API's moving 12 months (PERS-145)", async () => {
    const { source } = routed({
      "/api/v1/trading/info/trade/history": ok(body("trade-history")),
      "/api/v1/market-data/instruments": () => new Response("{}", { status: 200 }),
      "/api/v1/balances": ok(body("balances-usd-include-zero")),
      "/api/v1/money/accounts/cash/": ok(body("cash-transactions-all")),
    });
    const since = new Date("2025-10-20T00:00:00Z");
    const flows = await source.fetchFlows(KEYS, NOW, {
      currency: "USD",
      cursor: null,
      fx: () => null,
      since,
    });
    const complete = flows.coverage.find(
      (window) => window.stream === "deposits" && window.status === "complete",
    );
    expect(complete?.fromAt).toEqual(since);
  });

  it("costs only the names when the instrument names answer 403 (PERS-87 SEC-06)", async () => {
    const { source } = routed({
      "/api/v1/trading/info/trade/history": ok(body("trade-history")),
      "/api/v1/market-data/instruments": () => new Response("{}", { status: 403 }),
      "/api/v1/balances": ok(body("balances-usd-include-zero")),
      "/api/v1/money/accounts/cash/": ok(body("cash-transactions-all")),
    });
    const flows = await source.fetchFlows(KEYS, NOW);
    expect(flows.events[0].legs[0].asset?.name).toBe("eToro 1377");
  });

  it("reads 360 days of history at most (D11)", async () => {
    const { source } = routed({ "/api/v1/balances/history": ok(body("balances-history")) });
    const history = await source.fetchHistory(KEYS, "EUR", NOW);
    expect(history.points.map((point) => point.on)).toEqual(["2025-11-01", "2026-02-22", "2026-10-26"]);
  });
});
