import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { linkExternal, resolveExternal } from "@/platform/integrations/service";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { transactionLabels, transactions } from "./schema";
import {
  adoptOrCreateCategory,
  alignCategoryTypesToMovements,
  adoptOrCreateLabel,
  archiveCategory,
  createCategory,
  createLabel,
  deleteCategory,
  deleteLabel,
  getCategory,
  listCategories,
  listCategoriesWithUsage,
  listLabels,
  listLabelsWithUsage,
  NAME_MAX,
  renameCategory,
  renameLabel,
  restoreCategory,
  TaxonomyError,
  typeFromMovements,
  updateCategory,
  updateLabel,
} from "./taxonomy";

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const GROCERIES = { name: "Groceries", type: "expense", color: "#2563EB" };

/** A group: a category with no parent, which sub-categories can be filed under (F2.5). */
async function aGroup(ctx: Ctx, name = "Living", type = "expense") {
  return createCategory(ctx, { name, type, color: null });
}

/**
 * A movement, written straight to the table: `service.ts` (T5) is what the application uses, and
 * these tests only need something for the usage counts to count.
 */
async function addTransaction(
  ctx: Ctx,
  accountId: string,
  categoryId: string | null,
  amountCents = -1_250n,
  type: "income" | "expense" | "transfer" = "expense",
) {
  const [row] = await getDb()
    .insert(transactions)
    .values({
      userId: ctx.userId,
      accountId,
      occurredAt: new Date("2026-03-01T10:00:00Z"),
      amountCents,
      type,
      categoryId,
    })
    .returning({ id: transactions.id });
  return row.id;
}

/** The `locally_edited` markers of §7.2 on one movement, read straight from the column. */
async function markersOf(transactionId: string): Promise<string[]> {
  const [row] = await getDb()
    .select({ locallyEdited: transactions.locallyEdited })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  return row.locallyEdited;
}

async function anAccount(ctx: Ctx): Promise<string> {
  const account = await createAccount(ctx, {
    name: `Account ${crypto.randomUUID()}`,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

describe("createCategory", () => {
  it("stores what was typed, with the colour normalised", async () => {
    const category = await createCategory(ctx, GROCERIES);
    expect(category).toMatchObject({
      name: "Groceries",
      parentId: null,
      isRoot: true,
      type: "expense",
      color: "#2563eb",
      archivedAt: null,
    });
  });

  it("takes an income category with no group and no colour", async () => {
    const category = await createCategory(ctx, { name: "Salary", parentId: "", type: "income", color: "" });
    expect(category).toMatchObject({ name: "Salary", parentId: null, type: "income", color: null });
  });

  it("files a sub-category under a group, and gives it the group's type (F2.5)", async () => {
    const living = await aGroup(ctx);
    const salary = await createCategory(ctx, {
      name: "Salary",
      parentId: living.id,
      type: "income",
      color: null,
    });
    expect(salary).toMatchObject({ parentId: living.id, isRoot: false, type: "expense" });
  });

  it("takes one name under two groups, but not twice under one, nor for two groups (F2.5)", async () => {
    const living = await aGroup(ctx, "Living");
    const fun = await aGroup(ctx, "Fun");
    await createCategory(ctx, { name: "Other", parentId: living.id });
    await createCategory(ctx, { name: "Other", parentId: fun.id });
    await expect(createCategory(ctx, { name: "Other", parentId: living.id })).rejects.toMatchObject({
      code: "duplicate",
    });
    await expect(aGroup(ctx, "Fun")).rejects.toMatchObject({ code: "duplicate" });
  });

  it("refuses a parent that is a sub-category, archived, missing or somebody else's (F2.5)", async () => {
    const living = await aGroup(ctx);
    const groceries = await createCategory(ctx, { ...GROCERIES, parentId: living.id });
    const archived = await aGroup(ctx, "Old");
    await archiveCategory(ctx, archived.id);
    const theirs = await aGroup(await newContext(), "Theirs");

    for (const parentId of [groceries.id, archived.id, crypto.randomUUID(), theirs.id]) {
      await expect(createCategory(ctx, { name: "Apples", parentId })).rejects.toMatchObject({
        code: "invalid_parent",
      });
    }
    await expect(createCategory(ctx, { name: "Apples", parentId: "not-a-uuid" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("defaults the type to expense", async () => {
    expect(await createCategory(ctx, { name: "Bits", parentId: null, color: null })).toMatchObject({
      type: "expense",
    });
  });

  it("refuses a second category with the same name", async () => {
    await createCategory(ctx, GROCERIES);
    await expect(createCategory(ctx, GROCERIES)).rejects.toMatchObject({ code: "duplicate" });
  });

  it("refuses a blank name, an over-long name, a bad colour and an unknown type", async () => {
    for (const input of [
      { ...GROCERIES, name: "   " },
      { ...GROCERIES, name: "x".repeat(61) },
      { ...GROCERIES, color: "blue" },
      { ...GROCERIES, type: "refund" },
    ]) {
      await expect(createCategory(ctx, input)).rejects.toThrow(TaxonomyError);
    }
    expect(await listCategories(ctx)).toEqual([]);
  });
});

describe("listCategories", () => {
  it("lists each group with its sub-categories under it, and leaves the archived ones out unless asked", async () => {
    const living = await aGroup(ctx, "Living");
    const fun = await aGroup(ctx, "Fun");
    const rent = await createCategory(ctx, { name: "Rent", parentId: living.id });
    await createCategory(ctx, { name: "Apples", parentId: living.id });
    await createCategory(ctx, { name: "Books", parentId: fun.id });
    await createCategory(ctx, { name: "Loose" });
    await archiveCategory(ctx, rent.id);

    expect((await listCategories(ctx)).map((row) => row.name)).toEqual([
      "Fun",
      "Books",
      "Living",
      "Apples",
      "Loose",
    ]);
    expect((await listCategories(ctx, { includeArchived: true })).map((row) => row.name)).toEqual([
      "Fun",
      "Books",
      "Living",
      "Apples",
      "Rent",
      "Loose",
    ]);
  });
});

describe("listCategoriesWithUsage", () => {
  it("counts the movements filed under each category", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const unused = await createCategory(ctx, { name: "Fun", type: "expense", color: null });
    const accountId = await anAccount(ctx);
    await addTransaction(ctx, accountId, category.id);
    await addTransaction(ctx, accountId, category.id);
    await addTransaction(ctx, accountId, null);

    // Two groups, in name order.
    const rows = await listCategoriesWithUsage(ctx);
    expect(rows).toEqual([
      { category: expect.objectContaining({ id: unused.id }), usage: 0, depth: 0 },
      { category: expect.objectContaining({ id: category.id }), usage: 2, depth: 0 },
    ]);
  });
});

describe("updateCategory", () => {
  it("saves the name, type and colour together", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const saved = await updateCategory(ctx, category.id, {
      name: "Food",
      parentId: "",
      type: "transfer",
      color: "#aabbcc",
    });
    expect(saved).toMatchObject({ name: "Food", parentId: null, type: "transfer", color: "#aabbcc" });
  });

  it("moves a category into a group and back out, the group's type coming with it (F2.5)", async () => {
    const living = await aGroup(ctx, "Living", "expense");
    const salary = await createCategory(ctx, { name: "Salary", type: "income" });

    const moved = await updateCategory(ctx, salary.id, {
      name: "Salary",
      parentId: living.id,
      type: "income",
    });
    expect(moved).toMatchObject({ parentId: living.id, type: "expense" });

    const out = await updateCategory(ctx, salary.id, { name: "Salary", parentId: null, type: "income" });
    expect(out).toMatchObject({ parentId: null, type: "income" });
  });

  it("takes a group's sub-categories along when its type changes (F2.5)", async () => {
    const living = await aGroup(ctx, "Income", "expense");
    const salary = await createCategory(ctx, { name: "Salary", parentId: living.id });
    await updateCategory(ctx, living.id, { name: "Income", type: "income" });
    expect(await getCategory(ctx, salary.id)).toMatchObject({ type: "income" });
  });

  it("refuses a parent for a group that has sub-categories, and a category as its own parent (F2.5)", async () => {
    const living = await aGroup(ctx, "Living");
    const fun = await aGroup(ctx, "Fun");
    await createCategory(ctx, { name: "Rent", parentId: living.id });
    await expect(updateCategory(ctx, living.id, { name: "Living", parentId: fun.id })).rejects.toMatchObject({
      code: "invalid_parent",
    });
    await expect(updateCategory(ctx, fun.id, { name: "Fun", parentId: fun.id })).rejects.toMatchObject({
      code: "invalid_parent",
    });
  });

  it("refuses a name another category already has", async () => {
    await createCategory(ctx, GROCERIES);
    const other = await createCategory(ctx, { name: "Fun", type: "expense", color: null });
    await expect(updateCategory(ctx, other.id, { ...GROCERIES, color: null })).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("reports a category that is not there", async () => {
    await expect(updateCategory(ctx, crypto.randomUUID(), GROCERIES)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(updateCategory(ctx, "not-a-uuid", GROCERIES)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("renameCategory", () => {
  it("changes the name and keeps the rest, its group included", async () => {
    const living = await aGroup(ctx);
    const category = await createCategory(ctx, { ...GROCERIES, parentId: living.id });
    const renamed = await renameCategory(ctx, category.id, "Food");
    expect(renamed).toMatchObject({ name: "Food", parentId: living.id, type: "expense", color: "#2563eb" });
  });
});

describe("archiveCategory", () => {
  it("archives and restores, keeping the movements filed under it", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const accountId = await anAccount(ctx);
    await addTransaction(ctx, accountId, category.id);

    await archiveCategory(ctx, category.id);
    expect((await getCategory(ctx, category.id)).archivedAt).toBeInstanceOf(Date);
    expect(await listCategoriesWithUsage(ctx, { includeArchived: true })).toMatchObject([{ usage: 1 }]);

    await restoreCategory(ctx, category.id);
    expect((await getCategory(ctx, category.id)).archivedAt).toBeNull();
  });

  it("reports a category that is not there", async () => {
    await expect(archiveCategory(ctx, crypto.randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });

  it("archives a group with its sub-categories, and restores the group alone (F2.5)", async () => {
    const living = await aGroup(ctx);
    const rent = await createCategory(ctx, { name: "Rent", parentId: living.id });
    const food = await createCategory(ctx, { name: "Food", parentId: living.id });
    await archiveCategory(ctx, food.id);
    const foodArchivedAt = (await getCategory(ctx, food.id)).archivedAt;

    await archiveCategory(ctx, living.id);
    expect((await getCategory(ctx, rent.id)).archivedAt).toBeInstanceOf(Date);
    // Already archived before: its own moment is kept.
    expect((await getCategory(ctx, food.id)).archivedAt).toEqual(foodArchivedAt);

    await restoreCategory(ctx, living.id);
    expect((await getCategory(ctx, living.id)).archivedAt).toBeNull();
    expect((await getCategory(ctx, rent.id)).archivedAt).toBeInstanceOf(Date);
  });
});

describe("adoptOrCreateCategory", () => {
  const external = { provider: WALLET_PROVIDER, externalId: "w-cat-1" };

  it("creates the category when nothing matches, and files the link", async () => {
    const created = await adoptOrCreateCategory(ctx, "Groceries", external);
    expect(created).toMatchObject({ name: "Groceries", type: "expense", parentId: null, color: null });

    const links = await resolveExternal(ctx, WALLET_PROVIDER, "category", [external.externalId]);
    expect(links.get(external.externalId)).toBe(created.id);
  });

  it("adopts the local category with that exact name and links it", async () => {
    const local = await createCategory(ctx, GROCERIES);
    expect(await adoptOrCreateCategory(ctx, "Groceries", external)).toMatchObject({ id: local.id });
    expect(await listCategories(ctx)).toHaveLength(1);

    const links = await resolveExternal(ctx, WALLET_PROVIDER, "category", [external.externalId]);
    expect(links.get(external.externalId)).toBe(local.id);
  });

  it("follows the link before the name, so a renamed category is not duplicated", async () => {
    const local = await createCategory(ctx, GROCERIES);
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: local.id,
      externalId: external.externalId,
    });
    await renameCategory(ctx, local.id, "Food");

    // The provider still calls it "Groceries"; the link says it is the category now named "Food".
    expect(await adoptOrCreateCategory(ctx, "Groceries", external)).toMatchObject({
      id: local.id,
      name: "Food",
    });
    expect(await listCategories(ctx)).toHaveLength(1);
  });

  it("falls back to the name when the link points at a category that is gone", async () => {
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: crypto.randomUUID(),
      externalId: external.externalId,
    });
    const adopted = await adoptOrCreateCategory(ctx, "Groceries", external);
    expect(adopted.name).toBe("Groceries");

    const links = await resolveExternal(ctx, WALLET_PROVIDER, "category", [external.externalId]);
    expect(links.get(external.externalId)).toBe(adopted.id);
  });

  it("matches the name exactly: a different case is a different category", async () => {
    const local = await createCategory(ctx, GROCERIES);
    const adopted = await adoptOrCreateCategory(ctx, "groceries");
    expect(adopted.id).not.toBe(local.id);
    expect(await listCategories(ctx)).toHaveLength(2);
  });

  it("adopts an archived namesake without resurrecting it", async () => {
    const local = await createCategory(ctx, GROCERIES);
    await archiveCategory(ctx, local.id);

    const adopted = await adoptOrCreateCategory(ctx, "Groceries", external);
    expect(adopted.id).toBe(local.id);
    expect(adopted.archivedAt).toBeInstanceOf(Date);
    expect(await listCategories(ctx, { includeArchived: true })).toHaveLength(1);
  });

  it("changes nothing when it runs twice, with or without the provider's id", async () => {
    const first = await adoptOrCreateCategory(ctx, "Groceries", external);
    expect(await adoptOrCreateCategory(ctx, "Groceries", external)).toMatchObject({ id: first.id });
    expect(await adoptOrCreateCategory(ctx, "Groceries")).toMatchObject({ id: first.id });
    expect(await listCategories(ctx)).toHaveLength(1);
  });

  it("keeps going when two of the provider's categories share one local name", async () => {
    const first = await adoptOrCreateCategory(ctx, "Groceries", external);
    const second = await adoptOrCreateCategory(ctx, "Groceries", {
      provider: WALLET_PROVIDER,
      externalId: "w-cat-2",
    });
    expect(second.id).toBe(first.id);

    const links = await resolveExternal(ctx, WALLET_PROVIDER, "category", [external.externalId, "w-cat-2"]);
    expect(links.get(external.externalId)).toBe(first.id);
    expect(links.get("w-cat-2")).toBeUndefined();
  });

  it("refuses a name the column could not hold, when the name is all there is to go on", async () => {
    await expect(adoptOrCreateCategory(ctx, "  ")).rejects.toMatchObject({ code: "invalid" });
    await expect(adoptOrCreateCategory(ctx, "x".repeat(61))).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps the linked category when the provider's name has grown past the column", async () => {
    // Review A6, with its numbers: Wallet category `wc-1` is "Spesa", adopted, linked, and carries
    // three Esselunga movements adding up to 85,20 €. The person then renames it *in Wallet* to
    // something 65 characters long. Validating the name before reading the link made this answer
    // `null`, `service.ts` turned that into `categoryId: null`, and the three movements lost their
    // category every hour — the "By category" card moving 85,20 € onto "Uncategorised" with no
    // error anywhere. The link exists and points at a live category, so the provider's name is not
    // needed at all, whatever it says.
    const local = await createCategory(ctx, { ...GROCERIES, name: "Spesa" });
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: local.id,
      externalId: external.externalId,
    });
    const accountId = await anAccount(ctx);
    for (let i = 0; i < 3; i += 1) await addTransaction(ctx, accountId, local.id, -2_840n);

    const renamedInWallet = "Spesa ".repeat(11).trim();
    expect(renamedInWallet.length).toBe(65);
    expect(renamedInWallet.length).toBeGreaterThan(NAME_MAX);

    expect(await adoptOrCreateCategory(ctx, renamedInWallet, external)).toMatchObject({
      id: local.id,
      name: "Spesa",
    });

    expect(await listCategories(ctx)).toHaveLength(1);
    expect(await listCategoriesWithUsage(ctx)).toMatchObject([{ category: { id: local.id }, usage: 3 }]);
  });
});

/** Spec §9.1, F2.5: Wallet's group of a category becomes its parent here. */
describe("adoptOrCreateCategory with a provider group", () => {
  const external = { provider: WALLET_PROVIDER, externalId: "w-cat-1" };
  const food = { name: "Food & Drinks", externalId: "w-group-1" };

  async function groupLink(externalId = food.externalId) {
    return (await resolveExternal(ctx, WALLET_PROVIDER, "category_group", [externalId])).get(externalId);
  }

  it("files a new category under the group, creating the group and linking both", async () => {
    const groceries = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    const [group] = (await listCategories(ctx)).filter((one) => one.parentId === null);
    expect(group).toMatchObject({ name: "Food & Drinks", type: "expense" });
    expect(groceries).toMatchObject({ name: "Groceries", parentId: group.id });
    expect(await groupLink()).toBe(group.id);

    // A second category of the same group goes under the same row.
    const restaurant = await adoptOrCreateCategory(
      ctx,
      "Restaurant",
      { provider: WALLET_PROVIDER, externalId: "w-cat-2" },
      food,
    );
    expect(restaurant.parentId).toBe(group.id);
    expect((await listCategories(ctx)).map((one) => one.name)).toEqual([
      "Food & Drinks",
      "Groceries",
      "Restaurant",
    ]);
  });

  it("follows the group's link through a rename, here or in the provider", async () => {
    const groceries = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    const groupId = groceries.parentId as string;
    await renameCategory(ctx, groupId, "Cibo");

    const again = await adoptOrCreateCategory(ctx, "Groceries", external, { ...food, name: "Food" });
    expect(again).toMatchObject({ id: groceries.id, parentId: groupId });
    expect(await listCategories(ctx)).toHaveLength(2);
  });

  it("puts a category adopted before groups existed under its group, when the types agree", async () => {
    // F2 adopted every Wallet category as a top-level one: the next sync files it.
    const before = await adoptOrCreateCategory(ctx, "Groceries", external);
    const after = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    expect(after.id).toBe(before.id);
    expect(after.parentId).not.toBeNull();
  });

  it("gives a new group the type of the category it is created for", async () => {
    const salary = await createCategory(ctx, { name: "Salary", type: "income" });
    const adopted = await adoptOrCreateCategory(ctx, "Salary", external, {
      name: "Income",
      externalId: "w-group-9",
    });
    expect(adopted).toMatchObject({ id: salary.id, type: "income" });
    expect(await getCategory(ctx, adopted.parentId as string)).toMatchObject({
      name: "Income",
      type: "income",
    });
  });

  it("leaves a category where it is when the group has another type", async () => {
    await aGroup(ctx, "Food & Drinks", "expense");
    const salary = await createCategory(ctx, { name: "Salary", type: "income" });
    const adopted = await adoptOrCreateCategory(ctx, "Salary", external, food);
    expect(adopted).toMatchObject({ id: salary.id, parentId: null, type: "income" });
  });

  it("never moves a category that already has a group", async () => {
    const mine = await aGroup(ctx, "Mine");
    const groceries = await createCategory(ctx, { name: "Groceries", parentId: mine.id });
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: groceries.id,
      externalId: external.externalId,
    });
    const adopted = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    expect(adopted).toMatchObject({ id: groceries.id, parentId: mine.id });
  });

  it("never puts back a category somebody took out of its group by hand (spec §7.2)", async () => {
    // The sync files a parentless category under its group, and a category somebody took out of it
    // is parentless too: without a marker, the next pass undid that choice every hour.
    const groceries = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    await updateCategory(ctx, groceries.id, { name: "Groceries", parentId: null });

    const again = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    expect(again).toMatchObject({ id: groceries.id, parentId: null, parentSetLocally: true });
  });

  it("files a category named like its group under the group itself, not under a twin", async () => {
    const others = await adoptOrCreateCategory(ctx, "Others", external, {
      name: "Others",
      externalId: "w-group-2",
    });
    expect(others.parentId).toBeNull();
    expect(await listCategories(ctx)).toHaveLength(1);
    expect(await groupLink("w-group-2")).toBe(others.id);
  });

  it("keeps the category when the group's name is one the column cannot hold", async () => {
    const groceries = await adoptOrCreateCategory(ctx, "Groceries", external, {
      name: "x".repeat(61),
      externalId: null,
    });
    expect(groceries).toMatchObject({ name: "Groceries", parentId: null });
  });

  it("keeps going when two of the provider's groups share one local name", async () => {
    // Production, 2026-09-18: two Wallet groups with different ids reached the same local group,
    // and the second link failed the whole transactions pass, every hour.
    const first = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    const second = await adoptOrCreateCategory(
      ctx,
      "Restaurant",
      { provider: WALLET_PROVIDER, externalId: "w-cat-2" },
      { name: food.name, externalId: "w-group-2" },
    );
    expect(second.parentId).toBe(first.parentId);
  });

  it("changes nothing when it runs twice", async () => {
    const first = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    const second = await adoptOrCreateCategory(ctx, "Groceries", external, food);
    expect(second).toMatchObject({ id: first.id, parentId: first.parentId });
    expect(await listCategories(ctx)).toHaveLength(2);
  });
});

describe("labels", () => {
  it("creates, renames, recolours and deletes", async () => {
    const label = await createLabel(ctx, { name: "Holiday", color: "#FF8800" });
    expect(label).toMatchObject({ name: "Holiday", color: "#ff8800" });

    expect(await renameLabel(ctx, label.id, "Trip")).toMatchObject({ name: "Trip", color: "#ff8800" });
    expect(await updateLabel(ctx, label.id, { name: "Trip", color: "" })).toMatchObject({ color: null });

    await deleteLabel(ctx, label.id);
    expect(await listLabels(ctx)).toEqual([]);
  });

  it("refuses a duplicate name and a blank one", async () => {
    await createLabel(ctx, { name: "Holiday", color: null });
    await expect(createLabel(ctx, { name: "Holiday", color: null })).rejects.toMatchObject({
      code: "duplicate",
    });
    await expect(createLabel(ctx, { name: " ", color: null })).rejects.toMatchObject({ code: "invalid" });
  });

  it("orders by name and counts the movements carrying each label", async () => {
    const holiday = await createLabel(ctx, { name: "Holiday", color: null });
    const work = await createLabel(ctx, { name: "Work", color: null });
    const accountId = await anAccount(ctx);
    const first = await addTransaction(ctx, accountId, null);
    const second = await addTransaction(ctx, accountId, null);
    await getDb()
      .insert(transactionLabels)
      .values([
        { userId: ctx.userId, transactionId: first, labelId: holiday.id },
        { userId: ctx.userId, transactionId: second, labelId: holiday.id },
      ]);

    expect(await listLabelsWithUsage(ctx)).toEqual([
      { label: expect.objectContaining({ id: holiday.id }), usage: 2 },
      { label: expect.objectContaining({ id: work.id }), usage: 0 },
    ]);
  });

  it("takes its label off the movements when it is deleted", async () => {
    const label = await createLabel(ctx, { name: "Holiday", color: null });
    const accountId = await anAccount(ctx);
    const transactionId = await addTransaction(ctx, accountId, null);
    await getDb().insert(transactionLabels).values({ userId: ctx.userId, transactionId, labelId: label.id });

    await deleteLabel(ctx, label.id);
    expect(await getDb().select().from(transactionLabels)).toEqual([]);
  });

  it("marks the movements it was taken off, and only those (review B12)", async () => {
    // Deleting a label edits the `labels` field of the movements that carried it, so §7.2's
    // marker is what keeps the deletion: labels have no provider link, §9.1 matches them by name,
    // and without the marker the next pass re-created the name and the merge re-attached it.
    const label = await createLabel(ctx, { name: "Holiday", color: null });
    const accountId = await anAccount(ctx);
    const tagged = await addTransaction(ctx, accountId, null);
    const untouched = await addTransaction(ctx, accountId, null);
    await getDb()
      .insert(transactionLabels)
      .values({ userId: ctx.userId, transactionId: tagged, labelId: label.id });

    await deleteLabel(ctx, label.id);

    expect(await markersOf(tagged)).toEqual(["labels"]);
    expect(await markersOf(untouched)).toEqual([]);
  });

  it("adds the marker to the ones a movement already had, without repeating it", async () => {
    const label = await createLabel(ctx, { name: "Holiday", color: null });
    const accountId = await anAccount(ctx);
    const edited = await addTransaction(ctx, accountId, null);
    const already = await addTransaction(ctx, accountId, null);
    await getDb()
      .insert(transactionLabels)
      .values([
        { userId: ctx.userId, transactionId: edited, labelId: label.id },
        { userId: ctx.userId, transactionId: already, labelId: label.id },
      ]);
    await getDb()
      .update(transactions)
      .set({ locallyEdited: ["note"] })
      .where(eq(transactions.id, edited));
    await getDb()
      .update(transactions)
      .set({ locallyEdited: ["labels"] })
      .where(eq(transactions.id, already));

    await deleteLabel(ctx, label.id);

    expect(await markersOf(edited)).toEqual(["labels", "note"]);
    expect(await markersOf(already)).toEqual(["labels"]);
  });

  it("marks nothing when the label it is asked to delete is not there", async () => {
    const accountId = await anAccount(ctx);
    const transactionId = await addTransaction(ctx, accountId, null);
    const label = await createLabel(ctx, { name: "Holiday", color: null });
    await getDb().insert(transactionLabels).values({ userId: ctx.userId, transactionId, labelId: label.id });

    await expect(deleteLabel(ctx, crypto.randomUUID())).rejects.toMatchObject({ code: "not_found" });

    expect(await markersOf(transactionId)).toEqual([]);
    expect(await listLabels(ctx)).toHaveLength(1);
  });

  it("reports a label that is not there", async () => {
    await expect(deleteLabel(ctx, crypto.randomUUID())).rejects.toMatchObject({ code: "not_found" });
    await expect(renameLabel(ctx, crypto.randomUUID(), "Trip")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("adoptOrCreateLabel", () => {
  it("takes the label with that exact name, and creates it only when there is none", async () => {
    const created = await adoptOrCreateLabel(ctx, "Holiday");
    expect(await adoptOrCreateLabel(ctx, "Holiday")).toMatchObject({ id: created.id });
    expect(await adoptOrCreateLabel(ctx, "holiday")).not.toMatchObject({ id: created.id });
    expect(await listLabels(ctx)).toHaveLength(2);
  });

  it("clips a name past the column instead of answering with nothing", async () => {
    // Review A6 for labels: refusing the name made `service.ts` answer "no label", which took the
    // tag off every movement that carried it. A label has no provider link to recover it from, so
    // the clip is what keeps the movements tagged.
    const long = "Holiday in the Dolomites with the whole family".padEnd(70, "!");
    const adopted = await adoptOrCreateLabel(ctx, long);
    expect(adopted.name).toBe(long.slice(0, NAME_MAX));
    expect(await adoptOrCreateLabel(ctx, long)).toMatchObject({ id: adopted.id });
    expect(await listLabels(ctx)).toHaveLength(1);
  });

  it("clips whole characters, so a surrogate pair is never cut in half", async () => {
    // `NAME_MAX` is what the column counts, and Postgres counts characters: 60 of these fit even
    // though they are 120 code units, and cutting by code units would leave a lone surrogate.
    const adopted = await adoptOrCreateLabel(ctx, "\u{1F3D4}".repeat(70));
    expect([...adopted.name]).toHaveLength(NAME_MAX);
    expect(adopted.name).toBe("\u{1F3D4}".repeat(NAME_MAX));
  });

  it("still refuses a name that is blank once trimmed", async () => {
    await expect(adoptOrCreateLabel(ctx, "   ")).rejects.toMatchObject({ code: "invalid" });
  });
});

/** Spec §4.4 and §11: user B reads, changes, deletes and references nothing of user A's. */
describe("isolation between users", () => {
  it("keeps one user's categories and labels out of the other's lists", async () => {
    await createCategory(ctx, GROCERIES);
    await createLabel(ctx, { name: "Holiday", color: null });
    const other = await newContext();

    expect(await listCategories(other, { includeArchived: true })).toEqual([]);
    expect(await listCategoriesWithUsage(other, { includeArchived: true })).toEqual([]);
    expect(await listLabels(other)).toEqual([]);
    expect(await listLabelsWithUsage(other)).toEqual([]);
  });

  it("refuses to read, change, archive or delete the other user's rows", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const label = await createLabel(ctx, { name: "Holiday", color: null });
    const other = await newContext();

    await expect(getCategory(other, category.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateCategory(other, category.id, { ...GROCERIES, name: "Stolen" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(renameCategory(other, category.id, "Stolen")).rejects.toMatchObject({ code: "not_found" });
    await expect(archiveCategory(other, category.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(restoreCategory(other, category.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(createCategory(other, { name: "Mine now", parentId: category.id })).rejects.toMatchObject({
      code: "invalid_parent",
    });
    await expect(renameLabel(other, label.id, "Stolen")).rejects.toMatchObject({ code: "not_found" });
    await expect(updateLabel(other, label.id, { name: "Stolen", color: null })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteLabel(other, label.id)).rejects.toMatchObject({ code: "not_found" });

    expect(await getCategory(ctx, category.id)).toMatchObject({ name: "Groceries", archivedAt: null });
    expect(await listLabels(ctx)).toMatchObject([{ name: "Holiday" }]);
  });

  it("gives each user their own row for the same name rather than sharing one", async () => {
    const mine = await adoptOrCreateCategory(ctx, "Groceries", {
      provider: WALLET_PROVIDER,
      externalId: "w-cat-1",
    });
    const myLabel = await adoptOrCreateLabel(ctx, "Holiday");
    const other = await newContext();

    const theirs = await adoptOrCreateCategory(other, "Groceries", {
      provider: WALLET_PROVIDER,
      externalId: "w-cat-1",
    });
    const theirLabel = await adoptOrCreateLabel(other, "Holiday");

    expect(theirs.id).not.toBe(mine.id);
    expect(theirLabel.id).not.toBe(myLabel.id);
    expect(await listCategories(ctx)).toHaveLength(1);
    expect(await listCategories(other)).toHaveLength(1);
  });

  it("never counts the other user's movements as usage", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const other = await newContext();
    const theirAccount = await anAccount(other);
    // A forged reference to somebody else's category: it is not counted, and it is not listed.
    await addTransaction(other, theirAccount, category.id);

    expect(await listCategoriesWithUsage(ctx)).toMatchObject([{ usage: 0 }]);
    expect(await listCategoriesWithUsage(other)).toEqual([]);
  });
});

/*
  Wallet publishes no type on a category, so everything adopted from it is born an expense — the
  owner's "Interest, dividends", with thirty-two income movements under it, among them. What is
  filed under a category is the only evidence there is (owner, 2026-09-20).
*/
describe("the type a category's movements say it is", () => {
  it("needs enough evidence, and enough agreement", () => {
    expect(typeFromMovements({ income: 2, expense: 0, transfer: 0 })).toBeNull();
    expect(typeFromMovements({ income: 3, expense: 0, transfer: 0 })).toBe("income");
    // One stray movement out of ten is noise; four out of ten is a disagreement.
    expect(typeFromMovements({ income: 9, expense: 1, transfer: 0 })).toBe("income");
    expect(typeFromMovements({ income: 6, expense: 4, transfer: 0 })).toBeNull();
    expect(typeFromMovements({ income: 0, expense: 0, transfer: 5 })).toBe("transfer");
  });

  it("moves a category the movements disagree with, and leaves the rest alone", async () => {
    const account = await anAccount(ctx);
    const group = await createCategory(ctx, { name: "Income", type: "expense" });
    const interest = await createCategory(ctx, {
      name: "Interest, dividends",
      type: "expense",
      parentId: group.id,
    });
    const groceries = await createCategory(ctx, GROCERIES);
    for (let i = 0; i < 4; i += 1) await addTransaction(ctx, account, interest.id, 1_000n, "income");
    for (let i = 0; i < 3; i += 1) await addTransaction(ctx, account, groceries.id, -1_000n, "expense");

    expect(await alignCategoryTypesToMovements(ctx)).toBe(1);
    expect((await getCategory(ctx, interest.id))?.type).toBe("income");
    expect((await getCategory(ctx, groceries.id))?.type).toBe("expense");
    // Nothing left to do on the second pass.
    expect(await alignCategoryTypesToMovements(ctx)).toBe(0);
  });

  it("takes the silent children of a group with it, and never a type set by hand", async () => {
    const account = await anAccount(ctx);
    const group = await createCategory(ctx, { name: "Income", type: "expense" });
    const silent = await createCategory(ctx, { name: "Refunds", type: "expense", parentId: group.id });
    const byHand = await createCategory(ctx, { name: "Gifts", type: "expense", parentId: group.id });
    // The owner says this one is an expense, whatever is filed under it.
    await updateCategory(ctx, byHand.id, { name: "Gifts", type: "expense", color: null, parentId: null });
    await updateCategory(ctx, byHand.id, {
      name: "Gifts",
      type: "income",
      color: null,
      parentId: null,
    });
    await updateCategory(ctx, byHand.id, {
      name: "Gifts",
      type: "expense",
      color: null,
      parentId: group.id,
    });
    for (let i = 0; i < 5; i += 1) await addTransaction(ctx, account, group.id, 1_000n, "income");

    await alignCategoryTypesToMovements(ctx);
    expect((await getCategory(ctx, group.id))?.type).toBe("income");
    expect((await getCategory(ctx, silent.id))?.type).toBe("income");
    expect((await getCategory(ctx, byHand.id))?.type).toBe("expense");
  });
});

describe("deleteCategory", () => {
  it("removes it for good and leaves its movements without a category", async () => {
    const ctx = await newContext();
    const accountId = await anAccount(ctx);
    const category = await createCategory(ctx, GROCERIES);
    const movement = await addTransaction(ctx, accountId, category.id);

    const deletion = await deleteCategory(ctx, category.id);

    expect(deletion.removed.map((one) => one.name)).toEqual(["Groceries"]);
    expect(deletion.uncategorised).toBe(1);
    await expect(getCategory(ctx, category.id)).rejects.toMatchObject({ code: "not_found" });
    const [row] = await getDb()
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, movement));
    expect(row.categoryId).toBeNull();
  });

  it("takes its sub-categories with it, because a child cannot outlive its group", async () => {
    const ctx = await newContext();
    const group = await aGroup(ctx);
    const child = await createCategory(ctx, { name: "Rent", type: "expense", parentId: group.id });
    const other = await createCategory(ctx, { name: "Water", type: "expense", parentId: group.id });

    const deletion = await deleteCategory(ctx, group.id);

    expect(deletion.removed.map((one) => one.id).sort()).toEqual([group.id, child.id, other.id].sort());
    expect(await listCategories(ctx, { includeArchived: true })).toEqual([]);
  });

  it("hands back the provider's own ids and then forgets the links", async () => {
    const ctx = await newContext();
    const group = await aGroup(ctx);
    const child = await createCategory(ctx, { name: "Rent", type: "expense", parentId: group.id });
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category",
      entityId: child.id,
      externalId: "w-child",
    });
    await linkExternal(ctx, {
      provider: WALLET_PROVIDER,
      entityType: "category_group",
      entityId: group.id,
      externalId: "w-group",
    });

    const deletion = await deleteCategory(ctx, group.id);

    expect(deletion.externalIds.sort()).toEqual(["w-child", "w-group"]);
    // A link left behind would make the next pass adopt a category that no longer exists.
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "category", ["w-child"])).toEqual(new Map());
    expect(await resolveExternal(ctx, WALLET_PROVIDER, "category_group", ["w-group"])).toEqual(new Map());
  });

  it("says there is nothing to tell Wallet about a category it never knew", async () => {
    const ctx = await newContext();
    const category = await createCategory(ctx, GROCERIES);
    expect((await deleteCategory(ctx, category.id)).externalIds).toEqual([]);
  });

  it("refuses an id that is not this user's, and touches nothing", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const category = await createCategory(theirs, GROCERIES);
    await expect(deleteCategory(mine, category.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getCategory(theirs, category.id)).name).toBe("Groceries");
  });

  it("counts only this user's movements as uncategorised", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const account = await anAccount(mine);
    const theirAccount = await anAccount(theirs);
    const category = await createCategory(mine, GROCERIES);
    const theirCategory = await createCategory(theirs, GROCERIES);
    await addTransaction(mine, account, category.id);
    await addTransaction(theirs, theirAccount, theirCategory.id);
    expect((await deleteCategory(mine, category.id)).uncategorised).toBe(1);
  });

  it("is the irreversible move beside archiving, which stays reversible", async () => {
    const ctx = await newContext();
    const kept = await createCategory(ctx, GROCERIES);
    await archiveCategory(ctx, kept.id);
    await restoreCategory(ctx, kept.id);
    expect((await getCategory(ctx, kept.id)).archivedAt).toBeNull();

    await deleteCategory(ctx, kept.id);
    await expect(getCategory(ctx, kept.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
