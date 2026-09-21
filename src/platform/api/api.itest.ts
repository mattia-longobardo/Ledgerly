import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { createToken } from "@/platform/tokens/service";
import type { ExpiryChoice } from "@/platform/tokens/rules";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";

// `after()` needs a Next request scope. The reading of a document is not what these tests are
// about — the upload's ownership is — so it is a no-op here, deterministically.
vi.mock("next/server", () => ({ after: () => {} }));

const { api } = await import("./app");
const { resetRateLimits, MAX_PER_WINDOW } = await import("./rate-limit");

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

async function tokenFor(
  ctx: Ctx,
  scopes: string[] = ["read", "write", "imports"],
  expiresInDays: ExpiryChoice = null,
): Promise<string> {
  const { token } = await createToken(ctx, { name: "test", scopes, expiresInDays });
  return token;
}

async function call(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return api.fetch(new Request(`http://ledgerly.test/api/v1${path}`, { ...init, headers }));
}

async function anAccount(ctx: Ctx, name = "ING Conto Arancio"): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

function movement(overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  return {
    externalId: "w-1",
    counterpartExternalId: null,
    occurredAt: new Date(),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Esselunga",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  };
}

/** The smallest thing the sniffer accepts as a payslip: a PDF header is all it looks at. */
function aPdf(marker: string): File {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${marker}\n%%EOF\n`);
  return new File([bytes], `${marker}.pdf`, { type: "application/pdf" });
}

let alice: Ctx;
let bob: Ctx;
let aliceToken: string;
let bobToken: string;
let aliceAccount: string;

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  alice = await newContext();
  bob = await newContext();
  aliceToken = await tokenFor(alice);
  bobToken = await tokenFor(bob);
  aliceAccount = await anAccount(alice);
});

afterAll(closeDatabase);

describe("the gate", () => {
  it("refuses a call with no token, a malformed one and an unknown one", async () => {
    for (const token of [null, "not-a-token", "pat_abcdefgh.nope"]) {
      const response = await call("/summary", token);
      expect(response.status, String(token)).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("refuses a token that does not carry the scope, with 403 and not 401", async () => {
    const readOnly = await tokenFor(alice, ["read"]);
    const response = await call(`/accounts/${aliceAccount}/balances`, readOnly, {
      method: "POST",
      body: JSON.stringify({ on: "2026-09-21", balance: "100.00" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(403);
  });

  it("answers 404 for a path that does not exist", async () => {
    expect((await call("/nothing-here", aliceToken)).status).toBe(404);
  });

  it("stops a token that will not stop, and says how long to wait", async () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) await call("/summary", aliceToken);
    const response = await call("/summary", aliceToken);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another token has its own window: one runaway script does not lock everyone out.
    expect((await call("/summary", bobToken)).status).toBe(200);
  });
});

describe("GET /accounts", () => {
  it("lists the token owner's accounts, with money as a decimal string", async () => {
    await saveBalanceEntry(alice, aliceAccount, { on: "2026-09-20", cents: 1_234_56n });
    const body = await (await call("/accounts", aliceToken)).json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({ id: aliceAccount, name: "ING Conto Arancio" });
    expect(body.accounts[0].balance).toBe("1234.56");
  });

  it("shows B none of A's accounts", async () => {
    const body = await (await call("/accounts", bobToken)).json();
    expect(body.accounts).toEqual([]);
  });
});

describe("GET /accounts/:id/balances", () => {
  it("returns the account's own readings", async () => {
    await saveBalanceEntry(alice, aliceAccount, { on: "2026-09-20", cents: 1_000_00n });
    const body = await (await call(`/accounts/${aliceAccount}/balances`, aliceToken)).json();
    expect(body.balances).toHaveLength(1);
    expect(body.balances[0]).toMatchObject({ on: "2026-09-20", balance: "1000.00", source: "manual" });
  });

  it("is not found for B, who may not even learn that A's account exists", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, bobToken);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /accounts/:id/balances", () => {
  const reading = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on: "2026-09-20", balance: "742.10" }),
  };

  it("records a reading for the token's owner", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, aliceToken, reading);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ balance: "742.10", source: "manual" });
  });

  it("refuses to write into A's account with B's token, and writes nothing", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, bobToken, reading);
    expect(response.status).toBe(404);
    const body = await (await call(`/accounts/${aliceAccount}/balances`, aliceToken)).json();
    expect(body.balances).toEqual([]);
  });

  it("refuses a body that is not a reading", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, aliceToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: "not-a-date" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /transactions", () => {
  beforeEach(async () => {
    await upsertFromProvider(alice, aliceAccount, [movement()]);
  });

  it("lists the owner's movements with the totals of the page's own header", async () => {
    const body = await (await call("/transactions", aliceToken)).json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ payee: "Esselunga", amount: "-25.00" });
    expect(body.summary).toMatchObject({ count: 1, expense: "-25.00" });
  });

  it("shows B nothing of A's, even asking for A's account by id", async () => {
    const body = await (await call(`/transactions?account=${aliceAccount}`, bobToken)).json();
    expect(body.transactions).toEqual([]);
    expect(body.summary.count).toBe(0);
  });

  it("refuses a filter that is not one", async () => {
    expect((await call("/transactions?from=yesterday", aliceToken)).status).toBe(400);
  });
});

describe("GET /summary", () => {
  it("answers with the owner's own figures", async () => {
    await saveBalanceEntry(alice, aliceAccount, { on: "2026-09-20", cents: 5_000_00n });
    const body = await (await call("/summary", aliceToken)).json();
    expect(body.accounts).toBe(1);
    expect(body.netWorth).toBe("5000.00");
  });

  it("tells B about B, whatever A owns", async () => {
    await saveBalanceEntry(alice, aliceAccount, { on: "2026-09-20", cents: 5_000_00n });
    const body = await (await call("/summary", bobToken)).json();
    expect(body.accounts).toBe(0);
    expect(body.netWorth).toBeNull();
  });
});

describe("POST /imports", () => {
  function upload(marker: string): RequestInit {
    const form = new FormData();
    form.set("kind", "payslip");
    form.set("file", aPdf(marker));
    return { method: "POST", body: form };
  }

  it("files the document under the token's owner, never under anybody else", async () => {
    const response = await call("/imports", bobToken, upload("bobs-payslip"));
    expect(response.status).toBe(201);
    const { id } = await response.json();

    const { requireDocument } = await import("@/modules/imports/service");
    await expect(requireDocument(alice, id)).rejects.toMatchObject({ code: "not_found" });
    expect((await requireDocument(bob, id)).id).toBe(id);
  });

  it("recognises the same file sent twice as one document", async () => {
    await call("/imports", aliceToken, upload("twice"));
    const second = await call("/imports", aliceToken, upload("twice"));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
  });

  it("refuses a file that is not a document of a kind it knows", async () => {
    const form = new FormData();
    form.set("kind", "payslip");
    form.set("file", new File([new TextEncoder().encode("hello")], "note.txt"));
    const response = await call("/imports", aliceToken, { method: "POST", body: form });
    expect(response.status).toBe(415);
  });

  it("refuses a token without the imports scope", async () => {
    const readOnly = await tokenFor(alice, ["read"]);
    expect((await call("/imports", readOnly, upload("refused"))).status).toBe(403);
  });
});

describe("a revoked token", () => {
  it("stops working on every route at once", async () => {
    const { revokeToken, listTokens } = await import("@/platform/tokens/service");
    const [token] = await listTokens(alice);
    await revokeToken(alice, token.id);
    for (const path of ["/accounts", "/transactions", "/summary"]) {
      expect((await call(path, aliceToken)).status, path).toBe(401);
    }
  });
});
