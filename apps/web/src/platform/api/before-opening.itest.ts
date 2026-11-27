// A movement dated before the opening balance of an account «a mano» (PERS-678): through every route
// that puts one there, it must either count in the balance, be refused, or be reported in the
// answer (`beforeOpening`). Today it is none of these: it is written, and the balance ignores it
// with no word, because the opening reading «holds» every movement of an earlier day
// (`movementBalances`, packages/domain/src/modules/accounts/rules/movements.ts).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { saveImportBalance } from "@domain/modules/accounts/service";
import { getDb } from "@domain/platform/db/client";
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

describe("the notice and «Move the opening» (PERS-678, A+)", () => {
  it("the account's page names the movements before the opening, and moving the opening counts them", async () => {
    const account = await newAccount();
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, BEFORE),
      key: crypto.randomUUID(),
    });
    expect(written.body.beforeOpening).toEqual({ count: 1, first: BEFORE });
    // The balance does not move by itself: the person decides.
    expect(await balanceOf(account)).toBe("100.00");

    const { beforeOpening } = (await send(ctx, "GET", `/accounts/${account}/context`)).body;
    expect(beforeOpening).toEqual({
      count: 1,
      first: BEFORE,
      openingOn: OPENING,
      moveTo: addDays(BEFORE, -1),
      opening: { id: expect.any(String), on: OPENING, balance: "100.00", available: null, note: null },
    });

    const moved = await send(ctx, "PUT", `/accounts/${account}/balances/${beforeOpening.opening.id}`, {
      on: beforeOpening.moveTo,
      balance: beforeOpening.opening.balance,
      available: beforeOpening.opening.available,
      note: beforeOpening.opening.note,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.beforeOpening).toBeNull();
    expect(await balanceOf(account)).toBe("87.50");
    expect((await send(ctx, "GET", `/accounts/${account}/context`)).body.beforeOpening).toBeNull();
    expect((await send(ctx, "GET", `/accounts/${account}`)).body.openedOn).toBe(addDays(BEFORE, -1));
  });

  it("a hidden movement restored before the opening is reported", async () => {
    const account = await newAccount();
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, BEFORE),
      key: crypto.randomUUID(),
    });
    const change = (to: string) =>
      send(ctx, "POST", "/transactions/visibility", {
        ids: [written.body.id],
        change: to,
        rebuildBalances: true,
      });
    expect((await change("hide")).body).toEqual({ count: 1, beforeOpening: null });
    expect((await change("restore")).body).toEqual({ count: 1, beforeOpening: { count: 1, first: BEFORE } });
  });

  it("the dialog's preview says the opening holds the day, not a reading that counted it", async () => {
    const account = await newAccount();
    const preview = (on: string) =>
      send(ctx, "POST", "/transactions/manual/preview", {
        kind: "expense",
        amount: "12.50",
        on,
        accountId: account,
      });
    expect((await preview(BEFORE)).body.preview).toEqual({
      kind: "unchanged",
      account: "Cash",
      readingOn: OPENING,
      opening: true,
    });
    expect((await preview(AFTER)).body.preview.kind).toBe("change");
  });

  it("says nothing on an account with movements and no balance at all", async () => {
    const created = await send(ctx, "POST", "/accounts", { name: "Wallet", type: "cash" });
    expect(created.status).toBe(201);
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(created.body.id, BEFORE),
      key: crypto.randomUUID(),
    });
    expect(written.body.beforeOpening).toBeNull();
    expect((await send(ctx, "GET", `/accounts/${created.body.id}/context`)).body.beforeOpening).toBeNull();
    expect(await balanceOf(created.body.id)).toBeNull();
  });
});

describe("the notes of the review of A+ (PERS-725)", () => {
  /** The clock one step on: a write after another is a later moment, as for a person. */
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

  async function openingOf(account: string) {
    const { balances } = (await send(ctx, "GET", `/accounts/${account}/balances`)).body;
    return balances.find(
      (one: { on: string; source: string }) => one.on === OPENING && one.source === "manual",
    );
  }

  async function sameDayMovement(): Promise<string> {
    const account = await newAccount();
    later(60_000);
    const written = await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, OPENING),
      key: crypto.randomUUID(),
    });
    expect(written.status).toBe(201);
    expect(await balanceOf(account)).toBe("87.50");
    later(3_600_000);
    return account;
  }

  it("a note written on the opening keeps the movement of its day in the balance", async () => {
    const account = await sameDayMovement();
    const opening = await openingOf(account);
    const edited = await send(ctx, "PUT", `/accounts/${account}/balances/${opening.id}`, {
      on: OPENING,
      balance: "100",
      available: null,
      note: "Counted at the counter",
    });
    expect(edited.status).toBe(200);
    expect(await balanceOf(account)).toBe("87.50");
  });

  it("a new amount of the opening, taken after a movement of its day, says the movement is left out", async () => {
    const account = await sameDayMovement();
    const opening = await openingOf(account);
    const edited = await send(ctx, "PUT", `/accounts/${account}/balances/${opening.id}`, {
      on: OPENING,
      balance: "90",
      available: null,
      note: null,
    });
    expect(edited.status).toBe(200);
    expectNotSilent(edited, await balanceOf(account));
    expect(edited.body.beforeOpening).toEqual({ count: 1, first: OPENING });
    const { beforeOpening } = (await send(ctx, "GET", `/accounts/${account}/context`)).body;
    expect(beforeOpening).toMatchObject({ count: 1, first: OPENING, moveTo: addDays(OPENING, -1) });
  });

  it("the banner names the day of the first reading when no person recorded it", async () => {
    const created = await send(ctx, "POST", "/accounts", { name: "Pension", type: "cash" });
    expect(created.status).toBe(201);
    const account = created.body.id as string;
    await getDb().transaction((trx) =>
      saveImportBalance(ctx, account, { on: OPENING, cents: 10_000n, note: null }, trx),
    );
    await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, BEFORE),
      key: crypto.randomUUID(),
    });
    const { beforeOpening } = (await send(ctx, "GET", `/accounts/${account}/context`)).body;
    expect(beforeOpening).toMatchObject({ count: 1, first: BEFORE, openingOn: OPENING, opening: null });
  });

  it("«Move the opening» refuses a day that has a balance a person wrote since, and deletes nothing", async () => {
    const account = await newAccount();
    await send(ctx, "POST", "/transactions/manual", {
      ...manualBody(account, BEFORE),
      key: crypto.randomUUID(),
    });
    const { beforeOpening } = (await send(ctx, "GET", `/accounts/${account}/context`)).body;
    // Another tab writes a balance on that day before the click.
    const other = await send(ctx, "POST", `/accounts/${account}/balances`, {
      on: beforeOpening.moveTo,
      balance: "50",
      available: null,
      note: null,
    });
    expect(other.status).toBe(201);

    const moved = await send(ctx, "PUT", `/accounts/${account}/balances/${beforeOpening.opening.id}`, {
      on: beforeOpening.moveTo,
      balance: beforeOpening.opening.balance,
      available: beforeOpening.opening.available,
      note: beforeOpening.opening.note,
      replace: false,
    });
    expect(moved).toMatchObject({ status: 409, body: { reason: "balance_exists" } });
    const { balances } = (await send(ctx, "GET", `/accounts/${account}/balances`)).body;
    expect(balances.map((one: { on: string; balance: string }) => [one.on, one.balance])).toEqual(
      expect.arrayContaining([
        [beforeOpening.moveTo, "50.00"],
        [OPENING, "100.00"],
      ]),
    );
  });
});
