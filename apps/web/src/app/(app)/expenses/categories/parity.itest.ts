// R3 parity of the board of the categories (03-releases.md §R3, criterion 11): what the Server Actions
// of `settings/finance/actions.ts` did — the use cases, with `""` for «no group» — is what the routes
// do with the bodies the board now sends (`modules/transactions/taxonomy-calls.ts`). Two people alike:
// the old path changes the categories of one, the new path those of the other.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const api = await import("@ledgerly/api");
const transactions = await import("@ledgerly/domain/transactions");

let old: Ctx;
let now: Ctx;

const person = async (): Promise<Ctx> => ({
  userId: (await createTestUser()).id,
  role: "user",
  locale: "it",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

beforeEach(async () => {
  await resetDatabase();
  old = await person();
  now = await person();
});

afterAll(closeDatabase);

async function send(method: string, path: string, body?: unknown) {
  const routes = api.apiRoutes({
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
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

/** A person's categories as both paths leave them, by name: no id says which path wrote them. */
async function treeOf(ctx: Ctx) {
  const rows = await transactions.listCategoriesWithUsage(ctx, { includeArchived: true });
  const nameOf = new Map(rows.map(({ category }) => [category.id, category.name]));
  return rows
    .map(({ category, usage }) => ({
      name: category.name,
      group: category.parentId === null ? null : nameOf.get(category.parentId),
      type: category.type,
      color: category.color,
      archived: category.archivedAt !== null,
      usage,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The id of a category of a person, by name. */
async function idOf(ctx: Ctx, name: string) {
  const rows = await transactions.listCategoriesWithUsage(ctx, { includeArchived: true });
  const row = rows.find(({ category }) => category.name === name);
  if (!row) throw new Error(`no category ${name}`);
  return row.category.id;
}

const form = (name: string, parentId: string, type = "expense", color: string | null = null) => ({
  name,
  parentId,
  type,
  color,
});

async function both(oldWrite: () => Promise<unknown>, path: string, body: unknown, method = "POST") {
  await oldWrite();
  const answer = await send(method, path, body);
  expect(answer.status).toBeLessThan(300);
  expect(await treeOf(now)).toEqual(await treeOf(old));
  return answer.body;
}

describe("the board of the categories, old Server Action = new call", () => {
  it("creates, renames, recolours, moves, archives and restores", async () => {
    await both(
      () => transactions.createCategory(old, form("Home", "", "expense", "#3366cc")),
      "/categories",
      {
        ...form("Home", "", "expense", "#3366cc"),
        parentId: null,
      },
    );
    await both(() => transactions.createCategory(old, form("Car", "")), "/categories", {
      ...form("Car", ""),
      parentId: null,
    });
    const rent = async (ctx: Ctx) => form("Rent", await idOf(ctx, "Home"));
    await both(async () => transactions.createCategory(old, await rent(old)), "/categories", await rent(now));

    const renamed = async (ctx: Ctx) => ({ ...(await rent(ctx)), name: "Rent and bills" });
    await both(
      async () => transactions.updateCategory(old, await idOf(old, "Rent"), await renamed(old)),
      `/categories/${await idOf(now, "Rent")}`,
      await renamed(now),
      "PATCH",
    );
    await both(
      async () =>
        transactions.updateCategory(old, await idOf(old, "Home"), form("Home", "", "expense", "#cc3366")),
      `/categories/${await idOf(now, "Home")}`,
      { ...form("Home", "", "expense", "#cc3366"), parentId: null },
      "PATCH",
    );
    const moved = await both(
      async () => transactions.moveCategory(old, await idOf(old, "Rent and bills"), await idOf(old, "Car")),
      `/categories/${await idOf(now, "Rent and bills")}/move`,
      { parentId: await idOf(now, "Car") },
    );
    expect(moved).toEqual({ fromId: await idOf(now, "Home") });

    const archived = await both(
      async () => transactions.archiveCategory(old, await idOf(old, "Car")),
      `/categories/${await idOf(now, "Car")}/archive`,
      undefined,
    );
    expect(archived.ids).toHaveLength(2);
    await both(
      async () =>
        transactions.restoreCategories(old, [await idOf(old, "Car"), await idOf(old, "Rent and bills")]),
      "/categories/restore",
      { ids: archived.ids },
    );
    await both(
      async () => transactions.archiveCategory(old, await idOf(old, "Home")),
      `/categories/${await idOf(now, "Home")}/archive`,
      undefined,
    );
    await both(
      async () => transactions.restoreCategory(old, await idOf(old, "Home")),
      "/categories/restore",
      {
        ids: [await idOf(now, "Home")],
      },
    );
  });

  it("merges and undoes, moves to another macro and back, deletes", async () => {
    for (const ctx of [old, now]) {
      const home = await transactions.createCategory(ctx, form("Home", ""));
      await transactions.createCategory(ctx, form("Rent", home.id));
      await transactions.createCategory(ctx, form("Bills", home.id));
    }
    const keepAndDrop = async (ctx: Ctx) => ({
      keepId: await idOf(ctx, "Rent"),
      dropId: await idOf(ctx, "Bills"),
    });
    let oldUndo: unknown = null;
    const merged = await both(
      async () => ({ undo: oldUndo } = await api.mergeTwoCategories(old, await keepAndDrop(old))),
      "/categories/merge",
      await keepAndDrop(now),
    );
    await both(() => api.undoMergeOfTwo(old, oldUndo), "/categories/merge/undo", { undo: merged.undo });

    const place = { type: "transfer", parentId: null };
    let macroUndo: unknown = null;
    const movedToMacro = await both(
      async () => (macroUndo = await api.moveToMacro(old, await idOf(old, "Home"), place)),
      `/categories/${await idOf(now, "Home")}/macro-move`,
      place,
    );
    await both(() => api.undoMoveToMacro(old, macroUndo), "/categories/macro-move/undo", {
      undo: movedToMacro.undo,
    });

    await both(
      async () => api.deleteCategoryEverywhere(old, await idOf(old, "Bills")),
      `/categories/${await idOf(now, "Bills")}`,
      undefined,
      "DELETE",
    );
  });
});
