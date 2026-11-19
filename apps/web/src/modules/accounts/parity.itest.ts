// R3 parity of the accounts' writes (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case of the domain, the amount read in their number format — is what
// the route does with the body the screen now sends (`calls.ts`: the same text, read on the client).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@ledgerly/format/cents";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const accounts = await import("@ledgerly/domain/accounts");

const ctxOf = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "it",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = ctxOf((await createTestUser()).id);
});

afterAll(closeDatabase);

async function send(method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.status;
}

/** Two accounts alike: the old path writes to one, the new path to the other. */
async function pair() {
  const make = (name: string) => accounts.createAccount(ctx, { name, type: "checking", currency: "EUR" });
  return { old: (await make("Old")).id, now: (await make("New")).id };
}

/** What a person typed, as the screen sends it now. */
const decimal = (typed: string) => centsToDecimal(parseAmount(typed, ctx.numberFormat));

const entriesOf = async (id: string) =>
  (await accounts.listBalanceEntries(ctx, id)).map(({ on, balanceCents, availableCents, note, source }) => ({
    on,
    balanceCents,
    availableCents,
    note,
    source,
  }));

describe("accounts, old Server Action = new call", () => {
  it("records, corrects and deletes a balance from the same typed text", async () => {
    const { old, now } = await pair();
    const typed = { on: "2026-10-31", amount: "1.234,56", available: "1.000", note: "Statement" };

    await accounts.saveBalanceEntry(ctx, old, {
      on: typed.on,
      cents: parseAmount(typed.amount, ctx.numberFormat),
      availableCents: parseAmount(typed.available, ctx.numberFormat),
      note: typed.note,
    });
    const body = {
      on: typed.on,
      balance: decimal(typed.amount),
      available: decimal(typed.available),
      note: typed.note,
    };
    expect(await send("POST", `/accounts/${now}/balances`, body)).toBe(201);
    expect(await entriesOf(now)).toEqual(await entriesOf(old));

    const [oldEntry] = await accounts.listBalanceEntries(ctx, old);
    const [newEntry] = await accounts.listBalanceEntries(ctx, now);
    await accounts.updateBalanceEntry(
      ctx,
      oldEntry.id,
      { on: typed.on, cents: -5n, availableCents: null, note: "" },
      old,
    );
    const correction = { on: typed.on, balance: decimal("-0,05"), available: null, note: "" };
    expect(await send("PUT", `/accounts/${now}/balances/${newEntry.id}`, correction)).toBe(200);
    expect(await entriesOf(now)).toEqual(await entriesOf(old));

    await accounts.deleteBalanceEntry(ctx, oldEntry.id, old);
    expect(await send("DELETE", `/accounts/${now}/balances/${newEntry.id}`)).toBe(204);
    expect(await entriesOf(now)).toEqual(await entriesOf(old));
  });

  it("adds, changes and removes what hangs off an account", async () => {
    const { old, now } = await pair();
    const linksOf = async (id: string) =>
      (await accounts.connectionsOf(ctx, id)).map(({ channel, name, note }) => ({ channel, name, note }));
    const typed = { channel: "iban" as const, name: " Electricity ", note: "" };

    await accounts.addConnection(ctx, old, typed);
    expect(await send("POST", `/accounts/${now}/links`, typed)).toBe(201);
    expect(await linksOf(now)).toEqual(await linksOf(old));

    const [oldLink] = await accounts.connectionsOf(ctx, old);
    const [newLink] = await accounts.connectionsOf(ctx, now);
    const changed = { channel: "card" as const, name: "Power", note: "Monthly" };
    await accounts.updateConnection(ctx, oldLink.id, changed);
    expect(await send("PUT", `/accounts/${now}/links/${newLink.id}`, changed)).toBe(200);
    expect(await linksOf(now)).toEqual(await linksOf(old));

    await accounts.removeConnection(ctx, oldLink.id);
    expect(await send("DELETE", `/accounts/${now}/links/${newLink.id}`)).toBe(204);
    expect(await linksOf(now)).toEqual(await linksOf(old));
  });

  it("archives and restores an account the same way", async () => {
    const { old, now } = await pair();
    const stateOf = async (id: string) => (await accounts.getAccount(ctx, id))?.state;

    await accounts.archiveAccount(ctx, old);
    expect(await send("POST", `/accounts/${now}/archive`)).toBe(204);
    expect(await stateOf(now)).toBe(await stateOf(old));

    await accounts.restoreAccount(ctx, old);
    expect(await send("POST", `/accounts/${now}/restore`)).toBe(204);
    expect(await stateOf(now)).toBe(await stateOf(old));
  });
});
