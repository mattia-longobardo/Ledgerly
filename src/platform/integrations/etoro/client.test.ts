// The eToro client (docs/design/investments.md §3.3, §5.1): fixed host and paths, every failure a
// class and a status, never the key — the canary test runs every error branch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceError, sourceErrorText } from "../investments/source";
import { EtoroClient, ETORO_API_URL, PAGE_SIZE } from "./client";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/etoro");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { status: number; body: unknown };

const CANARY_KEY = "canary-api-key-7f3a9c";
const CANARY_USER = "canary-user-key-41b2e8";

interface Call {
  url: string;
  init: RequestInit;
}

function fake(responses: (Response | Error | ((url: string) => Response))[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url) : next;
  }) as unknown as typeof globalThis.fetch;
  return { calls, client: new EtoroClient({ apiKey: CANARY_KEY, userKey: CANARY_USER }, { fetch }) };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function caught(promise: Promise<unknown>): Promise<SourceError> {
  return promise.then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(SourceError);
      return error as SourceError;
    },
  );
}

describe("EtoroClient requests", () => {
  it("calls the fixed real host with the key headers and a fresh request id", async () => {
    const me = fixture("me");
    const { calls, client } = fake([json(200, me.body), json(200, me.body)]);
    await client.me();
    await client.me();
    expect(calls[0].url).toBe(`${ETORO_API_URL}/api/v1/me`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(CANARY_KEY);
    expect(headers["x-user-key"]).toBe(CANARY_USER);
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((calls[1].init.headers as Record<string, string>)["x-request-id"]).not.toBe(
      headers["x-request-id"],
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls.every((call) => !call.url.includes("/demo/"))).toBe(true);
  });

  it("always asks for the zero balances (E7)", async () => {
    const { calls, client } = fake([json(200, fixture("balances-eur-include-zero").body)]);
    await client.balances("EUR");
    expect(calls[0].url).toBe(
      `${ETORO_API_URL}/api/v1/balances?displayCurrency=EUR&includeZeroBalances=true`,
    );
  });

  it("pages the trade history until a short page (E4)", async () => {
    const row = (fixture("trade-history").body as unknown[])[0];
    const full = Array.from({ length: PAGE_SIZE }, () => row);
    const { calls, client } = fake([
      json(200, full),
      json(200, fixture("trade-history-page-out-of-range").body),
    ]);
    const trades = await client.trades("2020-01-01");
    expect(trades).toHaveLength(PAGE_SIZE);
    expect(calls.map((call) => new URL(call.url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(new URL(calls[0].url).searchParams.get("minDate")).toBe("2020-01-01");
  });

  it("follows the cash cursor until hasNext is false (E5)", async () => {
    const page = fixture("cash-transactions-page").body;
    const all = fixture("cash-transactions-all").body;
    const { calls, client } = fake([json(200, page), json(200, all)]);
    const rows = await client.cashTransactions("00000000-0000-4000-8000-000000000004");
    expect(rows.length).toBeGreaterThan(5);
    expect(new URL(calls[1].url).searchParams.get("pageToken")).toBe("6:40880682");
  });

  it("refuses an account id that is not a plain id, before any call", async () => {
    const { calls, client } = fake([]);
    await caught(client.cashTransactions("../me"));
    expect(calls).toHaveLength(0);
  });
});

describe("EtoroClient failures (§5.1)", () => {
  const branches: [string, (Response | Error)[], string, number | null][] = [
    ["401", [json(401, { message: `bad key ${CANARY_KEY}` })], "auth", 401],
    [
      "403",
      [json(fixture("sub-accounts-forbidden").status, fixture("sub-accounts-forbidden").body)],
      "permission",
      403,
    ],
    ["429", [json(429, { errorCode: "TooManyRequests" }, { "retry-after": "30" })], "rate_limited", 429],
    ["503", [json(503, fixture("closed-events-unavailable").body)], "unavailable", 503],
    ["400 currency", [json(400, fixture("balances-unsupported-currency").body)], "unsupported_currency", 400],
    ["400 other", [json(400, fixture("balances-history-range-too-large").body)], "bad_response", 400],
    ["not json", [new Response(`<html>${CANARY_KEY}</html>`, { status: 200 })], "bad_response", 200],
    ["schema", [json(200, { gcid: "x", scopes: CANARY_KEY })], "schema_mismatch", 200],
    ["network", [new TypeError(`fetch failed for ${CANARY_USER}`)], "network", null],
    [
      "timeout",
      [Object.assign(new Error(`timed out ${CANARY_KEY}`), { name: "TimeoutError" })],
      "timeout",
      null,
    ],
  ];

  for (const [name, responses, errorClass, status] of branches) {
    it(`${name} → ${errorClass}, with no trace of the key`, async () => {
      const { client } = fake([...responses]);
      const error = await caught(client.me());
      expect(error.errorClass).toBe(errorClass);
      expect(error.status).toBe(status);
      const text = [
        error.message,
        String(error),
        error.stack ?? "",
        sourceErrorText("etoro", error),
        JSON.stringify(error),
      ].join(" ");
      expect(text).not.toContain(CANARY_KEY);
      expect(text).not.toContain(CANARY_USER);
    });
  }

  it("carries Retry-After, or ratelimit-reset, as the backoff (SEC-09)", async () => {
    const first = fake([json(429, {}, { "retry-after": "30" })]);
    expect((await caught(first.client.me())).retryAfterSeconds).toBe(30);
    const second = fake([json(429, {}, { "ratelimit-reset": "12.2" })]);
    expect((await caught(second.client.me())).retryAfterSeconds).toBe(13);
  });
});
