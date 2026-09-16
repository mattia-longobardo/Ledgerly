import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  createWalletClient,
  isTokenRejected,
  parseJsonPreservingNumbers,
  parseRetryAfterMs,
  READ_ATTEMPTS,
  WALLET_API_URL,
  WalletError,
  type WalletClientOptions,
  WRITE_ATTEMPTS,
} from "./client";

const BASE_URL = "https://wallet.test/api";
const TOKEN = "synthetic-token";
const NOW = Date.parse("2026-01-05T12:00:00.000Z");

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "tests/fixtures/wallet", name), "utf8");
}

interface Reply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

interface Stub {
  calls: { url: string; headers: Headers }[];
  sleeps: number[];
  options: WalletClientOptions;
}

/**
 * A client wired to a fake `fetch`: nothing leaves the process (there is no token to call with),
 * the backoff is recorded instead of waited through, and the jitter is fixed so the delays are
 * exact. `pageLimit: 2` is what lets a two-record fixture fill a page.
 */
function stub(answer: (url: string, index: number) => Reply): Stub {
  const calls: Stub["calls"] = [];
  const sleeps: number[] = [];
  const options: WalletClientOptions = {
    baseUrl: BASE_URL,
    pageLimit: 2,
    jitter: () => 0,
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      const reply = answer(url, calls.length - 1);
      return new Response(reply.body ?? "{}", { status: reply.status ?? 200, headers: reply.headers });
    },
  };
  return { calls, sleeps, options };
}

function always(reply: Reply): (url: string, index: number) => Reply {
  return () => reply;
}

/** The two `recordDate` bounds of a request, as the window they stand for. */
function windowOf(url: string): string {
  return new URL(url).searchParams.getAll("recordDate").join("..");
}

async function failure(run: () => Promise<unknown>): Promise<WalletError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WalletError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("createWalletClient", () => {
  it("defaults to the base URL of the spec and refuses an empty token", () => {
    expect(WALLET_API_URL).toBe("https://rest.budgetbakers.com/wallet/v1/api");
    expect(READ_ATTEMPTS).toBe(5);
    expect(WRITE_ATTEMPTS).toBe(1);
    expect(() => createWalletClient("   ")).toThrow(/token is empty/);
  });
});

describe("accounts and balances", () => {
  it("reads /accounts once, with the bearer token, and maps it", async () => {
    const { calls, options } = stub(always({ body: fixture("accounts.json") }));
    const accounts = await createWalletClient(TOKEN, options).accounts();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/accounts?limit=200`);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers.get("accept")).toBe("application/json");
    expect(accounts).toHaveLength(10);
    expect(accounts[1]).toMatchObject({ externalId: "wa-general", type: "checking", currency: "EUR" });
  });

  it("turns the page's own number literals into cents", async () => {
    const { options } = stub(always({ body: fixture("accounts.json") }));
    const balances = await createWalletClient(TOKEN, options).balances();

    expect(balances.map((balance) => balance.cents)).toEqual([
      12840n,
      261539n,
      123456789n,
      101n,
      10n,
      823107n,
      -43210n,
      9666n,
      1500000n,
      0n,
    ]);
  });

  it("reads the categories §9.1 adopts by name", async () => {
    const { calls, options } = stub(always({ body: fixture("categories.json") }));
    const categories = await createWalletClient(TOKEN, options).categories();

    expect(calls[0].url).toBe(`${BASE_URL}/categories?limit=200`);
    expect(categories.map((category) => category.name)).toEqual(["Spesa", "Stipendio", "Da classificare"]);
  });

  it("refuses a page of accounts that fills the limit, having no window to narrow", async () => {
    const account = (index: number) => ({
      id: `wa-${index}`,
      name: `Conto ${index}`,
      currencyCode: "EUR",
      accountType: "general",
      balance: { currentBalance: 1 },
    });
    const body = JSON.stringify({ accounts: Array.from({ length: 200 }, (_, index) => account(index)) });
    const { options } = stub(always({ body }));

    const error = await failure(() => createWalletClient(TOKEN, options).accounts());
    expect(error.kind).toBe("page_truncated");
  });
});

describe("a rejected token", () => {
  it.each([401, 403])("fails at once on HTTP %i", async (status) => {
    const { calls, sleeps, options } = stub(always({ status, body: '{"error":"unauthorized"}' }));

    const error = await failure(() => createWalletClient(TOKEN, options).accounts());
    expect(error.kind).toBe("token_rejected");
    expect(error.status).toBe(status);
    expect(isTokenRejected(error)).toBe(true);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe("retrying a read", () => {
  it("gives up after five attempts, doubling from 2 s to a 32 s ceiling", async () => {
    const { calls, sleeps, options } = stub(always({ status: 503, body: "upstream down" }));

    const error = await failure(() => createWalletClient(TOKEN, options).accounts());
    expect(error.kind).toBe("http");
    expect(error.status).toBe(503);
    expect(error.detail).toBe("upstream down");
    expect(calls).toHaveLength(READ_ATTEMPTS);
    expect(sleeps).toEqual([2000, 4000, 8000, 16000]);
  });

  it("waits what Retry-After asks for in seconds, not what the backoff would have picked", async () => {
    const { calls, sleeps, options } = stub((_url, index) =>
      index === 0
        ? { status: 429, body: "slow down", headers: { "retry-after": "120" } }
        : { body: fixture("accounts.json") },
    );

    await createWalletClient(TOKEN, options).accounts();
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([120_000]);
  });

  it("reads Retry-After as an HTTP date too", async () => {
    const { sleeps, options } = stub((_url, index) =>
      index === 0
        ? { status: 429, headers: { "retry-after": "Mon, 05 Jan 2026 12:01:30 GMT" } }
        : { body: fixture("accounts.json") },
    );

    await createWalletClient(TOKEN, options).accounts();
    expect(sleeps).toEqual([90_000]);
  });

  it("ignores a Retry-After it cannot read and falls back to the backoff", async () => {
    const { sleeps, options } = stub((_url, index) =>
      index === 0 ? { status: 429, headers: { "retry-after": "soon" } } : { body: fixture("accounts.json") },
    );

    await createWalletClient(TOKEN, options).accounts();
    expect(sleeps).toEqual([2000]);
  });

  it("waits out an initialising Wallet, and never retries any other conflict", async () => {
    const initialising = stub((_url, index) =>
      index === 0 ? { status: 409, body: '{"code":"INIT_SYNC"}' } : { body: fixture("accounts.json") },
    );
    await createWalletClient(TOKEN, initialising.options).accounts();
    expect(initialising.sleeps).toEqual([30_000]);

    const conflict = stub(always({ status: 409, body: '{"code":"duplicate"}' }));
    const error = await failure(() => createWalletClient(TOKEN, conflict.options).accounts());
    expect(error.kind).toBe("http");
    expect(conflict.calls).toHaveLength(1);
  });

  it("retries a transport failure and reports it as one", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const client = createWalletClient(TOKEN, {
      baseUrl: BASE_URL,
      jitter: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async (input) => {
        calls.push(String(input));
        throw new TypeError("socket hang up");
      },
    });

    const error = await failure(() => client.accounts());
    expect(error.kind).toBe("network");
    expect(error.message).toContain("socket hang up");
    expect(calls).toHaveLength(READ_ATTEMPTS);
    expect(sleeps).toHaveLength(READ_ATTEMPTS - 1);
  });

  it.each([
    ["a body that is not JSON", "<html>maintenance</html>"],
    ["a shape it does not know", '{"accounts":[{"id":"wa-1"}]}'],
  ])("never retries %s", async (_case, body) => {
    const { calls, options } = stub(always({ body }));

    const error = await failure(() => createWalletClient(TOKEN, options).accounts());
    expect(error.kind).toBe("payload");
    expect(calls).toHaveLength(1);
  });
});

describe("transactions", () => {
  it("splits the window instead of failing when a page comes back full", async () => {
    const pages: Record<string, string> = {
      "gte.2026-01-01..lte.2026-01-31": fixture("records-january-truncated.json"),
      "gte.2026-01-01..lte.2026-01-16": fixture("records-january-first-half.json"),
      "gte.2026-01-17..lte.2026-01-31": fixture("records-january-second-half-truncated.json"),
      "gte.2026-01-17..lte.2026-01-24": fixture("records-january-third-quarter.json"),
      "gte.2026-01-25..lte.2026-01-31": fixture("records-january-fourth-quarter.json"),
    };
    const { calls, options } = stub((url) => {
      const body = pages[windowOf(url)];
      // A window the test did not expect answers 418, which is not retryable: the assertion below
      // fails on the spot instead of the client spending five attempts on it.
      return body === undefined ? { status: 418, body: `unexpected window ${windowOf(url)}` } : { body };
    });

    const transactions = await createWalletClient(TOKEN, options).transactions({
      from: "2026-01-01",
      to: "2026-01-31",
    });

    expect(calls.map((call) => windowOf(call.url))).toEqual(Object.keys(pages));
    expect(calls[0].url).toBe(
      `${BASE_URL}/records?limit=2&recordDate=gte.2026-01-01&recordDate=lte.2026-01-31`,
    );
    // Three distinct movements, in a deterministic order, with the truncated pages' duplicates
    // collapsed rather than counted twice.
    expect(transactions.map((transaction) => transaction.externalId)).toEqual([
      "wr-1001",
      "wr-1002",
      "wr-1003",
    ]);
    expect(transactions.map((transaction) => transaction.amountCents)).toEqual([-862n, 190000n, -25000n]);
    expect(transactions[2].transferCounterExternalId).toBe("wr-2003");
  });

  it("says so when a single day still fills a page", async () => {
    const { options } = stub(always({ body: fixture("records-single-day-truncated.json") }));

    const error = await failure(() =>
      createWalletClient(TOKEN, options).transactions({ from: "2026-01-05", to: "2026-01-05" }),
    );
    expect(error.kind).toBe("page_truncated");
    expect(error.message).toContain("2026-01-05");
  });

  it("returns nothing for a window with no movements", async () => {
    const { calls, options } = stub(always({ body: fixture("records-empty.json") }));

    const transactions = await createWalletClient(TOKEN, options).transactions({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(transactions).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("parseRetryAfterMs", () => {
  it.each([
    ["30", 30_000],
    ["0", 0],
    ["Mon, 05 Jan 2026 12:00:30 GMT", 30_000],
    ["Mon, 05 Jan 2026 11:59:00 GMT", 0],
  ])("reads %s", (raw, expected) => {
    expect(parseRetryAfterMs(raw, NOW)).toBe(expected);
  });

  it.each([null, "", "soon"])("has no instruction from %s", (raw) => {
    expect(parseRetryAfterMs(raw, NOW)).toBeNull();
  });

  it("never asks to wait backwards", () => {
    // "-5" is not valid delta-seconds, but `Date.parse` is lenient enough to read it as a year:
    // a floor in the past is simply no floor, and the backoff decides the wait.
    expect(parseRetryAfterMs("-5", NOW)).toBe(0);
    expect(backoffDelayMs(1, 0)).toBeGreaterThan(0);
  });
});

describe("backoffDelayMs", () => {
  it("doubles up to the ceiling and adds at most a quarter of jitter", () => {
    expect([1, 2, 3, 4, 5, 6].map((attempt) => backoffDelayMs(attempt, 0))).toEqual([
      2000, 4000, 8000, 16_000, 32_000, 32_000,
    ]);
    expect(backoffDelayMs(1, 0.5)).toBe(2250);
    expect(backoffDelayMs(5, 0.999)).toBeLessThanOrEqual(40_000);
  });
});

describe("parseJsonPreservingNumbers", () => {
  it("keeps every number as the text it was written with", () => {
    expect(parseJsonPreservingNumbers('{"a":2615.39,"b":[0.1,1e3],"c":"x","d":true,"e":null}')).toEqual({
      a: "2615.39",
      b: ["0.1", "1e3"],
      c: "x",
      d: true,
      e: null,
    });
  });
});
