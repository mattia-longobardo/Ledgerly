// A movement dated before the opening balance of an account «a mano» (PERS-678): through every route
// that puts one there, it must either count in the balance, be refused, or be reported in the
// answer (`beforeOpening`). Today it is none of these: it is written, and the balance ignores it
// with no word, because the opening reading «holds» every movement of an earlier day
// (`movementBalances`, packages/domain/src/modules/accounts/rules/movements.ts).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { addDays, today } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

const as = (ctx: Ctx) =>
  apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });

async function answer(response: Response) {
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const init = { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return answer(await as(ctx).request(path, body === undefined ? { method } : init));
}

async function upload(ctx: Ctx, path: string, fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return answer(await as(ctx).request(path, { method: "POST", body: form }));
}

vi.useFakeTimers({ toFake: ["Date"], now: new Date() });

const TODAY = today("Europe/Rome");
/** The day of the opening balance; the movements under test fall two days before it. */
const OPENING = addDays(TODAY, -10);
const BEFORE = addDays(OPENING, -2);
const AFTER = addDays(OPENING, 2);

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
});

afterAll(async () => {
  vi.useRealTimers();
  await closeDatabase();
});

async function newAccount(): Promise<string> {
  const created = await send(ctx, "POST", "/accounts", {
    name: "Cash",
    type: "cash",
    openingBalance: { on: OPENING, amount: "100" },
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

const balanceOf = async (accountId: string) =>
  (await send(ctx, "GET", "/accounts")).body.accounts.find((one: { id: string }) => one.id === accountId)
    .balance as string;

const manualBody = (accountId: string, on: string) => ({
  kind: "expense",
  amount: "12.50",
  on,
  accountId,
  categoryId: null,
  payee: "Corner shop",
  note: "",
});

/**
 * The movement of 12.50 out is not lost in silence: the answer refuses it, or reports it, or the
 * balance counts it. Whichever correction Mattia chooses (A, B or C) passes here; today none does.
 */
function expectNotSilent(outcome: { status: number; body: unknown }, balance: string) {
  const reported =
    outcome.status >= 400 ||
    (typeof outcome.body === "object" &&
      outcome.body !== null &&
      "beforeOpening" in outcome.body &&
      Boolean((outcome.body as { beforeOpening: unknown }).beforeOpening));
  expect({ reported, balance }).not.toEqual({ reported: false, balance: "100.00" });
}

const toDdMmYyyy = (day: string) => day.split("-").reverse().join("/");

describe("a movement dated before the opening balance (PERS-678)", () => {
  it("from a CSV file is not lost in silence", async () => {
    const account = await newAccount();
    const file = ["Data;Descrizione;Importo", `${toDdMmYyyy(BEFORE)};Corner shop;-12,50`].join("\r\n");
    const imported = await upload(ctx, `/accounts/${account}/csv/import`, {
      file: new File([file], "movements.csv", { type: "text/csv" }),
      map: JSON.stringify({
        columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: null, category: null },
        delimiter: ";",
        decimalSeparator: ",",
        dateFormat: "DD/MM/YYYY",
        skipRows: 0,
        header: true,
      }),
    });
    expectNotSilent(imported, await balanceOf(account));
  });

  it("written by hand is not lost in silence", async () => {
    const account = await newAccount();
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, BEFORE),
      key: crypto.randomUUID(),
    });
    expectNotSilent(written, await balanceOf(account));
  });

  it("moved there by a change of its date is not lost in silence", async () => {
    const account = await newAccount();
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, AFTER),
      key: crypto.randomUUID(),
    });
    expect(written.status).toBe(201);
    expect(await balanceOf(account)).toBe("87.50");
    const moved = await send(
      ctx,
      "PUT",
      `/transactions/manual/${written.body.id}`,
      manualBody(account, BEFORE),
    );
    expectNotSilent(moved, await balanceOf(account));
  });

  it("left there by moving the opening balance later is not lost in silence", async () => {
    const account = await newAccount();
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, AFTER),
      key: crypto.randomUUID(),
    });
    expect(written.status).toBe(201);
    const { balances } = (await send(ctx, "GET", `/accounts/${account}/balances`)).body;
    const opening = balances.find((one: { on: string }) => one.on === OPENING);
    const moved = await send(ctx, "PUT", `/accounts/${account}/balances/${opening.id}`, {
      on: addDays(AFTER, 1),
      balance: "100",
      available: null,
      note: null,
    });
    expect(moved.status).toBe(200);
    expectNotSilent(moved, await balanceOf(account));
  });
});
