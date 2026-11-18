// "Categories of {source}" as the screen changes them (rewrite plan N3.1; ux §6.4): a match, with
// the budgets of the two categories, and its "Undo". The rules of the match itself are tested in
// the transactions module; this is what only the application joins.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts } from "@domain/modules/accounts/queries";
import { applyProviderAccounts } from "@domain/modules/accounts/service";
import { setLimit } from "@domain/modules/budgets/service";
import type { IncomingTransaction } from "@domain/modules/transactions/rules";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import type { Ctx } from "@domain/platform/context";
import { monthKey, today } from "@domain/platform/dates";
import { getPool } from "@domain/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import {
  setSourceCategory,
  sourceCategoryRows,
  sourceCategorySections,
  sourceNotes,
  undoSourceCategoryChange,
} from "./source";

const SOURCE = "wallet";
const MONTH = monthKey(today("Europe/Rome"));

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
let serial = 0;

function incoming(id: string, name: string): IncomingTransaction {
  serial += 1;
  return {
    externalId: `ext-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 9, serial, 10)),
    amountCents: -1_000n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: `Shop ${serial}`,
    note: null,
    categoryExternalId: id,
    categoryName: name,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

async function categoryNamed(name: string) {
  const found = (await listCategories(ctx, { includeArchived: true })).find((one) => one.name === name);
  if (!found) throw new Error(`no category ${name}`);
  return found;
}

/** The limits as stored, from this month on: what a budget reads. */
async function limits() {
  const { rows } = await getPool().query<{ name: string; amount_cents: string | null; stopped: boolean }>(
    "select c.name, l.amount_cents, l.stopped from budget_limits l join categories c on c.id = l.category_id where l.user_id = $1 and l.from_month >= $2 order by c.name, l.from_month",
    [ctx.userId, MONTH],
  );
  return rows;
}

beforeEach(async () => {
  await resetDatabase();
  serial = 0;
  ctx = contextFor((await createTestUser()).id);
  await applyProviderAccounts(ctx, SOURCE, [
    { provider: SOURCE, providerAccountId: "acc-1", name: "Current", type: "checking", currency: "EUR" },
  ]);
  const [account] = await listAccounts(ctx);
  await upsertFromProvider(
    ctx,
    account.id,
    [incoming("sc-tobacco", "Tobacco"), incoming("sc-alcohol", "Alcohol, tobacco")],
    { provider: SOURCE },
  );
});
afterAll(closeDatabase);

describe("the categories of a source, as the screen shows them", () => {
  it("is one section for each source, under the name a person reads", async () => {
    const sections = await sourceCategorySections(ctx);
    expect(sections).toHaveLength(1);
    expect(sections[0].provider).toBe(SOURCE);
    expect(sections[0].name).not.toBe("");
    expect(sections[0].rows.map((row) => row.name)).toEqual(["Alcohol, tobacco", "Tobacco"]);
  });

  it("says under a category which categories of the source count there", async () => {
    const alcohol = await categoryNamed("Alcohol, tobacco");
    const [section] = await sourceCategorySections(ctx);
    const tobacco = section.rows.find((row) => row.name === "Tobacco");
    await setSourceCategory(ctx, { id: tobacco!.id, categoryId: alcohol.id });

    const notes = await sourceNotes(ctx);
    expect(notes.get(alcohol.id)).toEqual({
      provider: section.provider,
      source: section.name,
      names: ["Alcohol, tobacco", "Tobacco"],
    });
  });

  it("draws the same match on the source's page, with the categories it may be matched to (N7.2)", async () => {
    const alcohol = await categoryNamed("Alcohol, tobacco");
    const [section] = await sourceCategorySections(ctx);
    const tobacco = section.rows.find((row) => row.name === "Tobacco");
    await setSourceCategory(ctx, { id: tobacco!.id, categoryId: alcohol.id });

    const view = await sourceCategoryRows(ctx, section.provider);
    expect(view?.name).toBe(section.name);
    expect(view?.rows.map((row) => row.name)).toEqual(section.rows.map((row) => row.name));
    const row = view?.rows.find((one) => one.name === "Tobacco");
    expect(row).toMatchObject({ choice: "matched", category: { id: alcohol.id, name: "Alcohol, tobacco" } });
    expect(row?.options.map((option) => option.id)).toContain(alcohol.id);
    // A source that gave no category has no section.
    expect(await sourceCategoryRows(ctx, "plugin:none")).toBeNull();
  });
});

describe("a match and the budgets (decision H35, point 7)", () => {
  it("sums the limits of the category put away into the one that stays, and undo puts both back", async () => {
    const alcohol = await categoryNamed("Alcohol, tobacco");
    const tobaccoCategory = await categoryNamed("Tobacco");
    await setLimit(ctx, { categoryId: alcohol.id, accountId: null, month: MONTH, cents: 5_000n });
    await setLimit(ctx, { categoryId: tobaccoCategory.id, accountId: null, month: MONTH, cents: 2_000n });
    const before = await limits();
    const [section] = await sourceCategorySections(ctx);
    const tobacco = section.rows.find((row) => row.name === "Tobacco");

    const change = await setSourceCategory(ctx, { id: tobacco!.id, categoryId: alcohol.id });
    expect(change).toMatchObject({ choice: "matched", moved: 1 });
    expect(await limits()).toEqual([
      { name: "Alcohol, tobacco", amount_cents: "7000", stopped: false },
      { name: "Tobacco", amount_cents: null, stopped: true },
    ]);

    expect(await undoSourceCategoryChange(ctx, change.undoId as string)).toEqual({ moved: 1 });
    expect(await limits()).toEqual(before);
    expect((await categoryNamed("Tobacco")).archivedAt).toBeNull();
  });

  it("leaves the budgets alone when the category put away has no limit", async () => {
    const alcohol = await categoryNamed("Alcohol, tobacco");
    await setLimit(ctx, { categoryId: alcohol.id, accountId: null, month: MONTH, cents: 5_000n });
    const before = await limits();
    const [section] = await sourceCategorySections(ctx);
    const tobacco = section.rows.find((row) => row.name === "Tobacco");

    const change = await setSourceCategory(ctx, { id: tobacco!.id, categoryId: alcohol.id });
    expect(await limits()).toEqual(before);
    await undoSourceCategoryChange(ctx, change.undoId as string);
    expect(await limits()).toEqual(before);
  });
});
