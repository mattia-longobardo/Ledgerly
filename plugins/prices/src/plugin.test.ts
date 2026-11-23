import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pricesResponseSchema, PLUGIN_PATHS, SECRET_HEADER } from "@ledgerly/plugin-contract";
import { checkPlugin } from "@plugin-contract/kit";
import { prices } from "./handlers";
import { MANIFEST } from "./manifest";
import { dailyCloses, yahooSymbol } from "./yahoo";

// The server module starts listening when imported, unless told not to.
process.env.PLUGIN_NO_LISTEN = "1";

// Days as Yahoo gives them: a session's first second, plus the exchange's offset (CET: +3600).
const OFFSET = 3600;
const at = (day: string, hour = 8) => Date.parse(`${day}T0${hour}:00:00Z`) / 1000;

function chart(
  closes: Record<string, number | null>,
  extra: { currency?: string; regular?: [string, string] } = {},
) {
  const days = Object.keys(closes);
  return {
    chart: {
      result: [
        {
          meta: {
            currency: extra.currency ?? "EUR",
            gmtoffset: OFFSET,
            ...(extra.regular
              ? {
                  currentTradingPeriod: {
                    regular: {
                      start: Date.parse(extra.regular[0]) / 1000,
                      end: Date.parse(extra.regular[1]) / 1000,
                    },
                  },
                }
              : {}),
          },
          timestamp: days.map((day) => at(day)),
          indicators: { quote: [{ close: days.map((day) => closes[day]) }] },
        },
      ],
      error: null,
    },
  };
}

/** A fake source: an answer by symbol, and the symbols it was asked for. */
function source(answers: Record<string, { status: number; body: unknown }>) {
  const asked: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const symbol = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    asked.push(symbol);
    expect(url.host).toBe("query2.finance.yahoo.com");
    const answer = answers[symbol] ?? {
      status: 404,
      body: { chart: { result: null, error: { code: "Not Found" } } },
    };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetchFn, asked };
}

const RANGE = { from: "2026-11-16", to: "2026-11-20" };
const NOW = () => new Date("2026-11-22T12:00:00Z");

describe("the symbol of a market", () => {
  it("adds the market's suffix, and none for the US", () => {
    expect(yahooSymbol("aaa", "XMIL")).toBe("AAA.MI");
    expect(yahooSymbol("AAA", "ETFP")).toBe("AAA.MI");
    expect(yahooSymbol("AAA", "XETR")).toBe("AAA.DE");
    expect(yahooSymbol("AAA", "XPAR")).toBe("AAA.PA");
    expect(yahooSymbol("BBB.B", "XNYS")).toBe("BBB-B");
  });

  it("is unknown for a market Yahoo does not list", () => {
    expect(yahooSymbol("AAA", "XXXX")).toBeNull();
  });
});

describe("the daily closes", () => {
  it("are one a day, on the exchange's day, inside the range", async () => {
    const { fetchFn } = source({
      "AAA.MI": {
        status: 200,
        body: chart({
          "2026-11-13": 9,
          "2026-11-16": 10.5,
          "2026-11-17": null,
          "2026-11-18": 11.123456789,
          "2026-11-23": 12,
        }),
      },
    });
    expect(await dailyCloses("AAA.MI", RANGE, { fetchFn, now: NOW })).toEqual([
      { on: "2026-11-16", close: "10.5", currency: "EUR" },
      { on: "2026-11-18", close: "11.12345679", currency: "EUR" },
    ]);
  });

  it("leave out the bar of a session still open, and keep it once closed", async () => {
    const body = chart(
      { "2026-11-19": 10, "2026-11-20": 11 },
      { regular: ["2026-11-20T08:00:00Z", "2026-11-20T16:30:00Z"] },
    );
    const { fetchFn } = source({ "AAA.MI": { status: 200, body } });
    const during = await dailyCloses("AAA.MI", RANGE, {
      fetchFn,
      now: () => new Date("2026-11-20T12:00:00Z"),
    });
    expect(during).toEqual([{ on: "2026-11-19", close: "10", currency: "EUR" }]);
    const after = await dailyCloses("AAA.MI", RANGE, {
      fetchFn,
      now: () => new Date("2026-11-20T17:00:00Z"),
    });
    expect(after).toHaveLength(2);
  });

  it("turn pence into pounds", async () => {
    const { fetchFn } = source({
      "AAA.L": { status: 200, body: chart({ "2026-11-16": 1234.5 }, { currency: "GBp" }) },
    });
    expect(await dailyCloses("AAA.L", RANGE, { fetchFn, now: NOW })).toEqual([
      { on: "2026-11-16", close: "12.345", currency: "GBP" },
    ]);
  });

  it("say why there is none", async () => {
    const { fetchFn } = source({
      "EMPTY.MI": { status: 200, body: chart({}) },
      "DOWN.MI": { status: 503, body: {} },
      "ODD.MI": { status: 200, body: { unexpected: true } },
      "BUSY.MI": { status: 429, body: {} },
    });
    const of = (symbol: string) => dailyCloses(symbol, RANGE, { fetchFn, now: NOW });
    expect(await of("EMPTY.MI")).toBe("no_data");
    expect(await of("DOWN.MI")).toBe("provider_down");
    expect(await of("ODD.MI")).toBe("provider_down");
    expect(await of("BUSY.MI")).toBe("rate_limited");
    expect(await of("GONE.MI")).toBe("unknown_symbol");
  });
});

describe("POST /prices", () => {
  const listing = (key: string, ticker: string, mic = "XMIL") => ({ key, ticker, mic, currency: "EUR" });

  it("answers the bars by key and the markets with none", async () => {
    const { fetchFn } = source({ "AAA.MI": { status: 200, body: chart({ "2026-11-16": 10 }) } });
    const answer = await prices(
      { listings: [listing("a", "AAA"), listing("b", "BBB"), listing("c", "CCC", "XXXX")], ...RANGE },
      { fetchFn, now: NOW },
    );
    expect(pricesResponseSchema.parse(answer)).toEqual({
      bars: [{ key: "a", on: "2026-11-16", close: "10", currency: "EUR" }],
      errors: [
        { key: "b", code: "unknown_symbol" },
        { key: "c", code: "unknown_symbol" },
      ],
    });
  });

  it("stops asking after the source refuses, and after its time budget", async () => {
    const { fetchFn, asked } = source({ "AAA.MI": { status: 429, body: {} } });
    const refused = await prices(
      { listings: [listing("a", "AAA"), listing("b", "BBB")], ...RANGE },
      { fetchFn },
    );
    expect(asked).toEqual(["AAA.MI"]);
    expect(refused.errors).toEqual([
      { key: "a", code: "rate_limited" },
      { key: "b", code: "rate_limited" },
    ]);
    const late = await prices(
      { listings: [listing("a", "AAA")], ...RANGE },
      { fetchFn, elapsed: () => 60_000 },
    );
    expect(late.errors).toEqual([{ key: "a", code: "rate_limited" }]);
  });

  it("refuses a range that ends before it starts", async () => {
    await expect(
      prices({ listings: [listing("a", "AAA")], from: "2026-11-20", to: "2026-11-16" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("the manifest", () => {
  it("asks no credential and reaches only Yahoo's hosts", () => {
    expect(MANIFEST.userSettings).toEqual([]);
    expect(MANIFEST.egress).toEqual(["query1.finance.yahoo.com", "query2.finance.yahoo.com"]);
    expect(MANIFEST.capabilities).toEqual(["prices.daily"]);
  });
});

describe("the server", () => {
  const SECRET = "shared-secret-shared-secret-shared-1";
  let origin = "";
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { createHandler } = await import("./server");
    const server = createServer(createHandler(SECRET, { fetchFn: source({}).fetchFn }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(() => close());

  it("keeps the contract: the kit finds nothing wrong", async () => {
    expect(await checkPlugin({ origin, secret: SECRET, id: "prices" })).toEqual([]);
  });

  it("answers prices only with the secret", async () => {
    const post = (secret: string) =>
      fetch(`${origin}${PLUGIN_PATHS.prices}`, {
        method: "POST",
        headers: { "content-type": "application/json", [SECRET_HEADER]: secret },
        body: JSON.stringify({
          listings: [{ key: "a", ticker: "AAA", mic: "XMIL", currency: "EUR" }],
          ...RANGE,
        }),
      });
    expect((await post("wrong-secret-wrong-secret-wrong-1234")).status).toBe(401);
    const answered = await post(SECRET);
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ bars: [], errors: [{ key: "a", code: "unknown_symbol" }] });
  });
});
