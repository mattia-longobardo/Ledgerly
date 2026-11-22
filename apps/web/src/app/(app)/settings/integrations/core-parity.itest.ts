// R3 parity of the cards of the core (03-releases.md §R3, criterion 11; R5c anticipated): what each Server
// Action of `actions.ts` answered — its code — is what the generic route of a connection answers to the
// call that replaces it, by the provider's id, and both leave the same rows. Two people alike: the
// action works for one, the route for the other. No call leaves the process: `fetch` answers as a
// provider that refuses the credential.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

let signedIn: Ctx;
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/platform/auth/session", () => ({ requireSession: async () => signedIn }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const actions = await import("./actions");
const { answered } = await import("./connection-codes");
const { listConnections } = await import("@ledgerly/domain/platform/integrations");

const contextFor = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

let old: Ctx;
let now: Ctx;

beforeEach(async () => {
  await resetDatabase();
  old = contextFor((await createTestUser()).id);
  now = contextFor((await createTestUser()).id);
  signedIn = old;
  // A provider that refuses every credential: the cards' «rejected».
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })),
  );
});

afterEach(() => vi.unstubAllGlobals());
afterAll(closeDatabase);

/** One request to `/api/v1` as `now`: `ok` with the body, or the refusal's reason or code. */
async function viaRoute(method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", now);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text === "" ? null : JSON.parse(text);
  if (response.ok) return { ok: true, body: json };
  return { ok: false, status: response.status, error: json?.reason ?? json?.error };
}

/** What a connection is, without what makes it this person's. */
const shapeOf = async (ctx: Ctx) =>
  (await listConnections(ctx)).map((one) => ({
    provider: one.provider,
    state: one.state,
    errorCode: one.errorCode,
  }));

const idOf = async (ctx: Ctx, provider: string) =>
  (await listConnections(ctx)).find((one) => one.provider === provider)!.id;

describe("the card of the source, old action = new call", () => {
  it("connects, refuses the same credentials, and stores the same row", async () => {
    for (const token of ["   ", "bad\ntoken", "good-token"]) {
      const before = await actions.connectWalletAction(token);
      const after = await viaRoute("POST", "/connections", { provider: "wallet", credentials: { token } });
      expect(after.ok).toBe(before.ok);
      if (!before.ok)
        expect({ status: after.status, error: after.error }).toEqual({ status: 400, error: before.error });
    }
    expect(await shapeOf(now)).toEqual(await shapeOf(old));
  });

  it("tests, reads the history again and reads the accounts with the same answer", async () => {
    await actions.connectWalletAction("good-token");
    const { body } = await viaRoute("POST", "/connections", {
      provider: "wallet",
      credentials: { token: "good-token" },
    });
    expect(body).toEqual({ id: await idOf(now, "wallet"), restoredAccounts: 0 });

    // A run answers the closed list of the row (`CONNECTION_REFUSALS`), which the row read from the action.
    const tested = await actions.coreConnectionAction("wallet", "test");
    expect(tested).toEqual({ ok: false, error: "rejected" });
    expect(await viaRoute("POST", `/connections/${body.id}/test`)).toMatchObject({
      ok: false,
      error: answered(tested),
    });
    expect(await shapeOf(now)).toEqual(await shapeOf(old));

    const history = await actions.coreConnectionAction("wallet", "history", 7);
    expect(await viaRoute("POST", `/connections/${body.id}/history`, { months: 7 })).toMatchObject({
      ok: false,
      error: answered(history),
    });

    // «Choose the accounts» keeps the card's own code.
    const accounts = await actions.walletAccountsAction();
    expect(accounts).toEqual({ ok: false, error: "rejected" });
    expect(await viaRoute("GET", `/connections/${body.id}/accounts`)).toMatchObject({
      ok: false,
      error: "rejected",
    });
    const chosen = await actions.chooseWalletAccountsAction(["acc-1"]);
    const decisions = [
      { providerAccountId: "acc-1", target: { kind: "new", name: "Current", type: "checking" } },
    ];
    expect(await viaRoute("PUT", `/connections/${body.id}/accounts`, { decisions })).toMatchObject({
      ok: false,
      error: chosen.ok ? null : chosen.error,
    });
  });

  it("disconnects the same way, and is nobody else's", async () => {
    await actions.connectWalletAction("good-token");
    await viaRoute("POST", "/connections", { provider: "wallet", credentials: { token: "good-token" } });
    const id = await idOf(now, "wallet");
    signedIn = contextFor((await createTestUser()).id);
    expect(await actions.disconnectWalletAction()).toEqual({ ok: false, error: "notConnected" });
    signedIn = old;
    expect(await actions.disconnectWalletAction()).toEqual({ ok: true });
    expect(await viaRoute("DELETE", `/connections/${id}`)).toEqual({ ok: true, body: null });
    expect(await viaRoute("DELETE", `/connections/${id}`)).toMatchObject({ ok: false, status: 404 });
    expect(await shapeOf(now)).toEqual([]);
    expect(await shapeOf(old)).toEqual([]);
  });
});

describe("the card of the calendar, old action = new call", () => {
  it("connects, refuses the same credentials, tests and disconnects with the same answer", async () => {
    const inputs = [
      ["https://trek.example.test", " ", "secret"],
      ["http://trek.example.test", "client", "secret"],
      ["https://trek.example.test/", "client", "secret"],
    ] as const;
    for (const [baseUrl, clientId, clientSecret] of inputs) {
      const before = await actions.connectTrekAction(baseUrl, clientId, clientSecret);
      const after = await viaRoute("POST", "/connections", {
        provider: "trek",
        credentials: { baseUrl, clientId, clientSecret },
      });
      expect(after.ok).toBe(before.ok);
      if (!before.ok)
        expect({ status: after.status, error: after.error }).toEqual({ status: 400, error: before.error });
    }
    expect(await shapeOf(now)).toEqual(await shapeOf(old));

    const id = await idOf(now, "trek");
    const tested = await actions.coreConnectionAction("trek", "test");
    expect(tested).toEqual({ ok: false, error: "rejected" });
    expect(await viaRoute("POST", `/connections/${id}/test`)).toMatchObject({
      ok: false,
      error: answered(tested),
    });
    expect(await shapeOf(now)).toEqual(await shapeOf(old));

    expect(await actions.disconnectTrekAction()).toEqual({ ok: true });
    expect(await viaRoute("DELETE", `/connections/${id}`)).toEqual({ ok: true, body: null });
    expect(await shapeOf(now)).toEqual(await shapeOf(old));
  });
});
