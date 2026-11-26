import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyProviderAccounts, createAccount } from "../../accounts/service";
import { listAccounts } from "../../accounts/queries";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { createTestUser } from "../../../../../../test/users";
import { movementsOutOfLine } from "../macro";
import { listTransactions, rulesForExport } from "../queries";
import type { IncomingTransaction } from "../rules";
import { categories, categoryModels, transactionLabels, transactions } from "../schema";
import { setCategory, TransactionError, upsertFromProvider } from "../service";
import { createCategory, createLabel } from "../taxonomy";
import { categorise } from "./service";
import {
  applyRule,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  reorderRules,
  restoreRule,
  rulesForCategory,
  undoRuleApply,
  updateRule,
} from "./user-rules-service";

// The rules of a person on the test database (categories-and-rules.md §10, N3.4): what a rule
// writes on the movements, what it never touches, "Apply" and its "Undo", and that one person's
// rules are nobody else's. The texts are invented.

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
const newContext = async () => contextFor((await createTestUser()).id);

/** A source that gives a category with each movement, and one that only reads (a bank). */
const GIVES = "plugin:wallet";
const BANK = "plugin:testbank";

/**
 * An account the rules may write on: kept by hand, so no source gives its categories. (A plugin's
 * account is one only once its manifest is read, which these tests do not set up.)
 */
async function own(ctx: Ctx, name: string): Promise<string> {
  const account = await createAccount(ctx, {
    name,
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

async function synced(ctx: Ctx, provider: string, name: string): Promise<string> {
  await applyProviderAccounts(ctx, provider, [
    { provider, providerAccountId: `${name}-1`, name, type: "checking", currency: "EUR" },
  ]);
  return (await listAccounts(ctx)).find((one) => one.name === name)!.id;
}

let serial = 0;
function incoming(
  payee: string,
  day: number,
  cents = -1_000n,
  category: string | null = null,
): IncomingTransaction {
  serial += 1;
  return {
    externalId: `rule-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 9, day, 11)),
    amountCents: cents,
    currency: "EUR",
    type: cents < 0n ? "expense" : "income",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: null,
    categoryName: category,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

async function rows(ctx: Ctx) {
  return getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.userId, ctx.userId))
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
}

/** Every column a person could see change, and the labels: what "the same picture" means here. */
async function picture(ctx: Ctx): Promise<string> {
  const all = (await rows(ctx)).map((row) => ({ ...row, updatedAt: null }));
  const tags = await getDb()
    .select({ transactionId: transactionLabels.transactionId, labelId: transactionLabels.labelId })
    .from(transactionLabels)
    .where(eq(transactionLabels.userId, ctx.userId))
    .orderBy(asc(transactionLabels.transactionId), asc(transactionLabels.labelId));
  return JSON.stringify({ all, tags }, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

const topUp = (categoryId: string) => ({
  name: "Top-up",
  conditions: [{ field: "text", op: "contains", value: "top up" }],
  categoryId,
});

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("a rule on the movements a bank brings", () => {
  it("gives a category, marked automatic, before the cascade, and never teaches the model", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    const label = await createLabel(ctx, { name: "Card" });
    const rule = await createRule(ctx, { ...topUp(card.id), labelIds: [label.id], note: "Monthly top-up" });
    await upsertFromProvider(ctx, bank, [incoming("TOP-UP card 1234", 1), incoming("Bakery", 2)], {
      provider: BANK,
    });

    await categorise(ctx, [bank]);

    const [topped, bread] = await rows(ctx);
    expect(topped).toMatchObject({
      categoryId: card.id,
      categoryOrigin: "rule",
      categoryRuleId: rule.id,
      categoryReason: "rule",
      categoryReasonParams: { name: "Top-up", ruleId: rule.id },
      type: "expense",
      note: "Monthly top-up",
    });
    expect(bread.categoryRuleId).toBeNull();
    const tags = await getDb()
      .select()
      .from(transactionLabels)
      .where(eq(transactionLabels.transactionId, topped.id));
    expect(tags.map((tag) => tag.labelId)).toEqual([label.id]);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);
    // The row shows the mark "automatic" with the rule's reason.
    const listed = (await listTransactions(ctx, { includeHidden: true })).find(
      (row) => row.id === topped.id,
    )!;
    expect(listed.categoryState).toBe("automatic");
    expect(listed.categoryReason).toEqual({ code: "rule", params: { name: "Top-up", ruleId: rule.id } });
    // Not a confirmed label: the model had nothing to learn from.
    const [model] = await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId));
    expect(model?.examples ?? 0).toBe(0);
    expect((await listRules(ctx))[0].count).toBe(1);
  });

  it("the first active rule that matches decides (QC5)", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const shopping = await createCategory(ctx, { name: "Shopping", type: "expense" });
    const home = await createCategory(ctx, { name: "Home", type: "expense" });
    const first = await createRule(ctx, {
      name: "Shop",
      conditions: [{ field: "text", op: "contains", value: "shop" }],
      categoryId: shopping.id,
    });
    const second = await createRule(ctx, {
      name: "Big",
      conditions: [{ field: "amount", op: "gt", cents: 50_000 }],
      categoryId: home.id,
    });
    await upsertFromProvider(ctx, bank, [incoming("Online shop", 1, -60_000n)], { provider: BANK });
    await reorderRules(ctx, [second.id, first.id]);
    await categorise(ctx, [bank]);
    expect((await rows(ctx))[0].categoryId).toBe(home.id);
  });

  it("never writes on a person's choice or on a movement of a source that gives categories (QC4)", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const wallet = await synced(ctx, GIVES, "Budget app");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    const food = await createCategory(ctx, { name: "Food", type: "expense" });
    await upsertFromProvider(ctx, bank, [incoming("Top up kiosk", 1)], { provider: BANK });
    await upsertFromProvider(ctx, wallet, [incoming("Top up wallet", 2, -1_000n, "Others")], {
      provider: GIVES,
    });
    const [mine] = await rows(ctx);
    await setCategory(ctx, [mine.id], food.id);
    const before = await picture(ctx);

    const rule = await createRule(ctx, topUp(card.id));
    await categorise(ctx, [bank, wallet]);
    const preview = await previewRule(ctx, topUp(card.id), rule.id);
    expect(preview).toMatchObject({ matched: 2, kept: 2, changes: 0 });
    expect(await applyRule(ctx, rule.id)).toEqual({ count: 0, undoId: null });
    expect(await picture(ctx)).toBe(before);
  });
});

describe("Apply to existing transactions", () => {
  it("changes the automatic ones only, and Undo gives back the same picture", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    const food = await createCategory(ctx, { name: "Food", type: "expense" });
    const label = await createLabel(ctx, { name: "Card" });
    await upsertFromProvider(
      ctx,
      bank,
      [incoming("Top up one", 1), incoming("Top up two", 2), incoming("Top up three", 3)],
      { provider: BANK },
    );
    const [one, two, three] = await rows(ctx);
    // One automatic category, one chosen by the person, one with none.
    await getDb()
      .update(transactions)
      .set({ categoryId: food.id, categoryOrigin: "memory", categoryReason: "memory" })
      .where(eq(transactions.id, one.id));
    await setCategory(ctx, [two.id], food.id);
    await getDb().update(transactions).set({ note: "kept" }).where(eq(transactions.id, three.id));
    const before = await picture(ctx);

    const rule = await createRule(ctx, { ...topUp(card.id), labelIds: [label.id], note: "Rule note" });
    const preview = await previewRule(ctx, topUp(card.id), rule.id);
    expect(preview).toMatchObject({ matched: 3, kept: 1, changes: 2 });
    // A category no longer makes a giroconto: nothing changes section.
    expect(preview.retyped.count).toBe(0);

    const done = await applyRule(ctx, rule.id);
    expect(done.count).toBe(2);
    const after = await rows(ctx);
    expect(after.map((row) => [row.categoryOrigin, row.type])).toEqual([
      ["rule", "expense"],
      ["user", "expense"],
      ["rule", "expense"],
    ]);
    expect(after[0].note).toBe("Rule note");
    expect(after[2].note).toBe("kept");
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);

    expect(await undoRuleApply(ctx, done.undoId!)).toBe(2);
    expect(await picture(ctx)).toBe(before);
    await expect(undoRuleApply(ctx, done.undoId!)).rejects.toBeInstanceOf(TransactionError);
  });
});

describe("Undo of Apply", () => {
  it("leaves a choice the person made after Apply, and a note they wrote", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    const food = await createCategory(ctx, { name: "Food", type: "expense" });
    await upsertFromProvider(ctx, bank, [incoming("Top up one", 1), incoming("Top up two", 2)], {
      provider: BANK,
    });
    const rule = await createRule(ctx, { ...topUp(card.id), note: "Rule note" });
    const done = await applyRule(ctx, rule.id);
    const [one, two] = await rows(ctx);
    await setCategory(ctx, [one.id], food.id);
    await getDb().update(transactions).set({ note: "Mine" }).where(eq(transactions.id, two.id));

    expect(await undoRuleApply(ctx, done.undoId!)).toBe(1);
    const [first, second] = await rows(ctx);
    expect([first.categoryId, first.categoryOrigin, first.type]).toEqual([food.id, "user", "expense"]);
    expect([second.categoryId, second.categoryOrigin, second.note]).toEqual([null, null, "Mine"]);
  });
});

describe("the rules of a person", () => {
  it("are nobody else's", async () => {
    const owner = await newContext();
    const other = await newContext();
    const bank = await own(owner, "Zeta current");
    const card = await createCategory(owner, { name: "Prepaid card", type: "expense" });
    const rule = await createRule(owner, topUp(card.id));
    await upsertFromProvider(owner, bank, [incoming("Top up", 1)], { provider: BANK });
    const otherBank = await own(other, "Other current");
    await upsertFromProvider(other, otherBank, [incoming("Top up", 1)], { provider: BANK });

    await categorise(other, [otherBank]);
    expect((await rows(other))[0].categoryId).toBeNull();
    expect(await listRules(other)).toEqual([]);
    expect(await rulesForExport(other)).toEqual([]);
    // A rule on another person's category is refused; another person's rule is not found.
    await expect(createRule(other, topUp(card.id))).rejects.toBeInstanceOf(TransactionError);
    await expect(updateRule(other, rule.id, topUp(card.id))).rejects.toBeInstanceOf(TransactionError);
    await expect(applyRule(other, rule.id)).rejects.toBeInstanceOf(TransactionError);
    await expect(deleteRule(other, rule.id)).rejects.toBeInstanceOf(TransactionError);
    await expect(reorderRules(other, [rule.id])).rejects.toBeInstanceOf(TransactionError);
    await expect(previewRule(other, topUp(card.id))).rejects.toBeInstanceOf(TransactionError);
  });

  it("a deletion keeps the movements' category, says so, and Undo brings the rule back", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    const rule = await createRule(ctx, topUp(card.id));
    await upsertFromProvider(ctx, bank, [incoming("Top up", 1)], { provider: BANK });
    await categorise(ctx, [bank]);

    await deleteRule(ctx, rule.id);
    expect(await listRules(ctx)).toEqual([]);
    expect(await rulesForCategory(ctx, card.id)).toEqual([]);
    const [kept] = await rows(ctx);
    expect([kept.categoryId, kept.categoryReason]).toEqual([card.id, "rule_deleted"]);

    await restoreRule(ctx, rule.id);
    expect((await rows(ctx))[0].categoryReason).toBe("rule");
    expect((await listRules(ctx)).map((one) => one.name)).toEqual(["Top-up"]);
    await updateRule(ctx, rule.id, { ...topUp(card.id), name: "Card top-up" });
    expect((await rows(ctx))[0].categoryReasonParams).toEqual({ name: "Card top-up", ruleId: rule.id });
    expect(await rulesForExport(ctx)).toEqual([
      {
        position: 1,
        name: "Card top-up",
        active: true,
        conditions: topUp(card.id).conditions,
        category: "Prepaid card",
        labels: [],
        note: null,
      },
    ]);
  });

  it("stops at 200", async () => {
    const ctx = await newContext();
    const food = await createCategory(ctx, { name: "Food", type: "expense" });
    for (let at = 0; at < 200; at += 1) {
      await createRule(ctx, { ...topUp(food.id), name: `Rule ${at}` });
    }
    await expect(createRule(ctx, topUp(food.id))).rejects.toMatchObject({ code: "limit" });
  });

  it("a rule whose category is archived is off by itself", async () => {
    const ctx = await newContext();
    const bank = await own(ctx, "Zeta current");
    const card = await createCategory(ctx, { name: "Prepaid card", type: "expense" });
    await createRule(ctx, topUp(card.id));
    await getDb().update(categories).set({ archivedAt: new Date() }).where(eq(categories.id, card.id));
    await upsertFromProvider(ctx, bank, [incoming("Top up", 1)], { provider: BANK });
    await categorise(ctx, [bank]);
    expect((await rows(ctx))[0].categoryOrigin).not.toBe("rule");
    expect((await listRules(ctx))[0].categoryArchived).toBe(true);
  });
});
