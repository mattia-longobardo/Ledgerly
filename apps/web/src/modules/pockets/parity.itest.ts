// R3 parity of the pockets' writes (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case, the amount read in their number format on the server — is what
// the route does with the body the screen now sends (`calls.ts`: the same text, read on the client).
// Two pockets alike: the old path writes one, the new path the other. Linking and unlinking carry ids
// only, and `platform/api/pockets.itest.ts` holds them equal to the use case.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@ledgerly/format/cents";
import { addDays, monthKey, today } from "@ledgerly/format/dates";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const pockets = await import("@ledgerly/domain/pockets");

let ctx: Ctx;
let thisMonth: string;
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
  todayOn = today(ctx.timeZone);
  thisMonth = monthKey(todayOn);
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
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

/** What the server did with the typed text, and what the client now sends for it. */
const oldCents = (typed: string) => parseAmount(typed, ctx.numberFormat);
const newDecimal = (typed: string) => centsToDecimal(parseAmount(typed, ctx.numberFormat));

/** A pocket as both paths leave it, without its id and its name, which say which path wrote it. */
async function pocketOf(id: string) {
  const view = await pockets.pocketsView(ctx);
  const row = view.pockets.find((one) => one.pocket.id === id);
  if (!row) return view.archived.some((one) => one.id === id) ? "archived" : null;
  const { pocket, planned, expenses, ...figures } = row;
  return {
    ...figures,
    pocket: { ...pocket, id: undefined, name: undefined, createdAt: undefined, updatedAt: undefined },
    planned: planned.map((one) => ({ ...one, id: undefined })),
    expenses,
  };
}

describe("pockets, old Server Action = new call", () => {
  it("creates and edits a pocket from amounts typed in the person's format", async () => {
    const typed = { target: "1.234,5", monthly: "80" };
    const old = await pockets.createPocket(ctx, {
      name: "Old",
      color: null,
      backingAccountId: null,
      targetCents: oldCents(typed.target),
      monthlyCents: oldCents(typed.monthly),
      startMonth: thisMonth,
    });
    const created = await send("POST", "/pockets", {
      name: "New",
      color: null,
      accountId: null,
      target: newDecimal(typed.target),
      monthly: newDecimal(typed.monthly),
      startMonth: thisMonth,
    });
    expect(created.status).toBe(201);
    const now = created.body.id as string;
    expect(await pocketOf(now)).toEqual(await pocketOf(old.id));

    // An empty amount is none: the target goes, the pocket is filled by hand.
    await pockets.updatePocket(ctx, old.id, {
      name: "Old",
      color: null,
      backingAccountId: null,
      targetCents: null,
      monthlyCents: null,
      startMonth: thisMonth,
    });
    const body = {
      name: "New",
      color: null,
      accountId: null,
      target: null,
      monthly: null,
      startMonth: thisMonth,
    };
    expect((await send("PUT", `/pockets/${now}`, body)).status).toBe(204);
    expect(await pocketOf(now)).toEqual(await pocketOf(old.id));
  });

  it("adds to a pocket, plans and removes an expense, pauses and archives it", async () => {
    const input = (name: string) => ({
      name,
      color: null,
      backingAccountId: null,
      targetCents: 100_000n,
      monthlyCents: 5_000n,
      startMonth: thisMonth,
    });
    const old = (await pockets.createPocket(ctx, input("Old"))).id;
    const now = (await pockets.createPocket(ctx, input("New"))).id;

    for (const typed of ["50,25", "1.000"]) {
      await pockets.addToPocket(ctx, old, { cents: oldCents(typed), on: todayOn });
      const added = await send("POST", `/pockets/${now}/deposits`, {
        amount: newDecimal(typed),
        on: todayOn,
      });
      expect(added.status).toBe(204);
      expect(await pocketOf(now)).toEqual(await pocketOf(old));
    }

    const due = addDays(todayOn, 10);
    await pockets.addPlannedExpense(ctx, old, { cents: oldCents("120,5"), dueOn: due, description: "Hotel" });
    const planned = { amount: newDecimal("120,5"), dueOn: due, description: "Hotel" };
    expect((await send("POST", `/pockets/${now}/planned`, planned)).status).toBe(204);
    expect(await pocketOf(now)).toEqual(await pocketOf(old));

    const plannedOf = async (id: string) =>
      (await pockets.pocketsView(ctx)).pockets.find((one) => one.pocket.id === id)!.planned[0].id;
    await pockets.removePlannedExpense(ctx, await plannedOf(old));
    expect((await send("DELETE", `/pockets/planned/${await plannedOf(now)}`)).status).toBe(204);
    expect(await pocketOf(now)).toEqual(await pocketOf(old));

    for (const state of ["paused", "archived"] as const) {
      await pockets.setPocketState(ctx, old, state);
      expect((await send("PUT", `/pockets/${now}/state`, { state })).status).toBe(204);
      expect(await pocketOf(now)).toEqual(await pocketOf(old));
    }
    expect(await pocketOf(now)).toBe("archived");
  });
});
