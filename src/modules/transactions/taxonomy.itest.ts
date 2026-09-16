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
  adoptOrCreateLabel,
  archiveCategory,
  createCategory,
  createLabel,
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
  updateCategory,
  updateLabel,
} from "./taxonomy";

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const GROCERIES = { name: "Groceries", group: "Living", type: "expense", color: "#2563EB" };

/**
 * A movement, written straight to the table: `service.ts` (T5) is what the application uses, and
 * these tests only need something for the usage counts to count.
 */
async function addTransaction(ctx: Ctx, accountId: string, categoryId: string | null, amountCents = -1_250n) {
  const [row] = await getDb()
    .insert(transactions)
    .values({
      userId: ctx.userId,
      accountId,
      occurredAt: new Date("2026-03-01T10:00:00Z"),
      amountCents,
      type: "expense",
      categoryId,
    })
    .returning({ id: transactions.id });
  return row.id;
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
      group: "Living",
      type: "expense",
      color: "#2563eb",
      archivedAt: null,
    });
  });

  it("takes an income category with no group and no colour", async () => {
    const category = await createCategory(ctx, { name: "Salary", group: "", type: "income", color: "" });
    expect(category).toMatchObject({ name: "Salary", group: null, type: "income", color: null });
  });

  it("defaults the type to expense", async () => {
    expect(await createCategory(ctx, { name: "Bits", group: null, color: null })).toMatchObject({
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
  it("orders by group, then name, and leaves the archived ones out unless asked", async () => {
    const rent = await createCategory(ctx, { name: "Rent", group: "Living", type: "expense", color: null });
    await createCategory(ctx, { name: "Apples", group: "Living", type: "expense", color: null });
    await createCategory(ctx, { name: "Books", group: "Fun", type: "expense", color: null });
    await createCategory(ctx, { name: "Loose", group: null, type: "expense", color: null });
    await archiveCategory(ctx, rent.id);

    expect((await listCategories(ctx)).map((row) => row.name)).toEqual(["Books", "Apples", "Loose"]);
    expect((await listCategories(ctx, { includeArchived: true })).map((row) => row.name)).toEqual([
      "Books",
      "Apples",
      "Rent",
      "Loose",
    ]);
  });
});

describe("listCategoriesWithUsage", () => {
  it("counts the movements filed under each category", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const unused = await createCategory(ctx, { name: "Fun", group: null, type: "expense", color: null });
    const accountId = await anAccount(ctx);
    await addTransaction(ctx, accountId, category.id);
    await addTransaction(ctx, accountId, category.id);
    await addTransaction(ctx, accountId, null);

    // "Living" before the ungrouped row: ascending group order puts the nulls last.
    const rows = await listCategoriesWithUsage(ctx);
    expect(rows).toEqual([
      { category: expect.objectContaining({ id: category.id }), usage: 2 },
      { category: expect.objectContaining({ id: unused.id }), usage: 0 },
    ]);
  });
});

describe("updateCategory", () => {
  it("saves the name, group, type and colour together", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const saved = await updateCategory(ctx, category.id, {
      name: "Food",
      group: "",
      type: "transfer",
      color: "#aabbcc",
    });
    expect(saved).toMatchObject({ name: "Food", group: null, type: "transfer", color: "#aabbcc" });
  });

  it("refuses a name another category already has", async () => {
    await createCategory(ctx, GROCERIES);
    const other = await createCategory(ctx, { name: "Fun", group: null, type: "expense", color: null });
    await expect(
      updateCategory(ctx, other.id, { ...GROCERIES, group: null, color: null }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("reports a category that is not there", async () => {
    await expect(updateCategory(ctx, crypto.randomUUID(), GROCERIES)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(updateCategory(ctx, "not-a-uuid", GROCERIES)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("renameCategory", () => {
  it("changes the name and keeps the rest", async () => {
    const category = await createCategory(ctx, GROCERIES);
    const renamed = await renameCategory(ctx, category.id, "Food");
    expect(renamed).toMatchObject({ name: "Food", group: "Living", type: "expense", color: "#2563eb" });
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
});

describe("adoptOrCreateCategory", () => {
  const external = { provider: WALLET_PROVIDER, externalId: "w-cat-1" };

  it("creates the category when nothing matches, and files the link", async () => {
    const created = await adoptOrCreateCategory(ctx, "Groceries", external);
    expect(created).toMatchObject({ name: "Groceries", type: "expense", group: null, color: null });

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
