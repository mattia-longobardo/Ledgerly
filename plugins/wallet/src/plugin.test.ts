import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLUGIN_PATHS, SECRET_HEADER, verifyResponseSchema } from "@plugin-contract/calls";
import {
  editResponseSchema,
  pushResponseSchema,
  SOURCE_PATHS,
  sourceAccountsResponseSchema,
  sourceCategoriesResponseSchema,
  sourceMovementsResponseSchema,
  sourceRecordResponseSchema,
  writeCategoriesResponseSchema,
} from "@ledgerly/plugin-contract";
import { errorBodySchema } from "@plugin-contract/errors";
import { checkPlugin } from "@plugin-contract/kit";
import { manifestSchema } from "@plugin-contract/manifest";
import { planRecordEdit } from "./edit";
import { type Deps, isUsableToken } from "./handlers";
import { backoffDelayMs, parseJsonPreservingNumbers, parseRetryAfterMs } from "./http";
import { noteWithMarker, sendMarker, splitSendMarker } from "./marker";
import { MANIFEST } from "./manifest";
import { walletAmountToCents } from "./money";
import { isMovementRefusal } from "./push";
import type { RecordView } from "./records";
import { WalletError } from "./failure";

process.env.PLUGIN_NO_LISTEN = "1";

const SECRET = "a-shared-secret-of-the-core-and-the-plugin";
const TOKEN = "synthetic-token";
const CREDENTIALS = { token: TOKEN };
const NOW = Date.parse("2026-01-05T12:00:00.000Z");
const API = "/wallet/v1/api";
const KEY = "mov-0001-abcd";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "test/fixtures/wallet", name), "utf8");
}

interface Reply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

interface Call {
  method: string;
  /** The path under the API's base, with its query. */
  path: string;
  headers: Headers;
  body: string | null;
}

/**
 * Wallet made of canned answers: nothing leaves the process, the backoff is recorded instead of
 * waited through, and `pageLimit: 2` lets a fixture of two rows fill a page.
 */
function fakeWallet(answer: (call: Call, index: number) => Reply, over: Partial<Deps> = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const deps: Deps = {
    pageLimit: 2,
    jitter: () => 0,
    now: () => NOW,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
    fetchFn: async (input, init) => {
      const url = new URL(String(input));
      expect(url.host).toBe("rest.budgetbakers.com");
      const call: Call = {
        method: init?.method ?? "GET",
        path: `${url.pathname.replace(API, "")}${decodeURIComponent(url.search)}`,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      const reply = answer(call, calls.length - 1);
      return new Response(reply.body ?? "{}", { status: reply.status ?? 200, headers: reply.headers });
    },
    ...over,
  };
  return { calls, sleeps, deps };
}

const always = (reply: Reply) => () => reply;

/** A plugin server on a free port, wired to `deps`; closed by the returned function. */
async function serve(deps: Deps): Promise<{ origin: string; close: () => Promise<void> }> {
  const { createHandler } = await import("./server");
  const server = createServer(createHandler(SECRET, deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** One call through the real server: the status and the JSON body. */
async function call(deps: Deps, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const { origin, close } = await serve(deps);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await close();
  }
}

/** A `/records` page as Wallet sends one, for a window it says it applied. */
function recordsBody(from: string, until: string, records: readonly unknown[]): string {
  return JSON.stringify({
    records,
    appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${until}T00:00:00.000Z`],
  });
}

function walletRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wr-1",
    accountId: "wa-general",
    amount: { value: -42.5, currencyCode: "EUR" },
    recordDate: "2026-02-03",
    category: null,
    labels: [],
    recordType: "expense",
    recordState: "cleared",
    note: "lunch",
    counterParty: "Bistro",
    transfer: null,
    ...over,
  };
}

describe("the contract", () => {
  let origin = "";
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { deps } = fakeWallet(always({ status: 500, body: '{"error":"the provider\'s own words"}' }));
    ({ origin, close } = await serve(deps));
  });
  afterAll(() => close());

  it("is kept, as the kit checks it", async () => {
    expect(await checkPlugin({ origin, secret: SECRET, id: "wallet" })).toEqual([]);
  });

  it("answers the health check without the secret", async () => {
    expect(await (await fetch(`${origin}${PLUGIN_PATHS.health}`)).json()).toEqual({ status: "ok" });
  });

  it("never sends the provider's words, only a code", async () => {
    const response = await fetch(`${origin}${SOURCE_PATHS.accounts}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
      body: JSON.stringify({ credentials: CREDENTIALS }),
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(errorBodySchema.parse(JSON.parse(text)).error.code).toBe("provider_down");
    expect(text).not.toContain("own words");
  });
});

describe("the manifest", () => {
  it("is a manifest of contract 2 with the version of the app", () => {
    expect(manifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
    const root: unknown = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(root).toMatchObject({ version: MANIFEST.version });
    expect(MANIFEST.capabilities).toContain("source.read");
    expect(MANIFEST.capabilities).not.toContain("ledgerPosting");
    expect(MANIFEST.userSettings.every((field) => field.writeOnly)).toBe(true);
  });
});

describe("verify", () => {
  it("says write for a token Wallet takes, with one read", async () => {
    const { calls, deps } = fakeWallet(always({ body: fixture("accounts.json") }));
    const answer = await call(deps, PLUGIN_PATHS.verify, { credentials: { token: `  ${TOKEN}\n` } });
    expect(verifyResponseSchema.parse(answer.body)).toEqual({ access: "write" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each([401, 403])("answers 403 auth, at once, when Wallet answers %i", async (status) => {
    const { calls, sleeps, deps } = fakeWallet(always({ status, body: '{"error":"unauthorized"}' }));
    const answer = await call(deps, PLUGIN_PATHS.verify, { credentials: CREDENTIALS });
    expect(answer).toEqual({ status: 403, body: { error: { code: "auth" } } });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it.each([
    ["a carriage return", "secret\rtoken"],
    ["a NUL", "secret\u0000token"],
    ["a code point above 0xff", "token→"],
  ])("refuses a token with %s as key_format, without a request", async (_case, token) => {
    const { calls, deps } = fakeWallet(always({ body: fixture("accounts.json") }));
    const answer = await call(deps, PLUGIN_PATHS.verify, { credentials: { token } });
    expect(answer).toEqual({ status: 400, body: { error: { code: "key_format" } } });
    expect(calls).toEqual([]);
  });

  it("asks for the token by name", async () => {
    const { deps } = fakeWallet(always({ body: fixture("accounts.json") }));
    const answer = await call(deps, PLUGIN_PATHS.verify, { credentials: { other: TOKEN } });
    expect(answer.status).toBe(400);
  });

  it("takes every byte a header may carry", () => {
    expect(isUsableToken("eyJhbGciOiJIUzI1NiJ9.e30.-_=")).toBe(true);
    expect(isUsableToken("perché")).toBe(true);
    expect(isUsableToken("   ")).toBe(false);
  });
});

describe("accounts", () => {
  it("gives every account with its balance as an exact decimal and its number unchecked", async () => {
    const { calls, deps } = fakeWallet(always({ body: fixture("accounts.json") }));
    const answer = await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS });
    const { accounts } = sourceAccountsResponseSchema.parse(answer.body);
    expect(calls[0].path).toBe("/accounts?limit=200");
    expect(accounts.map((account) => [account.externalId, account.type, account.balance])).toEqual([
      ["wa-cash", "cash", "128.40"],
      ["wa-general", "checking", "2615.39"],
      ["wa-current", "checking", "1234567.89"],
      ["wa-saving", "savings", "1.01"],
      ["wa-savings", "savings", "0.10"],
      ["wa-investment", "investment", "8231.07"],
      ["wa-credit", "credit", "-432.10"],
      ["wa-crypto", "crypto", "96.66"],
      ["wa-brokerage", "investment", "15000.00"],
      ["wa-mystery", "other", "0.00"],
    ]);
    expect(accounts[0]).toMatchObject({
      name: "Contanti",
      currency: "EUR",
      available: null,
      archived: false,
    });
    expect(accounts[2].currency).toBe("EUR");
  });

  it("gives Wallet's account number as it is: the core decides whether it is an IBAN", async () => {
    const body = JSON.stringify({
      accounts: [
        {
          id: "a1",
          name: "A",
          currencyCode: "EUR",
          bankAccountNumber: " 12345 ",
          balance: { currentBalance: 1 },
        },
        { id: "a2", name: "B", currencyCode: "EUR", balance: { currentBalance: 1 } },
      ],
    });
    const { deps } = fakeWallet(always({ body }));
    const { accounts } = sourceAccountsResponseSchema.parse(
      (await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS })).body,
    );
    expect(accounts.map((account) => account.identifier)).toEqual(["12345", null]);
  });

  it("refuses a page that fills the limit, having no window to narrow", async () => {
    const account = (index: number) => ({
      id: `wa-${index}`,
      name: `Conto ${index}`,
      currencyCode: "EUR",
      balance: { currentBalance: 1 },
    });
    const body = JSON.stringify({ accounts: Array.from({ length: 200 }, (_, index) => account(index)) });
    const { deps } = fakeWallet(always({ body }));
    const answer = await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS });
    expect(answer).toEqual({ status: 502, body: { error: { code: "invalid_data" } } });
  });
});

describe("categories", () => {
  it("gives the list, with Wallet's Transfer category and its three levels", async () => {
    const body = JSON.stringify({
      categories: [
        ...JSON.parse(fixture("categories.json")).categories,
        { id: "wc-transfer", name: "Trasferimento", systemId: "system_categories__transfer" },
        { id: "wc-bakery", name: "Forno", customCategory: true, parentId: "wc-groceries", archived: true },
      ],
    });
    const { calls, deps } = fakeWallet(always({ body }));
    const answer = await call(deps, SOURCE_PATHS.categories, { credentials: CREDENTIALS });
    const { categories } = sourceCategoriesResponseSchema.parse(answer.body);
    expect(calls[0].path).toBe("/categories?limit=200");
    expect(categories[0]).toEqual({
      externalId: "wc-groceries",
      name: "Spesa",
      groupExternalId: "wcg-casa",
      groupName: "Casa",
      transfer: false,
      custom: false,
      parentExternalId: null,
      archived: false,
    });
    expect(categories.filter((one) => one.transfer).map((one) => one.externalId)).toEqual(["wc-transfer"]);
    expect(categories[4]).toMatchObject({ custom: true, parentExternalId: "wc-groceries", archived: true });
  });
});

describe("movements of a window", () => {
  const JANUARY = { credentials: CREDENTIALS, from: "2026-01-01", to: "2026-01-31" };

  it("splits the window while a page comes back full, and gives each movement once", async () => {
    const pages: Record<string, string> = {
      "2026-01-01..2026-01-31": fixture("records-january-truncated.json"),
      "2026-01-01..2026-01-16": fixture("records-january-first-half.json"),
      "2026-01-17..2026-01-31": fixture("records-january-second-half-truncated.json"),
      "2026-01-17..2026-01-24": fixture("records-january-third-quarter.json"),
      "2026-01-25..2026-01-31": fixture("records-january-fourth-quarter.json"),
    };
    const windowOf = (path: string) =>
      new URLSearchParams(path.split("?")[1])
        .getAll("recordDate")
        .map((bound) => bound.slice(4))
        .join("..");
    const { calls, deps } = fakeWallet((request) => {
      const body = pages[windowOf(request.path)];
      return body === undefined ? { status: 418 } : { body };
    });
    const answer = await call(deps, SOURCE_PATHS.movements, JANUARY);
    const { movements } = sourceMovementsResponseSchema.parse(answer.body);

    expect(calls.map((request) => windowOf(request.path))).toEqual(Object.keys(pages));
    expect(calls[0].path).toBe("/records?limit=2&recordDate=gte.2026-01-01&recordDate=lte.2026-01-31");
    expect(movements.map((movement) => [movement.externalId, movement.amount, movement.day])).toEqual([
      ["wr-1001", "-8.62", "2026-01-05"],
      ["wr-1002", "1900.00", "2026-01-20"],
      ["wr-1003", "-250.00", "2026-01-28"],
    ]);
    expect(movements[0]).toEqual({
      externalId: "wr-1001",
      accountExternalId: "wa-general",
      counterpartExternalId: null,
      day: "2026-01-05",
      instant: null,
      amount: "-8.62",
      currency: "EUR",
      payee: "Panificio Rossi",
      note: "pane e latte",
      sentKey: null,
      category: {
        externalId: "wc-groceries",
        name: "Spesa",
        groupExternalId: "wcg-casa",
        groupName: "Casa",
        transfer: false,
      },
      labels: ["spesa"],
      type: "expense",
      state: "cleared",
    });
    expect(movements[1]).toMatchObject({ instant: "2026-01-20T23:40:00.000Z", type: "income" });
    expect(movements[2]).toMatchObject({ counterpartExternalId: "wr-2003", payee: null, type: "transfer" });
  });

  it("reads the edge cases: no mirror, a rounded amount, a category with no name, odd labels", async () => {
    const { deps } = fakeWallet(always({ body: fixture("records-edge-cases.json") }), { pageLimit: 200 });
    const { movements } = sourceMovementsResponseSchema.parse(
      (await call(deps, SOURCE_PATHS.movements, JANUARY)).body,
    );
    expect(movements.map((movement) => movement.counterpartExternalId)).toEqual([null, null, null]);
    expect(movements[1].amount).toBe("1.00");
    expect(movements[2]).toMatchObject({
      currency: "EUR",
      labels: ["casa", "spesa"],
      category: {
        externalId: "wc-unsorted",
        name: null,
        groupExternalId: null,
        groupName: null,
        transfer: false,
      },
    });
  });

  it("takes the marker off the note, and says the transfer category, the unknown type and state", async () => {
    const records = [
      walletRecord({
        note: noteWithMarker("lunch", KEY),
        recordType: "Refund",
        recordState: "voided",
        category: { id: "wc-t", name: "Trasferimento", systemId: "system_categories__transfer" },
      }),
      walletRecord({ id: "wr-2", note: sendMarker(KEY), recordType: "Deposit", recordState: "Planned" }),
    ];
    const { deps } = fakeWallet(always({ body: recordsBody("2026-02-01", "2026-03-01", records) }), {
      pageLimit: 3,
    });
    const { movements } = sourceMovementsResponseSchema.parse(
      (
        await call(deps, SOURCE_PATHS.movements, {
          credentials: CREDENTIALS,
          from: "2026-02-01",
          to: "2026-02-28",
        })
      ).body,
    );
    expect(movements[0]).toMatchObject({ note: "lunch", sentKey: KEY, type: null, state: null });
    expect(movements[0].category).toMatchObject({ externalId: "wc-t", transfer: true });
    expect(movements[1]).toMatchObject({ note: null, sentKey: KEY, type: "income", state: "pending" });
  });

  it.each([
    [
      "a single day that still fills a page",
      "records-single-day-truncated.json",
      "2026-01-05",
      "2026-01-05",
      2,
    ],
    ["a movement outside the window", "records-outside-window.json", "2026-02-01", "2026-02-28", 3],
    [
      "more records than the limit asked for",
      "records-january-truncated.json",
      "2026-01-01",
      "2026-01-31",
      1,
    ],
  ])("refuses %s as invalid data", async (_case, name, from, to, pageLimit) => {
    const { calls, deps } = fakeWallet(always({ body: fixture(name) }), { pageLimit });
    const answer = await call(deps, SOURCE_PATHS.movements, { credentials: CREDENTIALS, from, to });
    expect(answer).toEqual({ status: 502, body: { error: { code: "invalid_data" } } });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["narrower than the window", ["gte.2026-01-01T00:00:00.000Z", "lt.2026-01-16T00:00:00.000Z"]],
    ["without the last day", ["gte.2026-01-01T00:00:00.000Z", "lt.2026-01-31T00:00:00.000Z"]],
    ["with no date filter", []],
    ["bounded on one side", ["gte.2026-01-01T00:00:00.000Z"]],
    ["with a filter it cannot read", ["gte.2026-01-01T00:00:00.000Z", "before.tomorrow"]],
  ])("refuses an answer whose applied window is %s", async (_case, appliedRecordDateFilters) => {
    const { deps } = fakeWallet(always({ body: JSON.stringify({ records: [], appliedRecordDateFilters }) }));
    const answer = await call(deps, SOURCE_PATHS.movements, JANUARY);
    expect(answer.status).toBe(502);
  });

  it("accepts a wider window and an inclusive upper bound", async () => {
    for (const appliedRecordDateFilters of [
      ["gt.2025-12-31T00:00:00.000Z", "lt.2026-03-01T00:00:00.000Z"],
      ["gte.2026-01-01T00:00:00.000Z", "lte.2026-01-31T23:59:59.999Z"],
    ]) {
      const { deps } = fakeWallet(
        always({ body: JSON.stringify({ records: [], appliedRecordDateFilters }) }),
      );
      expect((await call(deps, SOURCE_PATHS.movements, JANUARY)).body).toEqual({ movements: [] });
    }
  });

  it("refuses a page where no record carries a field whose name was never verified", async () => {
    const records = [walletRecord({ recordType: undefined })];
    const { deps } = fakeWallet(always({ body: recordsBody("2026-02-01", "2026-03-01", records) }));
    const answer = await call(deps, SOURCE_PATHS.movements, {
      credentials: CREDENTIALS,
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(answer.status).toBe(502);
  });

  it.each([
    ["ends before it starts", "2026-02-01", "2026-01-01"],
    ["is not a day", "2026-02-30", "2026-03-01"],
    ["is wider than the reader goes", "2024-01-01", "2026-01-01"],
  ])("refuses a window that %s without a request", async (_case, from, to) => {
    const { calls, deps } = fakeWallet(always({ body: fixture("records-empty.json") }));
    const answer = await call(deps, SOURCE_PATHS.movements, { credentials: CREDENTIALS, from, to });
    expect(answer.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("retrying a read", () => {
  it("gives up after five attempts, doubling from 2 s, as provider_down", async () => {
    const { calls, sleeps, deps } = fakeWallet(always({ status: 503, body: "upstream down" }));
    const answer = await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS });
    expect(answer).toEqual({ status: 502, body: { error: { code: "provider_down" } } });
    expect(calls).toHaveLength(5);
    expect(sleeps).toEqual([2000, 4000, 8000, 16000]);
  });

  it("waits a short Retry-After, and hands a long one back to the core", async () => {
    const short = fakeWallet((_call, index) =>
      index === 0 ? { status: 429, headers: { "retry-after": "5" } } : { body: fixture("accounts.json") },
    );
    expect((await call(short.deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS })).status).toBe(200);
    expect(short.sleeps).toEqual([5000]);

    const long = fakeWallet(always({ status: 429, headers: { "retry-after": "120" } }));
    const answer = await call(long.deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS });
    expect(answer).toEqual({
      status: 429,
      body: { error: { code: "rate_limited", retryAfterSeconds: 120 } },
    });
    expect(long.calls).toHaveLength(1);
    expect(long.sleeps).toEqual([]);
  });

  it("hands back the wait of a Wallet still initialising, and never retries another conflict", async () => {
    const initialising = fakeWallet(always({ status: 409, body: '{"code":"INIT_SYNC"}' }));
    expect((await call(initialising.deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS })).body).toEqual(
      {
        error: { code: "provider_down", retryAfterSeconds: 30 },
      },
    );
    const conflict = fakeWallet(always({ status: 409, body: '{"code":"duplicate"}' }));
    expect((await call(conflict.deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS })).body).toEqual({
      error: { code: "failed" },
    });
    expect(conflict.calls).toHaveLength(1);
  });

  it("never retries a 400 or a body it cannot read", async () => {
    for (const reply of [
      { status: 400, body: '{"error":"limit must be at most 200"}' },
      { body: "<html>" },
    ]) {
      const { calls, deps } = fakeWallet(always(reply));
      expect((await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS })).status).toBe(
        reply.status === 400 ? 500 : 502,
      );
      expect(calls).toHaveLength(1);
    }
  });

  it("retries a transport failure, and reports it as provider_down", async () => {
    const { deps, sleeps } = fakeWallet(always({}), {
      fetchFn: async () => {
        throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
      },
    });
    const answer = await call(deps, SOURCE_PATHS.accounts, { credentials: CREDENTIALS });
    expect(answer).toEqual({ status: 502, body: { error: { code: "provider_down" } } });
    expect(sleeps).toHaveLength(4);
  });

  it("reads Retry-After as seconds or a date, and never backwards", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
    expect(parseRetryAfterMs("Mon, 05 Jan 2026 12:00:30 GMT", NOW)).toBe(30_000);
    expect(parseRetryAfterMs("Mon, 05 Jan 2026 11:59:00 GMT", NOW)).toBe(0);
    expect(parseRetryAfterMs("soon", NOW)).toBeNull();
    expect([1, 2, 5, 6].map((attempt) => backoffDelayMs(attempt, 0))).toEqual([2000, 4000, 32_000, 32_000]);
    expect(backoffDelayMs(1, 0.5)).toBe(2250);
  });
});

describe("one record", () => {
  it("is found by its id, or is null", async () => {
    const { calls, deps } = fakeWallet((request) =>
      request.path.includes("id=wr-1&")
        ? { body: JSON.stringify({ records: [walletRecord()] }) }
        : { body: '{"records":[]}' },
    );
    const found = await call(deps, SOURCE_PATHS.record, { credentials: CREDENTIALS, externalId: "wr-1" });
    expect(sourceRecordResponseSchema.parse(found.body).movement).toMatchObject({
      amount: "-42.50",
      payee: "Bistro",
    });
    expect(calls[0].path).toBe("/records?id=wr-1&limit=1");
    const gone = await call(deps, SOURCE_PATHS.record, { credentials: CREDENTIALS, externalId: "wr-9" });
    expect(gone.body).toEqual({ movement: null });
  });
});

describe("push", () => {
  const PUSH = {
    credentials: CREDENTIALS,
    idempotencyKey: KEY,
    askedOn: null,
    movement: {
      accountExternalId: "wa-general",
      day: "2026-02-03",
      amount: "-42.50",
      payee: "Bistro",
      note: "lunch",
      categoryExternalId: "wc-food",
    },
  };
  const patched = JSON.stringify({ results: [{ inputIndex: 0, success: true, record: null }] });

  it("creates one record with the marker and the exact amount, then sends the payee", async () => {
    const { calls, deps } = fakeWallet((request) =>
      request.method === "POST" ? { body: '[{"id":"wr-new"}]' } : { body: patched },
    );
    const answer = await call(deps, SOURCE_PATHS.push, PUSH);
    expect(pushResponseSchema.parse(answer.body)).toEqual({ externalId: "wr-new", payeeSent: true });
    expect(calls.map((request) => request.method)).toEqual(["POST", "PATCH"]);
    expect(calls[0].body).toBe(
      `[{"accountId":"wa-general","amount":-42.50,"recordDate":"2026-02-03","note":${JSON.stringify(`lunch\n${sendMarker(KEY)}`)},"categoryId":"wc-food"}]`,
    );
    expect(calls[1].body).toBe('[{"id":"wr-new","counterParty":"Bistro"}]');
  });

  it("leaves the category out when there is none, and needs no edit without a payee", async () => {
    const { calls, deps } = fakeWallet(always({ body: '{"records":[{"id":"wr-new"}]}' }));
    const movement = { ...PUSH.movement, categoryExternalId: null, payee: null };
    const answer = await call(deps, SOURCE_PATHS.push, { ...PUSH, movement });
    expect(answer.body).toEqual({ externalId: "wr-new", payeeSent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).not.toContain("categoryId");
  });

  it("looks first for a movement asked for before, and creates nothing when it is there", async () => {
    const found = JSON.stringify({
      records: [
        walletRecord({ id: "wr-other", amount: { value: -1, currencyCode: "EUR" } }),
        walletRecord({ id: "wr-old" }),
      ],
    });
    const { calls, deps } = fakeWallet((request) =>
      request.method === "GET" ? { body: found } : { body: patched },
    );
    const answer = await call(deps, SOURCE_PATHS.push, { ...PUSH, askedOn: "2026-02-01" });
    expect(answer.body).toEqual({ externalId: "wr-old", payeeSent: true });
    expect(calls.map((request) => request.method)).toEqual(["GET", "PATCH"]);
    expect(calls[0].path).toBe(
      `/records?limit=5&accountId=eq.wa-general&recordDate=eq.2026-02-01&note=contains.${sendMarker(KEY)}`,
    );
  });

  it("creates the movement asked for before when it is not there", async () => {
    const { calls, deps } = fakeWallet((request) =>
      request.method === "GET" ? { body: '{"records":[]}' } : { body: '[{"id":"wr-new"}]' },
    );
    const answer = await call(deps, SOURCE_PATHS.push, {
      ...PUSH,
      askedOn: "2026-02-01",
      movement: { ...PUSH.movement, payee: null },
    });
    expect(answer.body).toEqual({ externalId: "wr-new", payeeSent: true });
    expect(calls.map((request) => request.method)).toEqual(["GET", "POST"]);
  });

  it("says unsure when the answer carries no id, and keeps the payee", async () => {
    const { calls, deps } = fakeWallet(always({ body: "[]" }));
    expect((await call(deps, SOURCE_PATHS.push, PUSH)).body).toEqual({ externalId: null, payeeSent: false });
    expect(calls).toHaveLength(1);
  });

  it("says when Wallet did not take the payee, and fails nothing", async () => {
    const { deps } = fakeWallet((request) =>
      request.method === "POST"
        ? { body: '[{"id":"wr-new"}]' }
        : { status: 400, body: '{"error":"too long"}' },
    );
    expect((await call(deps, SOURCE_PATHS.push, PUSH)).body).toEqual({
      externalId: "wr-new",
      payeeSent: false,
    });
  });

  it.each([
    ["a 400", { status: 400, body: '{"error":"amount must not be zero"}' }],
    ["a 404", { status: 404 }],
    ["an answer nobody can read", { body: "<html>" }],
  ])("answers 422 refused to %s", async (_case, reply) => {
    const { calls, deps } = fakeWallet(always(reply));
    expect(await call(deps, SOURCE_PATHS.push, PUSH)).toEqual({
      status: 422,
      body: { error: { code: "refused" } },
    });
    expect(calls).toHaveLength(1);
  });

  it("never writes twice, and fails a 5xx as the connection's", async () => {
    const { calls, deps } = fakeWallet(always({ status: 503 }));
    expect(await call(deps, SOURCE_PATHS.push, PUSH)).toEqual({
      status: 502,
      body: { error: { code: "provider_down" } },
    });
    expect(calls).toHaveLength(1);
  });

  it("tells a refusal of one movement from a failure of the connection", () => {
    expect(isMovementRefusal(new WalletError("http", "x", { status: 400 }))).toBe(true);
    expect(isMovementRefusal(new WalletError("payload", "x"))).toBe(true);
    expect(isMovementRefusal(new WalletError("http", "x", { status: 429 }))).toBe(false);
    expect(isMovementRefusal(new WalletError("token_rejected", "x", { status: 401 }))).toBe(false);
    expect(isMovementRefusal(new WalletError("network", "x"))).toBe(false);
  });
});

describe("the marker", () => {
  it("goes on a line of its own after the note, and comes off a note read back", () => {
    expect(noteWithMarker("lunch", KEY)).toBe(`lunch\n${sendMarker(KEY)}`);
    expect(noteWithMarker("  ", KEY)).toBe(sendMarker(KEY));
    expect(splitSendMarker(noteWithMarker("lunch", KEY))).toEqual({ note: "lunch", key: KEY });
    expect(splitSendMarker(sendMarker(KEY))).toEqual({ note: null, key: KEY });
    expect(splitSendMarker("lunch")).toEqual({ note: "lunch", key: null });
    expect(splitSendMarker(null)).toEqual({ note: null, key: null });
  });
});

function view(over: Partial<RecordView["movement"]> = {}, extra: Partial<RecordView> = {}): RecordView {
  return {
    cents: -4_250n,
    note: "lunch",
    isTransfer: false,
    ...extra,
    movement: {
      externalId: "wr-1",
      accountExternalId: "wa-1",
      counterpartExternalId: null,
      day: "2026-09-20",
      instant: null,
      amount: "-42.50",
      currency: "EUR",
      payee: "Bistro",
      note: "lunch",
      sentKey: null,
      category: null,
      labels: [],
      type: "expense",
      state: "cleared",
      ...over,
    },
  };
}

describe("planning an edit", () => {
  const same = { type: "expense" as const, amount: "42.50", payee: "Bistro", note: "lunch" };
  const transferCategory = {
    externalId: "wc-t",
    name: "Transfer",
    groupExternalId: null,
    groupName: null,
    transfer: true,
  };

  it("sends nothing when the edit is what Wallet already holds", () => {
    expect(planRecordEdit(view(), same, null)).toBeNull();
  });

  it("turns an expense into an income by the sign alone, whatever sign was typed", () => {
    expect(planRecordEdit(view(), { ...same, type: "income" }, null)).toEqual({ id: "wr-1", cents: 4_250n });
    expect(planRecordEdit(view(), { ...same, amount: "10" }, null)).toEqual({ id: "wr-1", cents: -1_000n });
  });

  it("clears an emptied note and payee instead of sending blanks", () => {
    expect(planRecordEdit(view(), { ...same, note: " ", payee: null }, null)).toEqual({
      id: "wr-1",
      clear: ["note", "counterParty"],
    });
  });

  it("makes a giroconto through Wallet's Transfer category, keeping the direction", () => {
    expect(planRecordEdit(view(), { ...same, type: "transfer" }, "wc-t")).toEqual({
      id: "wr-1",
      categoryId: "wc-t",
    });
    expect(planRecordEdit(view(), { ...same, type: "transfer" }, null)).toBe("no_transfer_category");
  });

  it("undoes a transfer with $clear transfer, or takes a record out of the Transfer category", () => {
    expect(planRecordEdit(view({}, { isTransfer: true }), same, null)).toEqual({
      id: "wr-1",
      clear: ["transfer"],
    });
    expect(planRecordEdit(view({ category: transferCategory }), same, null)).toEqual({
      id: "wr-1",
      clear: ["categoryId"],
    });
  });

  it("refuses a zero amount", () => {
    expect(planRecordEdit(view(), { ...same, amount: "0.00" }, null)).toBe("zero_amount");
  });
});

describe("edit", () => {
  const EDIT = {
    credentials: CREDENTIALS,
    externalId: "wr-1",
    edit: { type: "income", amount: "42.50", payee: "Bistro", note: "lunch" },
  };
  const held = JSON.stringify({ records: [walletRecord()] });
  const saved = (record: unknown) => JSON.stringify({ results: [{ inputIndex: 0, success: true, record }] });

  it("answers unchanged without a write when Wallet already holds the edit", async () => {
    const { calls, deps } = fakeWallet(always({ body: held }));
    const answer = await call(deps, SOURCE_PATHS.edit, { ...EDIT, edit: { ...EDIT.edit, type: "expense" } });
    expect(answer.body).toEqual({ state: "unchanged" });
    expect(calls).toHaveLength(1);
  });

  it("patches the exact decimal and answers the movement Wallet holds now", async () => {
    const { calls, deps } = fakeWallet((request) =>
      request.method === "GET"
        ? { body: held }
        : {
            body: saved(walletRecord({ amount: { value: 42.5, currencyCode: "EUR" }, recordType: "income" })),
          },
    );
    const answer = editResponseSchema.parse((await call(deps, SOURCE_PATHS.edit, EDIT)).body);
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      path: "/records",
      body: '[{"id":"wr-1","amount":{"value":42.50}}]',
    });
    expect(answer).toMatchObject({ state: "saved", movement: { amount: "42.50", type: "income" } });
  });

  it("reads the record again when the answer carried none", async () => {
    const { calls, deps } = fakeWallet((request) =>
      request.method === "GET" ? { body: held } : { body: saved(null) },
    );
    const answer = editResponseSchema.parse((await call(deps, SOURCE_PATHS.edit, EDIT)).body);
    expect(calls.map((request) => request.method)).toEqual(["GET", "PATCH", "GET"]);
    expect(answer.state).toBe("saved");
  });

  it("looks the Transfer category up only to make a transfer", async () => {
    const categories = JSON.stringify({
      categories: [{ id: "wc-t", name: "Trasferimento", systemId: "system_categories__transfer" }],
    });
    const { calls, deps } = fakeWallet((request) => {
      if (request.path.startsWith("/categories")) return { body: categories };
      return request.method === "GET" ? { body: held } : { body: saved(null) };
    });
    const transfer = { ...EDIT, edit: { ...EDIT.edit, type: "transfer" } };
    await call(deps, SOURCE_PATHS.edit, transfer);
    expect(calls.find((request) => request.method === "PATCH")?.body).toBe(
      '[{"id":"wr-1","categoryId":"wc-t"}]',
    );
  });

  it.each([
    ["gone", "a record Wallet no longer has", () => ({ body: '{"records":[]}' }), EDIT.edit],
    ["zero_amount", "a zero amount", () => ({ body: held }), { ...EDIT.edit, amount: "0" }],
    [
      "no_transfer_category",
      "a transfer with no Transfer category in Wallet",
      (request: Call) => ({
        body: request.path.startsWith("/categories") ? fixture("categories.json") : held,
      }),
      { ...EDIT.edit, type: "transfer" },
    ],
    [
      "provider_refused",
      "a patch Wallet refuses",
      (request: Call) =>
        request.method === "GET" ? { body: held } : { status: 400, body: '{"error":"no"}' },
      EDIT.edit,
    ],
  ])("answers refused %s for %s", async (reason, _case, answer, edit) => {
    const { deps } = fakeWallet(answer);
    expect((await call(deps, SOURCE_PATHS.edit, { ...EDIT, edit })).body).toEqual({
      state: "refused",
      reason,
    });
  });
});

describe("writing categories", () => {
  it("renames in batches of ten, creates one by one and removes in batches, saying what landed", async () => {
    const rename = Array.from({ length: 12 }, (_, index) => ({
      externalId: `wc-${index}`,
      name: `Name ${index}`,
    }));
    const { calls, deps } = fakeWallet((request) => {
      if (request.method === "POST") {
        return request.body?.includes("Unreadable")
          ? { body: "{}" }
          : { body: '{"category":{"id":"wc-new"}}' };
      }
      const size = request.method === "PATCH" ? JSON.parse(request.body ?? "[]").length : 2;
      const results = Array.from({ length: size }, (_, index) => ({
        inputIndex: index,
        success: index !== 1,
      }));
      return { status: 207, body: JSON.stringify({ results }) };
    });
    const answer = await call(deps, SOURCE_PATHS.writeCategories, {
      credentials: CREDENTIALS,
      rename,
      create: [
        { name: "Forno", parentExternalId: "wc-groceries" },
        { name: "Unreadable", parentExternalId: "wc-groceries" },
      ],
      remove: ["wc-a", "wc-b"],
    });
    const written = writeCategoriesResponseSchema.parse(answer.body);
    expect(calls.map((request) => request.method)).toEqual(["PATCH", "PATCH", "POST", "POST", "DELETE"]);
    expect(JSON.parse(calls[0].body ?? "")).toHaveLength(10);
    expect(calls[0].path).toBe("/categories");
    expect(calls[2]).toMatchObject({
      path: "/categories/custom",
      body: '{"name":"Forno","parentId":"wc-groceries"}',
    });
    expect(calls[4].body).toBe('{"ids":["wc-a","wc-b"]}');
    expect(written.renamed).toHaveLength(12);
    expect(written.renamed.filter((outcome) => !outcome.ok).map((outcome) => outcome.externalId)).toEqual([
      "wc-1",
      "wc-11",
    ]);
    expect(written.created).toEqual([{ externalId: "wc-new" }, { externalId: null }]);
    expect(written.removed).toEqual([
      { externalId: "wc-a", ok: true },
      { externalId: "wc-b", ok: false },
    ]);
  });
});

describe("amounts", () => {
  it("keep every JSON number as the text it was written with", () => {
    expect(parseJsonPreservingNumbers('{"a":2615.39,"b":[0.1,1e3],"c":"x"}')).toEqual({
      a: "2615.39",
      b: ["0.1", "1e3"],
      c: "x",
    });
  });

  it("become cents half-up, and take the documented route for a number or an exponent", () => {
    expect(walletAmountToCents("-8.615")).toBe(-862n);
    expect(walletAmountToCents("1e3")).toBe(100_000n);
    expect(walletAmountToCents(0.1 + 0.2)).toBe(30n);
    expect(() => walletAmountToCents("abc")).toThrow(WalletError);
  });
});
