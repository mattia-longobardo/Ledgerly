// R3 parity of the transactions' writes (03-releases.md §R3, criterion 11): what a Server Action did with
// what a person typed — the use case, the amount read in their number format on the server — is what the
// route does with the body the screen now sends (`manual-calls.ts`, `ui/commands.ts`: the same text, read
// on the client). Two accounts alike: the old path writes to one, the new path to the other.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@ledgerly/format/cents";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import type { TransactionRow } from "@ledgerly/domain/transactions";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const accounts = await import("@ledgerly/domain/accounts");
const transactions = await import("@ledgerly/domain/transactions");
const manualCases = await import("@/app/(app)/expenses/manual");

let ctx: Ctx;

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

/** What a person typed, as the screen sends it now: the size, read in their format on the client. */
const decimal = (typed: string) => centsToDecimal(parseAmount(typed, ctx.numberFormat));

async function pair() {
  const make = (name: string) =>
    accounts.createAccount(ctx, {
      name,
      type: "cash",
      currency: "EUR",
      openingBalanceCents: 10000n,
      openingOn: "2026-01-01",
    });
  return { old: (await make("Old")).id, now: (await make("New")).id };
}

/** A movement as both paths leave it, without what only says which path wrote it. */
const shapeOf = (row: TransactionRow) => ({
  on: row.on,
  amountCents: row.amountCents,
  type: row.type,
  payee: row.payee,
  note: row.note,
  categoryId: row.categoryId,
  labels: row.labels.map((label) => label.id),
  hidden: row.hidden,
  hiddenAt: row.hiddenAt === null,
  edited: row.locallyEdited,
  origin: row.origin,
});

async function rowsOf(accountId: string) {
  const rows = await transactions.listTransactions(ctx, {
    accountIds: [accountId],
    includeHidden: true,
    limit: 50,
  });
  return rows.map(shapeOf);
}

const balanceOf = async (accountId: string) =>
  (await send("GET", "/accounts")).body.accounts.find((one: { id: string }) => one.id === accountId).balance;

const typed = {
  kind: "expense" as const,
  amount: "1.234,5",
  on: "2026-02-10",
  categoryId: null,
  payee: " Corner shop ",
  note: "Milk",
};

describe("transactions, old Server Action = new call", () => {
  it("writes, changes and deletes a manual movement from the same typed text", async () => {
    const { old, now } = await pair();
    const amountCents = parseAmount(typed.amount, ctx.numberFormat);

    const before = await manualCases.createManual(
      ctx,
      { ...typed, accountId: old, amountCents },
      crypto.randomUUID(),
    );
    const created = await send("POST", "/transactions/manual", {
      ...typed,
      accountId: now,
      amount: decimal(typed.amount),
      key: crypto.randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(await rowsOf(now)).toEqual(await rowsOf(old));
    expect(await balanceOf(now)).toBe(await balanceOf(old));

    const change = { ...typed, kind: "income" as const, amount: "7,05", note: "" };
    await manualCases.updateManual(ctx, before.transaction.id, {
      ...change,
      accountId: old,
      amountCents: parseAmount(change.amount, ctx.numberFormat),
    });
    const updated = await send("PUT", `/transactions/manual/${created.body.id}`, {
      ...change,
      accountId: now,
      amount: decimal(change.amount),
    });
    expect(updated.status).toBe(200);
    expect(await rowsOf(now)).toEqual(await rowsOf(old));
    expect(await balanceOf(now)).toBe(await balanceOf(old));

    await manualCases.deleteManual(ctx, before.transaction.id);
    expect((await send("DELETE", `/transactions/manual/${created.body.id}`)).status).toBe(204);
    expect(await rowsOf(now)).toEqual(await rowsOf(old));
    expect(await balanceOf(now)).toBe(await balanceOf(old));
  });

  it("hides, restores and deletes for good, with the manual balances rebuilt", async () => {
    const { old, now } = await pair();
    const write = async (accountId: string) =>
      (
        await manualCases.createManual(
          ctx,
          { ...typed, accountId, amountCents: parseAmount(typed.amount, ctx.numberFormat) },
          crypto.randomUUID(),
        )
      ).transaction.id;
    const oldId = await write(old);
    const newId = await write(now);
    const visibility = (change: string, rebuildBalances: boolean) =>
      send("POST", "/transactions/visibility", { ids: [newId], change, rebuildBalances });

    for (const change of ["hide", "restore", "hide"] as const) {
      await manualCases.changeVisibility(ctx, [oldId], change);
      expect((await visibility(change, true)).body).toEqual({ count: 1 });
      expect(await rowsOf(now)).toEqual(await rowsOf(old));
      expect(await balanceOf(now)).toBe(await balanceOf(old));
    }
    await manualCases.changeVisibility(ctx, [oldId], "delete");
    expect((await visibility("delete", true)).body).toEqual({ count: 1 });
    expect(await rowsOf(now)).toEqual(await rowsOf(old));
    expect(await balanceOf(now)).toBe(await balanceOf(old));
  });

  it("keeps a note trimmed, an empty one as none, and the labels and the category as chosen", async () => {
    const { old, now } = await pair();
    const write = async (accountId: string) =>
      (await manualCases.createManual(ctx, { ...typed, accountId, amountCents: 100n }, crypto.randomUUID()))
        .transaction.id;
    const oldId = await write(old);
    const newId = await write(now);
    const [category] = await transactions
      .createDefaultGroups(ctx, ["groceries"], "it")
      .then(() => transactions.listCategories(ctx));
    const label = await transactions.createLabel(ctx, { name: "Home", color: null });

    for (const note of ["  milk  ", ""]) {
      const trimmed = note.trim();
      await transactions.updateTransaction(ctx, oldId, { note: trimmed === "" ? null : trimmed });
      expect((await send("PATCH", `/transactions/${newId}`, { note })).status).toBe(204);
      expect(await rowsOf(now)).toEqual(await rowsOf(old));
    }
    await transactions.updateTransaction(ctx, oldId, { labelIds: [label.id] });
    expect((await send("PATCH", `/transactions/${newId}`, { labelIds: [label.id] })).status).toBe(204);
    await transactions.setCategory(ctx, [oldId], category.id);
    expect(
      (await send("PUT", "/transactions/category", { ids: [newId], categoryId: category.id })).body,
    ).toEqual({
      count: 1,
    });
    expect(await rowsOf(now)).toEqual(await rowsOf(old));
  });
});
