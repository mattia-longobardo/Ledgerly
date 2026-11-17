import { createVerify, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authCompleteResponseSchema,
  authStartResponseSchema,
  institutionsResponseSchema,
  PLUGIN_PATHS,
  SECRET_HEADER,
  syncResponseSchema,
  verifyResponseSchema,
} from "../../../src/platform/plugins/contract/calls";
import { errorBodySchema } from "../../../src/platform/plugins/contract/errors";
import { checkPlugin } from "../../../src/platform/plugins/contract/kit";
import { manifestSchema } from "../../../src/platform/plugins/contract/manifest";
import { PluginFailure } from "./failure";
import {
  accountNameOf,
  authComplete,
  authRevoke,
  authStart,
  institutions,
  stableIdOf,
  sync,
  toTransaction,
  verify,
} from "./handlers";
import { parsePrivateKey, signToken } from "./jwt";
import { MANIFEST } from "./manifest";
import { errorName, failureCode, type Fetch } from "./provider";

process.env.PLUGIN_NO_LISTEN = "1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CREDENTIALS = { applicationId: "app-1", privateKey: PEM };

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A provider made of canned answers, by `METHOD path` (the query is part of the path). */
function fakeProvider(
  answers: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>,
) {
  const calls: Call[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
      ),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const answer = answers[`${call.method} ${call.path}`];
    if (!answer)
      return new Response(JSON.stringify({ error: "NOT_MOCKED", message: "secret words of the provider" }), {
        status: 404,
      });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  };
  return { calls, fetchFn };
}

const ASPSPS = {
  aspsps: [
    {
      name: "Zeta Bank",
      country: "IT",
      maximum_consent_validity: 15_552_000,
      psu_types: ["personal", "business"],
    },
    { name: "Alfa Bank", country: "IT", maximum_consent_validity: 7_776_000, psu_types: ["personal"] },
    { name: "Corporate Only", country: "IT", maximum_consent_validity: 7_776_000, psu_types: ["business"] },
  ],
};
const ASPSPS_PATH = "GET /aspsps?country=IT&psu_type=personal&service=AIS";

describe("the token", () => {
  it("is an RS256 JWT of the application, valid for five minutes", () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const [header, payload, signature] = signToken("app-1", parsePrivateKey(PEM)!, now).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "RS256",
      kid: "app-1",
    });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 300,
    });
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(verified).toBe(true);
  });

  it("refuses a text that is not an RSA private key", () => {
    expect(parsePrivateKey("not a key")).toBeNull();
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    expect(parsePrivateKey(ec.export({ type: "pkcs8", format: "pem" }).toString())).toBeNull();
  });
});

describe("the manifest", () => {
  it("is a manifest of contract v1, read-only", () => {
    expect(manifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
    expect(MANIFEST.capabilities).not.toContain("provider.write");
    expect(MANIFEST.userSettings.every((field) => field.writeOnly)).toBe(true);
  });
});

describe("verify", () => {
  const application = (body: object) => fakeProvider({ "GET /application": { body } });

  it("says read-only for an application of account information only", async () => {
    const { fetchFn, calls } = application({ active: true, services: ["AIS"] });
    expect(verifyResponseSchema.parse(await verify({ credentials: CREDENTIALS }, { fetchFn }))).toEqual({
      access: "read-only",
    });
    expect(calls[0].headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("says write for an application that can also pay", async () => {
    const { fetchFn } = application({ active: true, services: ["AIS", "PIS"] });
    expect(await verify({ credentials: CREDENTIALS }, { fetchFn })).toEqual({ access: "write" });
  });

  it("says unverifiable when the provider does not list the services", async () => {
    const { fetchFn } = application({ active: true });
    expect(await verify({ credentials: CREDENTIALS }, { fetchFn })).toEqual({ access: "unverifiable" });
  });

  it("refuses an application that is not active, and a refused key", async () => {
    await expect(verify({ credentials: CREDENTIALS }, application({ active: false }))).rejects.toMatchObject({
      code: "auth",
    });
    const refused = fakeProvider({
      "GET /application": { status: 401, body: { error: "UNAUTHORIZED_ACCESS" } },
    });
    await expect(verify({ credentials: CREDENTIALS }, refused)).rejects.toMatchObject({ code: "auth" });
  });

  it("names a key that is not a key, without calling the provider", async () => {
    const { fetchFn, calls } = application({ active: true });
    await expect(
      verify({ credentials: { applicationId: "app-1", privateKey: "hello" } }, { fetchFn }),
    ).rejects.toMatchObject({ code: "key_format" });
    expect(calls).toEqual([]);
  });

  it("refuses a body that is not the contract's", async () => {
    await expect(verify({ credentials: { applicationId: "app-1" } })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(verify({})).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("institutions", () => {
  it("lists the banks of a country for a person, by name, with the days an access lasts", async () => {
    const { fetchFn } = fakeProvider({ [ASPSPS_PATH]: { body: ASPSPS } });
    const answer = institutionsResponseSchema.parse(
      await institutions({ credentials: CREDENTIALS, country: "IT" }, { fetchFn }),
    );
    expect(answer.institutions).toEqual([
      { name: "Alfa Bank", country: "IT", maxAccessDays: 90 },
      { name: "Zeta Bank", country: "IT", maxAccessDays: 180 },
    ]);
  });
});

describe("auth", () => {
  const now = () => new Date("2026-11-15T10:00:00Z");

  it("starts an access for the longest time the bank allows, with the core's state", async () => {
    const { fetchFn, calls } = fakeProvider({
      [ASPSPS_PATH]: { body: ASPSPS },
      "POST /auth": {
        body: { url: "https://bank.example/login?x=1", authorization_id: "a", psu_id_hash: "h" },
      },
    });
    const answer = await authStart(
      {
        credentials: CREDENTIALS,
        institution: { name: "Zeta Bank", country: "IT" },
        state: "state-state-state-1",
        redirectUrl: "https://ledgerly.example/api/v1/plugins/enablebanking/callback",
      },
      { fetchFn, now },
    );
    expect(authStartResponseSchema.parse(answer)).toEqual({ url: "https://bank.example/login?x=1" });
    expect(calls[1].body).toEqual({
      access: { valid_until: "2027-05-14T09:59:00.000Z", balances: true, transactions: true },
      aspsp: { name: "Zeta Bank", country: "IT" },
      state: "state-state-state-1",
      redirect_url: "https://ledgerly.example/api/v1/plugins/enablebanking/callback",
      psu_type: "personal",
    });
  });

  it("refuses a bank the provider does not list", async () => {
    const { fetchFn } = fakeProvider({ [ASPSPS_PATH]: { body: ASPSPS } });
    await expect(
      authStart(
        {
          credentials: CREDENTIALS,
          institution: { name: "No Such Bank", country: "IT" },
          state: "state-state-state-1",
          redirectUrl: "https://ledgerly.example/callback",
        },
        { fetchFn, now },
      ),
    ).rejects.toMatchObject({ code: "institution_unavailable" });
  });

  it("completes an access: the session, its end and the accounts that can be read", async () => {
    const { fetchFn, calls } = fakeProvider({
      "POST /sessions": {
        body: {
          session_id: "s-1",
          aspsp: { name: "Zeta Bank", country: "IT" },
          access: { valid_until: "2027-05-14T09:59:00+02:00" },
          accounts: [
            {
              uid: "u-1",
              account_id: { iban: "IT60X0542811101000000123456" },
              name: "Anna Bianchi",
              product: "Conto",
              currency: "EUR",
              cash_account_type: "CACC",
              identification_hash: "hash-1",
            },
            { uid: null, currency: "EUR", cash_account_type: "SVGS", identification_hash: "hash-2" },
          ],
        },
      },
    });
    const answer = authCompleteResponseSchema.parse(
      await authComplete({ credentials: CREDENTIALS, code: "c-1" }, { fetchFn }),
    );
    expect(calls[0].body).toEqual({ code: "c-1" });
    expect(answer).toEqual({
      session: { id: "s-1", expiresAt: "2027-05-14T07:59:00.000Z" },
      institution: { name: "Zeta Bank", country: "IT" },
      accounts: [
        {
          externalId: "u-1",
          stableId: "hash-1",
          name: "Conto",
          identifier: "IT60X0542811101000000123456",
          currency: "EUR",
          kind: "CACC",
        },
      ],
    });
  });

  it("gives an account whose fields the bank left empty, or filled too long, in the contract's shape", async () => {
    const long = "h".repeat(300);
    const { fetchFn } = fakeProvider({
      "POST /sessions": {
        body: {
          session_id: "s-1",
          aspsp: { name: "Zeta Bank", country: "IT" },
          access: {},
          accounts: [
            {
              uid: "u-1",
              account_id: { iban: "" },
              name: "Anna Bianchi",
              product: "  ",
              currency: "EUR",
              cash_account_type: "",
              identification_hash: "",
            },
            { uid: "u-2", product: "n".repeat(300), currency: "EUR", identification_hash: long },
            { uid: "u-3", currency: "EUR", identification_hash: `${long}x` },
          ],
        },
      },
    });
    const answer = authCompleteResponseSchema.parse(
      await authComplete({ credentials: CREDENTIALS, code: "c-1" }, { fetchFn }),
    );
    expect(answer.accounts[0]).toEqual({
      externalId: "u-1",
      stableId: null,
      name: null,
      identifier: null,
      currency: "EUR",
      kind: null,
    });
    expect(answer.accounts[1].name).toHaveLength(200);
    expect(answer.accounts[1].stableId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(answer.accounts[2].stableId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(answer.accounts[2].stableId).not.toBe(answer.accounts[1].stableId);
    expect(stableIdOf(long)).toBe(answer.accounts[1].stableId);
    expect(stableIdOf("short-hash")).toBe("short-hash");
  });

  it("names a pocket by its `details` when the bank gives no product, as Revolut does", async () => {
    const pocket = (uid: string, details: string | null) => ({
      uid,
      account_id: { other: { identification: `id-${uid}`, scheme_name: "BBAN" } },
      name: "Anna Bianchi",
      product: null,
      details,
      usage: "PRIV",
      currency: "EUR",
      cash_account_type: "SVGS",
      identification_hash: `hash-${uid}`,
    });
    const { fetchFn } = fakeProvider({
      "POST /sessions": {
        body: {
          session_id: "s-1",
          aspsp: { name: "Zeta Bank", country: "IT" },
          access: {},
          accounts: [
            {
              ...pocket("u-1", null),
              account_id: { iban: "IT60X0542811101000000123456" },
              cash_account_type: "CACC",
            },
            pocket("u-2", "Holidays"),
            pocket("u-3", " Subscriptions "),
            pocket("u-4", "d".repeat(61)),
            pocket("u-5", "Conto con carta\ndi debito"),
            { ...pocket("u-6", "Holidays"), product: "Conto Deposito" },
          ],
        },
      },
    });
    const answer = authCompleteResponseSchema.parse(
      await authComplete({ credentials: CREDENTIALS, code: "c-1" }, { fetchFn }),
    );
    expect(answer.accounts.map((account) => account.name)).toEqual([
      null,
      "Holidays",
      "Subscriptions",
      null,
      null,
      "Conto Deposito",
    ]);
    expect(accountNameOf({ details: "d".repeat(60) })).toHaveLength(60);
  });

  it("closes an access, and counts one that has already ended as closed", async () => {
    const open = fakeProvider({ "DELETE /sessions/s-1": { body: { message: "OK" } } });
    expect(await authRevoke({ credentials: CREDENTIALS, session: { id: "s-1" } }, open)).toEqual({
      revoked: true,
    });
    const ended = fakeProvider({
      "DELETE /sessions/s-1": { status: 422, body: { error: "CLOSED_SESSION" } },
    });
    expect(await authRevoke({ credentials: CREDENTIALS, session: { id: "s-1" } }, ended)).toEqual({
      revoked: true,
    });
  });
});

const ROW = {
  entry_reference: "ref-1",
  transaction_amount: { currency: "EUR", amount: "12.30" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-01-10",
  value_date: "2026-01-11",
  remittance_information: ["PAGAMENTO POS", "NEGOZIO 123"],
  creditor: { name: "Negozio" },
  debtor: { name: "Me" },
  merchant_category_code: "5411",
  bank_transaction_code: { code: "PMNT", sub_code: "POSD", description: "Card" },
};

describe("a movement", () => {
  it("takes the contract's shape", () => {
    expect(toTransaction("u-1", ROW)).toEqual({
      accountExternalId: "u-1",
      externalId: "ref-1",
      status: "booked",
      bookingDate: "2026-01-10",
      valueDate: "2026-01-11",
      amount: "12.30",
      direction: "debit",
      currency: "EUR",
      text: ["PAGAMENTO POS", "NEGOZIO 123"],
      counterparty: "Negozio",
      merchantCategoryCode: "5411",
      bankTransactionCode: "PMNT · POSD · Card",
    });
  });

  it("takes empty texts of the bank as absent, so the answer stays in the contract", () => {
    const bare = toTransaction("u-1", {
      ...ROW,
      entry_reference: "",
      creditor: { name: " " },
      merchant_category_code: "",
      bank_transaction_code: { code: "", sub_code: null, description: "" },
    });
    expect(bare).toMatchObject({
      externalId: null,
      counterparty: null,
      merchantCategoryCode: null,
      bankTransactionCode: null,
    });
    expect(syncResponseSchema.shape.transactions.element.safeParse(bare).success).toBe(true);
  });

  it("names the debtor of a credit, keeps a pending one, drops the other states", () => {
    const credit = toTransaction("u-1", {
      ...ROW,
      credit_debit_indicator: "CRDT",
      status: "PDNG",
      entry_reference: null,
    });
    expect(credit).toMatchObject({
      direction: "credit",
      counterparty: "Me",
      status: "pending",
      externalId: null,
    });
    expect(toTransaction("u-1", { ...ROW, status: "RJCT" })).toBeNull();
  });
});

describe("sync", () => {
  const balances = {
    balances: [
      {
        balance_amount: { currency: "EUR", amount: "100.00" },
        balance_type: "CLBD",
        reference_date: "2026-01-12",
      },
    ],
  };

  it("reads balances and every page of movements, with the widest period when no first day is given", async () => {
    const { fetchFn, calls } = fakeProvider({
      "GET /accounts/u-1/balances": { body: balances },
      "GET /accounts/u-1/transactions?strategy=longest": {
        body: { transactions: [ROW], continuation_key: "k2" },
      },
      "GET /accounts/u-1/transactions?continuation_key=k2&strategy=longest": {
        body: { transactions: [{ ...ROW, entry_reference: "ref-2", booking_date: "2025-03-01" }] },
      },
    });
    const answer = syncResponseSchema.parse(
      await sync(
        {
          credentials: CREDENTIALS,
          session: { id: "s-1" },
          accounts: ["u-1"],
          from: null,
          cursor: null,
          userPresent: null,
        },
        { fetchFn },
      ),
    );
    expect(answer.accounts).toEqual([
      {
        externalId: "u-1",
        balances: [{ type: "CLBD", amount: "100.00", currency: "EUR", date: "2026-01-12" }],
        error: null,
      },
    ]);
    expect(answer.transactions.map((one) => one.externalId)).toEqual(["ref-1", "ref-2"]);
    expect(answer.cursor).toBeNull();
    expect(answer.coverage).toEqual({ from: "2025-03-01", to: "2026-01-10" });
    expect(calls.some((call) => "psu-ip-address" in call.headers)).toBe(false);
  });

  it("reads from a first day, and says who asked when the person is present", async () => {
    const { fetchFn, calls } = fakeProvider({
      "GET /accounts/u-1/balances": { body: balances },
      "GET /accounts/u-1/transactions?date_from=2026-01-01": { body: { transactions: [] } },
    });
    await sync(
      {
        credentials: CREDENTIALS,
        session: { id: "s-1" },
        accounts: ["u-1"],
        from: "2026-01-01",
        cursor: null,
        userPresent: { ip: "203.0.113.7", userAgent: "Browser/1" },
      },
      { fetchFn },
    );
    expect(calls.map((call) => call.headers["psu-ip-address"])).toEqual(["203.0.113.7", "203.0.113.7"]);
    expect(calls[0].headers["psu-user-agent"]).toBe("Browser/1");
  });

  it("carries on from a cursor without reading the balances again", async () => {
    const { fetchFn, calls } = fakeProvider({
      "GET /accounts/u-2/transactions?continuation_key=k9&strategy=longest": {
        body: { transactions: [ROW] },
      },
    });
    const answer = await sync(
      {
        credentials: CREDENTIALS,
        session: { id: "s-1" },
        accounts: ["u-1", "u-2"],
        from: null,
        cursor: JSON.stringify({ account: "u-2", key: "k9" }),
        userPresent: null,
      },
      { fetchFn },
    );
    expect(calls).toHaveLength(1);
    expect(answer.accounts).toEqual([]);
    expect(answer.transactions).toHaveLength(1);
  });

  it("keeps the other accounts when one fails, and names why", async () => {
    const { fetchFn } = fakeProvider({
      "GET /accounts/u-1/balances": {
        status: 429,
        body: { error: "ASPSP_RATE_LIMIT_EXCEEDED", message: "raw words" },
      },
      "GET /accounts/u-2/balances": { body: balances },
      "GET /accounts/u-2/transactions?strategy=longest": { body: { transactions: [ROW] } },
    });
    const answer = await sync(
      {
        credentials: CREDENTIALS,
        session: { id: "s-1" },
        accounts: ["u-1", "u-2"],
        from: null,
        cursor: null,
        userPresent: null,
      },
      { fetchFn },
    );
    expect(answer.accounts.map((one) => [one.externalId, one.error])).toEqual([
      ["u-1", "rate_limited"],
      ["u-2", null],
    ]);
    expect(JSON.stringify(answer)).not.toContain("raw words");
  });

  it("passes on the wait the provider asks for", async () => {
    const { fetchFn } = fakeProvider({
      "GET /application": {
        status: 429,
        body: { error: "ASPSP_RATE_LIMIT_EXCEEDED" },
        headers: { "retry-after": "120" },
      },
    });
    await expect(verify({ credentials: CREDENTIALS }, { fetchFn })).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 120,
    });
  });

  it("stops the whole call when the key is refused", async () => {
    const { fetchFn } = fakeProvider({
      "GET /accounts/u-1/balances": { status: 401, body: { error: "UNAUTHORIZED_ACCESS" } },
    });
    await expect(
      sync(
        {
          credentials: CREDENTIALS,
          session: { id: "s-1" },
          accounts: ["u-1"],
          from: null,
          cursor: null,
          userPresent: null,
        },
        { fetchFn },
      ),
    ).rejects.toBeInstanceOf(PluginFailure);
  });

  it("refuses a cursor it did not write", async () => {
    await expect(
      sync({
        credentials: CREDENTIALS,
        session: { id: "s-1" },
        accounts: ["u-1"],
        from: null,
        cursor: "nope",
        userPresent: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("the plugin's log", () => {
  it("names the call, the status and the provider's error name, and never its message or an id", async () => {
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => void lines.push(line);
    try {
      const { fetchFn } = fakeProvider({
        "GET /accounts/u-secret-id/balances": {
          status: 400,
          body: { error: "ASPSP_ERROR", message: "raw words about IT60X0542811101000000123456" },
        },
        "GET /application": { body: { active: "yes" } },
      });
      await sync(
        {
          credentials: CREDENTIALS,
          session: { id: "s-1" },
          accounts: ["u-secret-id"],
          from: null,
          cursor: null,
          userPresent: null,
        },
        { fetchFn },
      );
      await expect(verify({ credentials: CREDENTIALS }, { fetchFn })).rejects.toMatchObject({
        code: "invalid_data",
      });
    } finally {
      console.warn = warn;
    }
    expect(lines).toEqual([
      "[plugin] GET /accounts: provider answered 400 ASPSP_ERROR → provider_down",
      "[plugin] GET /application: answer not readable at active",
    ]);
    expect(errorName("Something a person typed")).toBe("-");
    expect(errorName(null)).toBe("-");
  });
});

describe("the provider's failures", () => {
  it("become codes of the contract, by name first and by status then", () => {
    expect(failureCode(422, "EXPIRED_SESSION")).toBe("consent_expired");
    expect(failureCode(400, "ASPSP_RATE_LIMIT_EXCEEDED")).toBe("rate_limited");
    expect(failureCode(400, "ASPSP_ERROR")).toBe("provider_down");
    expect(failureCode(401, null)).toBe("auth");
    expect(failureCode(429, null)).toBe("rate_limited");
    expect(failureCode(503, "SOMETHING_NEW")).toBe("provider_down");
    expect(failureCode(400, "WRONG_REQUEST_PARAMETERS")).toBe("failed");
  });
});

describe("the server", () => {
  const SECRET = "shared-secret-shared-secret-shared-1";
  let origin = "";
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { createHandler } = await import("./server");
    const { fetchFn } = fakeProvider({
      "GET /application": { status: 500, body: { message: "the provider's own words" } },
    });
    const server = createServer(createHandler(SECRET, { fetchFn }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(() => close());

  const post = (path: string, body: unknown, secret: string | null = SECRET) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret === null ? {} : { [SECRET_HEADER]: secret }),
      },
      body: JSON.stringify(body),
    });

  it("keeps the contract: the kit finds nothing wrong", async () => {
    expect(await checkPlugin({ origin, secret: SECRET, id: "enablebanking" })).toEqual([]);
  });

  it("is told apart by the kit from a plugin that does not keep it", async () => {
    const failures = await checkPlugin({ origin, secret: SECRET, id: "another-plugin" });
    expect(failures).toEqual(["the manifest must carry the plugin's own id"]);
  });

  it("answers the health check without the secret, and nothing else", async () => {
    expect(await (await fetch(`${origin}${PLUGIN_PATHS.health}`)).json()).toEqual({ status: "ok" });
    const manifest = await fetch(`${origin}${PLUGIN_PATHS.manifest}`);
    expect(manifest.status).toBe(401);
    expect(errorBodySchema.parse(await manifest.json())).toEqual({ error: { code: "unauthorized" } });
    expect(
      (await post(PLUGIN_PATHS.verify, { credentials: CREDENTIALS }, "wrong-secret-wrong-secret-wrong-1234"))
        .status,
    ).toBe(401);
  });

  it("gives the manifest to the core", async () => {
    const response = await fetch(`${origin}${PLUGIN_PATHS.manifest}`, {
      headers: { [SECRET_HEADER]: SECRET },
    });
    expect(manifestSchema.parse(await response.json()).id).toBe("enablebanking");
  });

  it("answers a failure with a code and never with the provider's words", async () => {
    const response = await post(PLUGIN_PATHS.verify, { credentials: CREDENTIALS });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(errorBodySchema.parse(JSON.parse(text))).toEqual({ error: { code: "provider_down" } });
    expect(text).not.toContain("own words");
  });

  it("refuses a path that is not in the contract, and a body that is not JSON", async () => {
    expect((await post("/nope", {})).status).toBe(400);
    const response = await fetch(`${origin}${PLUGIN_PATHS.verify}`, {
      method: "POST",
      headers: { [SECRET_HEADER]: SECRET },
      body: "{not json",
    });
    expect(errorBodySchema.parse(await response.json())).toEqual({ error: { code: "invalid_request" } });
  });
});
