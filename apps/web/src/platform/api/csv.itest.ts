// The import of a CSV file (decision ST-8) through its routes: an account «a mano» only, each row a
// manual movement with the balance it would have written by hand, the same file twice written once,
// the map saved per account, and another person's account not there. The guard is the test's.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { listTransactions } = await import("@ledgerly/domain/transactions");
const { linkProviderAccounts } = await import("@ledgerly/domain/accounts");

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

const fileOf = (text: string) => new File([text], "movements.csv", { type: "text/csv" });

const MAP = {
  columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: null, category: null },
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "DD/MM/YYYY",
  skipRows: 0,
  header: true,
};

const FILE = [
  "Data;Descrizione;Importo",
  "10/02/2026;Corner shop;-12,50",
  "10/02/2026;Corner shop;-12,50",
  "11/02/2026;Salary;1.200,00",
  "31/02/2026;Bad day;-1,00",
].join("\r\n");

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

async function newAccount(ctx: Ctx, name: string) {
  const created = await send(ctx, "POST", "/accounts", {
    name,
    type: "cash",
    openingBalance: { on: "2026-01-01", amount: "100" },
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

const balanceOf = async (ctx: Ctx, accountId: string) =>
  (await send(ctx, "GET", "/accounts")).body.accounts.find((one: { id: string }) => one.id === accountId)
    .balance as string;

const importFile = (ctx: Ctx, accountId: string, text = FILE, extra: Record<string, string> = {}) =>
  upload(ctx, `/accounts/${accountId}/csv/import`, {
    file: fileOf(text),
    map: JSON.stringify(MAP),
    ...extra,
  });

describe("the import of a CSV file", () => {
  it("writes each row as a manual movement, with the balance of the same movements written by hand", async () => {
    const imported = await newAccount(alice, "Imported");
    const byHand = await newAccount(alice, "By hand");
    const done = await importFile(alice, imported);
    expect(done).toEqual({
      status: 200,
      body: { created: 3, duplicates: 0, refused: [{ row: 5, reason: "bad_date" }] },
    });
    for (const [kind, amount, on, payee] of [
      ["expense", "12.50", "2026-02-10", "Corner shop"],
      ["expense", "12.50", "2026-02-10", "Corner shop"],
      ["income", "1200", "2026-02-11", "Salary"],
    ]) {
      const written = await send(alice, "POST", "/transactions/manual", {
        kind,
        amount,
        on,
        accountId: byHand,
        categoryId: null,
        payee,
        note: "",
        key: crypto.randomUUID(),
      });
      expect(written.status).toBe(201);
    }
    expect(await balanceOf(alice, imported)).toBe("1275.00");
    expect(await balanceOf(alice, imported)).toBe(await balanceOf(alice, byHand));
    const rows = await listTransactions(alice, { accountIds: [imported] });
    expect(rows.map((row) => [row.origin, row.amountCents, row.payee])).toEqual(
      expect.arrayContaining([
        ["manual", -1250n, "Corner shop"],
        ["manual", -1250n, "Corner shop"],
        ["manual", 120000n, "Salary"],
      ]),
    );
  });

  it("writes nothing the second time the same file comes", async () => {
    const account = await newAccount(alice, "Cash");
    await importFile(alice, account);
    const balance = await balanceOf(alice, account);
    const again = await importFile(alice, account);
    expect(again.body).toEqual({ created: 0, duplicates: 3, refused: [{ row: 5, reason: "bad_date" }] });
    expect(await balanceOf(alice, account)).toBe(balance);
    // A file with one row more writes only that row.
    const longer = await importFile(alice, account, `${FILE}\r\n12/02/2026;Bar;-2,00`);
    expect(longer.body).toMatchObject({ created: 1, duplicates: 3 });
  });

  it("refuses an account with a source, an archived one, and another person's", async () => {
    const synced = await newAccount(alice, "Synced");
    await linkProviderAccounts(alice, "plugin:bank", [
      { providerAccountId: "bank-1", currency: "EUR", target: { kind: "existing", accountId: synced } },
    ]);
    for (const path of [`/accounts/${synced}/csv/import`, `/accounts/${synced}/csv/preview`]) {
      const refused = await upload(alice, path, { file: fileOf(FILE), map: JSON.stringify(MAP) });
      expect(refused).toEqual({ status: 409, body: { error: "conflict", reason: "account_not_manual" } });
    }
    expect((await send(alice, "PUT", `/accounts/${synced}/csv-map`, MAP)).body.reason).toBe(
      "account_not_manual",
    );
    const archived = await newAccount(alice, "Old");
    expect((await send(alice, "POST", `/accounts/${archived}/archive`)).status).toBeLessThan(300);
    expect((await importFile(alice, archived)).body).toEqual({
      error: "conflict",
      reason: "account_unavailable",
    });
    const mine = await newAccount(alice, "Mine");
    expect((await importFile(bob, mine)).status).toBe(404);
    expect((await upload(bob, `/accounts/${mine}/csv/preview`, { file: fileOf(FILE) })).status).toBe(404);
    expect((await send(bob, "GET", `/accounts/${mine}/csv-map`)).status).toBe(404);
    expect((await send(bob, "PUT", `/accounts/${mine}/csv-map`, MAP)).status).toBe(404);
    expect(await listTransactions(alice, {})).toEqual([]);
  });

  it("refuses a bad map, an empty file and a file too large", async () => {
    const account = await newAccount(alice, "Cash");
    const badMap = { ...MAP, columns: { ...MAP.columns, debit: 3 } };
    const bad = await upload(alice, `/accounts/${account}/csv/import`, {
      file: fileOf(FILE),
      map: JSON.stringify(badMap),
    });
    expect(bad.status).toBe(400);
    expect(
      (await upload(alice, `/accounts/${account}/csv/import`, { file: fileOf(FILE), map: "{" })).status,
    ).toBe(400);
    expect((await importFile(alice, account, "\r\n\r\n")).body).toEqual({
      error: "invalid",
      reason: "empty",
    });
    const large = `Data;Descrizione;Importo\r\n${"01/02/2026;x;-1\r\n".repeat(350_000)}`;
    expect((await importFile(alice, account, large)).status).toBe(413);
    const many = `Data;Descrizione;Importo\r\n${"01/02/2026;x;-1\r\n".repeat(20_001)}`;
    expect((await importFile(alice, account, many)).body).toEqual({
      error: "too_large",
      reason: "too_many_rows",
    });
  });
});

describe("the map of the columns", () => {
  it("is saved and read back per account, and kept by an import that asks", async () => {
    const account = await newAccount(alice, "Cash");
    const other = await newAccount(alice, "Other");
    expect((await send(alice, "GET", `/accounts/${account}/csv-map`)).body).toEqual({ map: null });
    const tab = { ...MAP, delimiter: "\t", dateFormat: "YYYY-MM-DD", skipRows: 2 };
    expect((await send(alice, "PUT", `/accounts/${account}/csv-map`, tab)).body).toEqual({ map: tab });
    expect((await send(alice, "GET", `/accounts/${account}/csv-map`)).body).toEqual({ map: tab });
    expect((await send(alice, "PUT", `/accounts/${account}/csv-map`, MAP)).body).toEqual({ map: MAP });
    expect((await send(alice, "GET", `/accounts/${account}/csv-map`)).body).toEqual({ map: MAP });
    expect((await send(alice, "GET", `/accounts/${other}/csv-map`)).body).toEqual({ map: null });
    await importFile(alice, other, FILE, { saveMap: "true" });
    expect((await send(alice, "GET", `/accounts/${other}/csv-map`)).body).toEqual({ map: MAP });
  });

  it("is proposed by the preview, which reads the first rows and writes nothing", async () => {
    const account = await newAccount(alice, "Cash");
    const preview = await upload(alice, `/accounts/${account}/csv/preview`, { file: fileOf(`﻿${FILE}`) });
    expect(preview).toEqual({
      status: 200,
      body: {
        delimiter: ";",
        columns: ["Data", "Descrizione", "Importo"],
        rowCount: 4,
        savedMap: null,
        proposedMap: MAP,
        rows: [
          { row: 2, outcome: "ok", reason: null, on: "2026-02-10", amount: "-12.50", payee: "Corner shop" },
          { row: 3, outcome: "ok", reason: null, on: "2026-02-10", amount: "-12.50", payee: "Corner shop" },
          { row: 4, outcome: "ok", reason: null, on: "2026-02-11", amount: "1200.00", payee: "Salary" },
          { row: 5, outcome: "refused", reason: "bad_date", on: null, amount: null, payee: null },
        ],
      },
    });
    expect(await listTransactions(alice, {})).toEqual([]);
    // With a saved map the preview reads the rows with it.
    await send(alice, "PUT", `/accounts/${account}/csv-map`, {
      ...MAP,
      columns: { ...MAP.columns, payee: null },
    });
    const saved = await upload(alice, `/accounts/${account}/csv/preview`, { file: fileOf(FILE) });
    expect(saved.body.savedMap.columns.payee).toBeNull();
    expect(saved.body.rows[0].payee).toBeNull();
  });

  it("follows in the preview the columns the person chose, before the saved map", async () => {
    const account = await newAccount(alice, "Cash");
    await send(alice, "PUT", `/accounts/${account}/csv-map`, MAP);
    const chosen = { ...MAP, columns: { ...MAP.columns, payee: null, note: 1 } };
    const preview = await upload(alice, `/accounts/${account}/csv/preview`, {
      file: fileOf(FILE),
      map: JSON.stringify(chosen),
    });
    expect(preview.status).toBe(200);
    expect(preview.body.savedMap).toEqual(MAP);
    expect(preview.body.rows[0]).toEqual({
      row: 2,
      outcome: "ok",
      reason: null,
      on: "2026-02-10",
      amount: "-12.50",
      payee: null,
    });
    const bad = await upload(alice, `/accounts/${account}/csv/preview`, { file: fileOf(FILE), map: "{" });
    expect(bad.status).toBe(400);
    expect(await listTransactions(alice, {})).toEqual([]);
  });
});
