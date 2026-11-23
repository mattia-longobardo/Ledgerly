// The categories of a source that gives its own, against a real Postgres (rewrite plan N3.1,
// 12-account-modes.md §12.3; criterion 4 of the release): add, match, mixed, "Undo" — and no
// movement of the source is ever given another category of the source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts } from "../accounts/queries";
import { applyProviderAccounts } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { getDb, getPool } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import {
  categorisableAccountIds,
  recordSourceCategories,
  upsertFromProvider,
  updateTransaction,
} from "./service";
import type { IncomingTransaction } from "./rules";
import {
  chooseSourceCategory,
  keepSourceCategory,
  listSourceCategories,
  sourceCategoryFor,
  sourceNamesByCategory,
  undoSourceCategory,
} from "./source-categories";
import { createCategory, deleteCategory, listCategories } from "./taxonomy";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

/** A provider of the core that gives a category with each movement. */
const SOURCE = "plugin:wallet";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

let ctx: Ctx;
let accountId: string;
let serial = 0;

function incoming(
  category: { id: string; name: string } | null,
  overrides: Partial<IncomingTransaction> = {},
) {
  serial += 1;
  return {
    externalId: `ext-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 9, 1 + (serial % 20), 10)),
    amountCents: -1_000n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: `Shop ${serial}`,
    note: null,
    categoryExternalId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  } satisfies IncomingTransaction;
}

const TOBACCO = { id: "sc-tobacco", name: "Tobacco" };
const ALCOHOL = { id: "sc-alcohol", name: "Alcohol, tobacco" };
const GROCERIES = { id: "sc-groceries", name: "Groceries" };

async function read(movements: IncomingTransaction[]) {
  return upsertFromProvider(ctx, accountId, movements, { provider: SOURCE });
}

/** Every movement as stored: the category it counts under and the source's own category. */
async function stored() {
  const { rows } = await getPool().query<{
    id: string;
    category_id: string | null;
    source_category_id: string | null;
    category_origin: string | null;
    updated: string;
  }>(
    "select t.id, t.category_id, t.source_category_id, t.category_origin, l.external_id as updated from transactions t join provider_links l on l.entity_id = t.id and l.entity_type = 'transaction' where t.user_id = $1 order by l.external_id",
    [ctx.userId],
  );
  return rows;
}

async function categoryNamed(name: string) {
  const found = (await listCategories(ctx, { includeArchived: true })).find((one) => one.name === name);
  if (!found) throw new Error(`no category ${name}`);
  return found;
}

async function sourceNamed(name: string) {
  const found = (await listSourceCategories(ctx)).find((one) => one.name === name);
  if (!found) throw new Error(`no source category ${name}`);
  return found;
}

const choose = (id: string, categoryId: string | null) =>
  getDb().transaction((tx) => chooseSourceCategory(ctx, { id, categoryId }, tx));
const undo = (undoId: string) => getDb().transaction((tx) => undoSourceCategory(ctx, undoId, tx));

beforeEach(async () => {
  await resetDatabase();
  serial = 0;
  ctx = contextFor((await createTestUser()).id);
  await applyProviderAccounts(ctx, SOURCE, [
    { provider: SOURCE, providerAccountId: "acc-1", name: "Current", type: "checking", currency: "EUR" },
  ]);
  accountId = (await listAccounts(ctx))[0].id;
});
afterAll(closeDatabase);

describe("what a reading writes", () => {
  it("adds each category of the source with its name, marks it new, and files the movement under it", async () => {
    await read([incoming(GROCERIES), incoming(GROCERIES), incoming(TOBACCO)]);

    const groceries = await categoryNamed("Groceries");
    expect(await listSourceCategories(ctx)).toMatchObject([
      { name: "Groceries", choice: "added", categoryId: groceries.id, isNew: true, count: 2 },
      { name: "Tobacco", choice: "added", isNew: true, count: 1 },
    ]);
    const rows = await stored();
    expect(rows.every((row) => row.source_category_id !== null && row.category_origin === "provider")).toBe(
      true,
    );
  });

  it("takes a category of the source's whole list before any movement uses it, and follows its name", async () => {
    await read([incoming(GROCERIES)]);
    const before = await sourceNamed("Groceries");
    await recordSourceCategories(ctx, SOURCE, [
      { externalId: GROCERIES.id, name: "Food shopping", groupName: "Home" },
      { externalId: "sc-unknown", name: "Never linked", groupName: null },
    ]);
    expect(await listSourceCategories(ctx)).toMatchObject([
      { id: before.id, name: "Food shopping", groupName: "Home", count: 1 },
    ]);
  });

  it("stops marking a category new when the person keeps it as it is", async () => {
    await read([incoming(GROCERIES)]);
    const row = await sourceNamed("Groceries");
    await keepSourceCategory(ctx, row.id);
    expect(await sourceNamed("Groceries")).toMatchObject({ isNew: false, choice: "added" });
  });

  it("never lets the automatic categories read the movements of such a source", async () => {
    await read([incoming(GROCERIES), incoming(null)]);
    expect(await categorisableAccountIds(ctx)).not.toContain(accountId);
  });
});

describe("matching a source's category to a category of the person (criterion 4)", () => {
  it("counts its movements under the chosen category, and changes the source's category of none", async () => {
    await read([incoming(TOBACCO), incoming(TOBACCO), incoming(ALCOHOL), incoming(GROCERIES)]);
    const before = await stored();
    const alcohol = await categoryNamed("Alcohol, tobacco");
    const tobacco = await sourceNamed("Tobacco");

    const change = await choose(tobacco.id, alcohol.id);
    expect(change).toMatchObject({
      name: "Tobacco",
      categoryName: "Alcohol, tobacco",
      choice: "matched",
      moved: 2,
    });

    const after = await stored();
    // Not one movement has another category of the source than before.
    expect(after.map((row) => row.source_category_id)).toEqual(before.map((row) => row.source_category_id));
    expect(after.map((row) => row.category_origin)).toEqual(before.map((row) => row.category_origin));
    // The two of "Tobacco" count under the chosen category; the others are where they were.
    expect(after.slice(0, 2).map((row) => row.category_id)).toEqual([alcohol.id, alcohol.id]);
    expect(after.slice(2).map((row) => row.category_id)).toEqual(
      before.slice(2).map((row) => row.category_id),
    );
    expect(await sourceNamed("Tobacco")).toMatchObject({
      choice: "matched",
      categoryId: alcohol.id,
      isNew: false,
    });
    // The category that was added for it has nothing left: it is put away, not deleted.
    expect((await categoryNamed("Tobacco")).archivedAt).not.toBeNull();
  });

  it("keeps the match at the next reading: an old movement stays, a new one counts there too", async () => {
    const first = incoming(TOBACCO);
    await read([first, incoming(ALCOHOL)]);
    const alcohol = await categoryNamed("Alcohol, tobacco");
    await choose((await sourceNamed("Tobacco")).id, alcohol.id);

    const outcome = await read([first, incoming(TOBACCO)]);
    expect(outcome).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    const rows = await stored();
    expect(rows.every((row) => row.category_id === alcohol.id)).toBe(true);
    // The category of the source is still the source's on each of them.
    const tobacco = await sourceNamed("Tobacco");
    expect(rows.filter((row) => row.source_category_id === tobacco.id)).toHaveLength(2);
    // And the one put away is not brought back by a reading.
    expect((await categoryNamed("Tobacco")).archivedAt).not.toBeNull();
  });

  it("leaves a movement the person filed by hand where they put it", async () => {
    await read([incoming(TOBACCO), incoming(TOBACCO), incoming(ALCOHOL), incoming(GROCERIES)]);
    const [mine] = await stored();
    const groceries = await categoryNamed("Groceries");
    await updateTransaction(ctx, mine.id, { categoryId: groceries.id });

    const change = await choose(
      (await sourceNamed("Tobacco")).id,
      (await categoryNamed("Alcohol, tobacco")).id,
    );
    expect(change.moved).toBe(1);
    expect((await stored())[0]).toMatchObject({ category_id: groceries.id, category_origin: "user" });
  });

  it("keeps the added category in use while a movement filed by hand is still under it", async () => {
    await read([incoming(TOBACCO), incoming(GROCERIES)]);
    const tobaccoCategory = await categoryNamed("Tobacco");
    const [, groceryMovement] = await stored();
    await updateTransaction(ctx, groceryMovement.id, { categoryId: tobaccoCategory.id });

    await choose((await sourceNamed("Tobacco")).id, (await categoryNamed("Groceries")).id);
    expect((await categoryNamed("Tobacco")).archivedAt).toBeNull();
  });

  it("moves the movements from one matched category to another", async () => {
    await read([incoming(TOBACCO), incoming(ALCOHOL), incoming(GROCERIES)]);
    const tobacco = await sourceNamed("Tobacco");
    const alcohol = await categoryNamed("Alcohol, tobacco");
    const groceries = await categoryNamed("Groceries");
    await choose(tobacco.id, alcohol.id);

    const change = await choose(tobacco.id, groceries.id);
    expect(change).toMatchObject({ choice: "matched", categoryName: "Groceries", moved: 1 });
    expect((await stored())[0].category_id).toBe(groceries.id);
  });

  it("refuses a category of another kind, one put away, and another person's", async () => {
    await read([incoming(TOBACCO), incoming(GROCERIES)]);
    const tobacco = await sourceNamed("Tobacco");
    const income = await createCategory(ctx, { name: "Refunds", type: "income" });
    await expect(choose(tobacco.id, income.id)).rejects.toMatchObject({ code: "invalid" });

    const other = contextFor((await createTestUser()).id);
    const theirs = await createCategory(other, { name: "Theirs", type: "expense" });
    await expect(choose(tobacco.id, theirs.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      getDb().transaction((tx) => chooseSourceCategory(other, { id: tobacco.id, categoryId: theirs.id }, tx)),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await sourceNamed("Tobacco")).toMatchObject({ choice: "added" });
  });
});

describe("mixed choices", () => {
  it("lets several categories of the source count under one, beside ones that stay added", async () => {
    await read([incoming(TOBACCO), incoming(ALCOHOL), incoming(ALCOHOL), incoming(GROCERIES)]);
    const vices = await createCategory(ctx, { name: "Vices", type: "expense" });
    await choose((await sourceNamed("Tobacco")).id, vices.id);
    await choose((await sourceNamed("Alcohol, tobacco")).id, vices.id);

    expect(await listSourceCategories(ctx)).toMatchObject([
      { name: "Alcohol, tobacco", choice: "matched", categoryId: vices.id },
      { name: "Groceries", choice: "added" },
      { name: "Tobacco", choice: "matched", categoryId: vices.id },
    ]);
    expect((await sourceNamesByCategory(ctx)).get(vices.id)).toEqual({
      provider: SOURCE,
      names: ["Alcohol, tobacco", "Tobacco"],
    });
    // A category whose one source category has its own name says nothing more.
    expect((await sourceNamesByCategory(ctx)).has((await categoryNamed("Groceries")).id)).toBe(false);
    // A movement written under "Vices" goes to the source with the most used of the two.
    expect(await sourceCategoryFor(ctx, SOURCE, vices.id)).toMatchObject({ externalId: ALCOHOL.id });
    expect(await sourceCategoryFor(ctx, SOURCE, (await categoryNamed("Groceries")).id)).toMatchObject({
      externalId: GROCERIES.id,
    });
    expect(await sourceCategoryFor(ctx, SOURCE, null)).toBeNull();
  });

  it("adds a matched category back as its own, with its name and its movements", async () => {
    await read([incoming(TOBACCO), incoming(ALCOHOL)]);
    const tobacco = await sourceNamed("Tobacco");
    await choose(tobacco.id, (await categoryNamed("Alcohol, tobacco")).id);

    const change = await choose(tobacco.id, null);
    expect(change).toMatchObject({ choice: "added", categoryName: "Tobacco", moved: 1 });
    const own = await categoryNamed("Tobacco");
    expect(own.archivedAt).toBeNull();
    expect((await stored())[0].category_id).toBe(own.id);
  });
});

describe("undo", () => {
  it("puts back the match, the movements and the category that was put away", async () => {
    await read([incoming(TOBACCO), incoming(TOBACCO), incoming(ALCOHOL)]);
    const before = await stored();
    const tobacco = await sourceNamed("Tobacco");
    const change = await choose(tobacco.id, (await categoryNamed("Alcohol, tobacco")).id);

    expect(await undo(change.undoId as string)).toEqual({ moved: 2 });
    expect(await stored()).toEqual(before);
    expect(await sourceNamed("Tobacco")).toMatchObject({ choice: "added" });
    expect((await categoryNamed("Tobacco")).archivedAt).toBeNull();
    // Once: the same undo asked again does nothing.
    expect(await undo(change.undoId as string)).toBeNull();
  });

  it("puts a category that was added back under the one it was matched to", async () => {
    await read([incoming(TOBACCO), incoming(ALCOHOL)]);
    const tobacco = await sourceNamed("Tobacco");
    const alcohol = await categoryNamed("Alcohol, tobacco");
    await choose(tobacco.id, alcohol.id);
    const back = await choose(tobacco.id, null);

    await undo(back.undoId as string);
    expect(await sourceNamed("Tobacco")).toMatchObject({ choice: "matched", categoryId: alcohol.id });
    expect((await stored())[0].category_id).toBe(alcohol.id);
    expect((await categoryNamed("Tobacco")).archivedAt).not.toBeNull();
  });

  it("is one person's: nobody undoes another's change", async () => {
    await read([incoming(TOBACCO), incoming(ALCOHOL)]);
    const change = await choose(
      (await sourceNamed("Tobacco")).id,
      (await categoryNamed("Alcohol, tobacco")).id,
    );
    const other = contextFor((await createTestUser()).id);
    expect(
      await getDb().transaction((tx) => undoSourceCategory(other, change.undoId as string, tx)),
    ).toBeNull();
    expect(await sourceNamed("Tobacco")).toMatchObject({ choice: "matched" });
  });
});

describe("a category the person deletes", () => {
  it("falls back to the source's own category at the next reading, which comes back", async () => {
    const first = incoming(TOBACCO);
    await read([first, incoming(GROCERIES)]);
    const vices = await createCategory(ctx, { name: "Vices", type: "expense" });
    await choose((await sourceNamed("Tobacco")).id, vices.id);
    await deleteCategory(ctx, vices.id, { provider: WALLET_PROVIDER });

    await read([first]);
    const own = await categoryNamed("Tobacco");
    expect(own.archivedAt).toBeNull();
    expect(await sourceNamed("Tobacco")).toMatchObject({ choice: "added", categoryId: own.id });
    expect((await stored())[0].category_id).toBe(own.id);
  });
});

describe("the data of the release (06-data.md §6.1)", () => {
  /** The two data statements of the migration, as the file has them. */
  function dataStatements(): string[] {
    const text = readFileSync(join(process.cwd(), "drizzle/0055_manual_send.sql"), "utf8");
    return text
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) =>
        /^(--.*\n)*\s*(INSERT INTO "source_categories"|UPDATE "transactions")/.test(statement),
      );
  }

  it("writes one added row for each category the source gives today, and changes the category of no movement", async () => {
    await read([incoming(TOBACCO), incoming(TOBACCO), incoming(GROCERIES), incoming(null)]);
    const [mine] = await stored();
    await updateTransaction(ctx, mine.id, { categoryId: (await categoryNamed("Groceries")).id });
    const before = await stored();
    const names = (await listSourceCategories(ctx)).map((row) => row.name);

    // The state the image before this release leaves: the links, and none of the new data.
    await getPool().query("update transactions set source_category_id = null");
    await getPool().query("delete from source_categories");
    const statements = dataStatements();
    expect(statements).toHaveLength(2);
    for (const statement of statements) await getPool().query(statement);

    const rows = await listSourceCategories(ctx);
    expect(rows.map((row) => row.name)).toEqual(names);
    expect(rows.every((row) => row.choice === "added" && !row.isNew && row.categoryId !== null)).toBe(true);
    const after = await stored();
    expect(after.map((row) => row.category_id)).toEqual(before.map((row) => row.category_id));
    expect(after.map((row) => row.category_origin)).toEqual(before.map((row) => row.category_origin));
    // The source's category is on the movements that still carry it; not on the one filed by hand.
    expect(after.map((row) => row.source_category_id !== null)).toEqual([false, true, true, false]);

    // Run twice, it writes nothing more.
    for (const statement of statements) await getPool().query(statement);
    expect(await listSourceCategories(ctx)).toHaveLength(rows.length);
  });
});

// N3.3 (categories-and-rules.md §2.4): a source's category may count under Transfers. Its movements
// keep their categories of the source (H34) and count as transfers; "Undo" makes them count as before.
describe("a match to a category of Transfers", () => {
  it("makes the source's movements transfers, keeps their own category, and Undo puts the type back", async () => {
    await read([incoming(TOBACCO), incoming(TOBACCO)]);
    const tobacco = await sourceNamed("Tobacco");
    const savings = await createCategory(ctx, { name: "Savings", type: "transfer" });
    const types = async () =>
      (
        await getPool().query<{ type: string }>("select type from transactions where user_id = $1", [
          ctx.userId,
        ])
      ).rows.map((row) => row.type);

    const change = await choose(tobacco.id, savings.id);
    expect(change).toMatchObject({ moved: 2, macro: { from: "expense", to: "transfer" } });
    expect(await types()).toEqual(["transfer", "transfer"]);
    for (const row of await stored()) {
      expect(row).toMatchObject({ source_category_id: tobacco.id, category_origin: "provider" });
    }

    await undo(change.undoId as string);
    expect(await types()).toEqual(["expense", "expense"]);
  });
});
