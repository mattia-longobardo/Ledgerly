import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyProviderAccounts, createAccount } from "@/modules/accounts/service";
import { listAccounts } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { eq } from "drizzle-orm";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import { categoryTotals, getTransaction, listTransactions } from "../queries";
import type { IncomingTransaction } from "../rules";
import { categoryMemory, categoryModels, transactions } from "../schema";
import { categorisableAccountIds, setCategory, upsertFromProvider } from "../service";
import { createCategory } from "../taxonomy";
import { changeCategories, createDefaultGroups, reviewOf, similarTo, undoChange } from "./review";
import { categorise, isPreparing, suggestFor } from "./service";

// The automatic categories on the test database (rewrite plan N3, "Test e gate"): which movements
// the cascade reads, what it may write, what it learns from, and that one person's labels are
// nobody else's. The texts are invented.

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

/** A source that gives a category with each movement, and one that only reads. */
const GIVES = "wallet";
const BANK = "plugin:testbank";

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
  category: string | null = null,
  cents = -1_000n,
): IncomingTransaction {
  serial += 1;
  return {
    externalId: `ext-${serial}`,
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

async function byPayee(ctx: Ctx, payee: string) {
  const rows = (await listTransactions(ctx, { includeHidden: true })).filter((row) => row.payee === payee);
  return Promise.all(rows.map(async (row) => (await getTransaction(ctx, row.id))!));
}

/** A person whose source labelled "Mercato Alfa" three times: the memory holds it. */
async function withMemory(ctx: Ctx) {
  const labelled = await synced(ctx, GIVES, "Budget app");
  await upsertFromProvider(
    ctx,
    labelled,
    [1, 2, 3].map((day) => incoming("Mercato Alfa", day, "Groceries")),
    { provider: GIVES },
  );
  const bank = await synced(ctx, BANK, "Zeta current");
  return { labelled, bank };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the accounts the cascade reads", () => {
  it("are the ones kept by hand, never the ones of a source that gives its own categories", async () => {
    const ctx = await newContext();
    const { labelled, bank } = await withMemory(ctx);
    const cash = await createAccount(ctx, { name: "Cash", type: "cash" });
    const ids = await categorisableAccountIds(ctx);
    expect(ids).toContain(cash.id);
    expect(ids).not.toContain(labelled);
    // A plugin whose manifest the core never read says nothing about its categories: its account
    // is left alone. With the manifest read, a bank's account is read (`banks/sink.itest.ts`).
    expect(ids).not.toContain(bank);
  });
});

describe("categorise", () => {
  it("gives by itself the category a text had the last three times, with its reason", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    await upsertFromProvider(ctx, bank, [incoming("MERCATO ALFA 0042", 10), incoming("Xyz Qwerty", 11)], {
      provider: BANK,
    });

    const outcome = await categorise(ctx, [bank]);

    expect(outcome).toMatchObject({ automatic: 1, suggested: 0, open: 1 });
    const [given] = await byPayee(ctx, "MERCATO ALFA 0042");
    expect(given).toMatchObject({
      categoryOrigin: "memory",
      categoryReason: "memory",
      categoryReasonParams: { text: "MERCATO ALFA 0042" },
      categoryKey: "mercato alfa",
      suggestedCategoryId: null,
      locallyEdited: [],
    });
    expect(given.categoryId).not.toBeNull();
    const [open] = await byPayee(ctx, "Xyz Qwerty");
    expect(open).toMatchObject({ categoryId: null, categoryOrigin: null, categoryKey: "xyz qwerty" });
    expect(await isPreparing(ctx)).toBe(false);
  });

  it("never reads a movement of a source that gives its own categories (criterion 1 of N3)", async () => {
    const ctx = await newContext();
    const { labelled, bank } = await withMemory(ctx);
    // The source sends one with no category: it stays as the source left it.
    await upsertFromProvider(ctx, labelled, [incoming("Mercato Alfa", 9, null)], { provider: GIVES });
    const before = await byPayee(ctx, "Mercato Alfa");

    // The list of the accounts is what keeps the cascade away from them: the rule's own list, with
    // the bank's account beside it.
    await categorise(ctx, [...(await categorisableAccountIds(ctx)), bank]);

    const after = await byPayee(ctx, "Mercato Alfa");
    expect(after.map((row) => [row.id, row.categoryId, row.categoryOrigin, row.categoryKey])).toEqual(
      before.map((row) => [row.id, row.categoryId, row.categoryOrigin, null]),
    );
    expect(
      after.filter((row) => row.categoryId !== null).every((row) => row.categoryOrigin === "provider"),
    ).toBe(true);
    expect(after.find((row) => row.categoryId === null)).toMatchObject({ suggestedCategoryId: null });
  });

  it("counts an automatic category in its category and a movement with none in none (criterion 2)", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    await upsertFromProvider(
      ctx,
      bank,
      [incoming("Mercato Alfa", 10, null, -2_500n), incoming("Xyz", 11, null, -700n)],
      {
        provider: BANK,
      },
    );
    await categorise(ctx, [bank]);

    const totals = await categoryTotals(ctx, { accountIds: [bank] });
    expect(totals.find((slice) => slice.name === "Groceries")?.totalCents).toBe(-2_500n);
    expect(totals.find((slice) => slice.categoryId === null)?.totalCents).toBe(-700n);
  });

  it("never learns from its own answers: only confirmed labels are examples", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    await upsertFromProvider(
      ctx,
      bank,
      [10, 11, 12, 13].map((day) => incoming("Mercato Alfa", day)),
      { provider: BANK },
    );

    const first = await categorise(ctx, [bank]);
    const second = await categorise(ctx, [bank]);

    expect(first).toMatchObject({ examples: 3, automatic: 4 });
    // Four more movements have the category now, and none of them is a label.
    expect(second).toMatchObject({ examples: 3, trained: false, automatic: 0 });
    const [model] = await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId));
    expect(model.examples).toBe(3);
    expect(model.version).toBe(1);
  });

  it("learns from a category a person confirms, at the next pass", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    await upsertFromProvider(ctx, bank, [incoming("Mercato Alfa", 10)], { provider: BANK });
    await categorise(ctx, [bank]);
    const [given] = await byPayee(ctx, "Mercato Alfa").then((rows) =>
      rows.filter((row) => row.accountId === bank),
    );

    await changeCategories(ctx, [given.id], { kind: "confirm" });
    const next = await categorise(ctx, [bank]);

    expect((await getTransaction(ctx, given.id))?.categoryOrigin).toBe("user");
    expect(next).toMatchObject({ examples: 4, trained: true });
  });

  it("never writes over a person's choice, the choice of no category included", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    const other = await createCategory(ctx, { name: "Other" });
    await upsertFromProvider(ctx, bank, [incoming("Mercato Alfa", 10), incoming("Mercato Alfa", 11)], {
      provider: BANK,
    });
    const [first, second] = (await byPayee(ctx, "Mercato Alfa")).filter((row) => row.accountId === bank);
    // The cascade gives both a category; the person replaces one and takes the other off.
    await categorise(ctx, [bank]);
    expect((await getTransaction(ctx, second.id))?.categoryOrigin).toBe("memory");
    await setCategory(ctx, [first.id], other.id);
    await setCategory(ctx, [second.id], null);

    await categorise(ctx, [bank]);

    expect(await getTransaction(ctx, first.id)).toMatchObject({
      categoryId: other.id,
      categoryOrigin: "user",
    });
    expect(await getTransaction(ctx, second.id)).toMatchObject({
      categoryId: null,
      categoryOrigin: "user",
      categoryReason: "corrected",
      suggestedCategoryId: null,
    });
  });

  it("keeps one person's labels, memory and model away from another (isolation)", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const { bank: myBank } = await withMemory(mine);
    const theirBank = await synced(theirs, BANK, "Zeta current");
    await upsertFromProvider(theirs, theirBank, [incoming("Mercato Alfa", 10)], { provider: BANK });

    await categorise(mine, [myBank]);
    const outcome = await categorise(theirs, [theirBank]);

    // The other person labelled nothing: what I taught my memory gives them nothing.
    expect(outcome).toMatchObject({ examples: 0, automatic: 0, open: 1 });
    expect((await byPayee(theirs, "Mercato Alfa"))[0].categoryId).toBeNull();
    const memory = await getDb().select().from(categoryMemory);
    expect(new Set(memory.map((row) => row.userId))).toEqual(new Set([mine.userId]));
    // My pass, asked for their account, reads nothing of theirs.
    await categorise(mine, [theirBank]);
    expect((await byPayee(theirs, "Mercato Alfa"))[0]).toMatchObject({
      categoryId: null,
      categoryOrigin: null,
    });
  });

  it("suggests for a movement not written yet from what is known, and writes nothing", async () => {
    const ctx = await newContext();
    const { bank } = await withMemory(ctx);
    await categorise(ctx, [bank]);
    const answer = await suggestFor(ctx, {
      payee: "Mercato Alfa 77",
      counterparty: null,
      rawText: null,
      note: null,
      accountId: bank,
      amountCents: -1_250n,
      kind: "expense",
      merchantCategoryCode: null,
      bankTransactionCode: null,
    });
    expect(answer).toMatchObject({ reason: "memory" });
    expect(
      await suggestFor(ctx, {
        payee: "Nobody Knows",
        counterparty: null,
        rawText: null,
        note: null,
        accountId: bank,
        amountCents: -1n,
        kind: "expense",
        merchantCategoryCode: null,
        bankTransactionCode: null,
      }),
    ).toBeNull();
  });
});

describe("the default groups and the tables", () => {
  it("are created once, for a person with no category, in their language", async () => {
    const ctx = await newContext();
    expect(await createDefaultGroups(ctx, ["groceries", "transport", "income"], "it")).toBe(3);
    await expect(createDefaultGroups(ctx, ["home"], "it")).rejects.toMatchObject({ code: "invalid" });
    await expect(createDefaultGroups(await newContext(), ["nothing"], "en")).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("let a table give a category to a person who never labelled anything", async () => {
    const ctx = await newContext();
    await createDefaultGroups(ctx, ["groceries", "transport", "shopping"], "en");
    const bank = await synced(ctx, BANK, "Zeta current");
    await upsertFromProvider(ctx, bank, [incoming("TRENITALIA SPA 5521", 10), incoming("AMZN Mktp IT", 11)], {
      provider: BANK,
    });

    const outcome = await categorise(ctx, [bank]);

    expect(outcome).toMatchObject({ automatic: 1, suggested: 1, open: 0 });
    expect((await byPayee(ctx, "TRENITALIA SPA 5521"))[0]).toMatchObject({
      categoryOrigin: "table",
      categoryReason: "brand",
      categoryReasonParams: { brand: "Trenitalia" },
    });
    const [amazon] = await byPayee(ctx, "AMZN Mktp IT");
    expect(amazon.categoryId).toBeNull();
    expect(amazon.suggestedCategoryId).not.toBeNull();
    // A suggestion waits in "To review" and counts in no category.
    const review = await reviewOf(ctx);
    expect(review.singles.map((row) => row.id)).toEqual([amazon.id]);
    expect((await categoryTotals(ctx, {})).find((slice) => slice.categoryId === null)?.totalCents).toBe(
      -1_000n,
    );
  });
});

describe("the actions on several movements", () => {
  async function waiting(ctx: Ctx) {
    await createDefaultGroups(ctx, ["groceries", "shopping", "other"], "en");
    const bank = await synced(ctx, BANK, "Zeta current");
    await upsertFromProvider(
      ctx,
      bank,
      [incoming("AMZN Mktp IT", 10), incoming("AMZN Mktp IT 22", 11), incoming("Xyz Qwerty", 12)],
      { provider: BANK },
    );
    await categorise(ctx, [bank]);
    return bank;
  }

  it("confirms the suggestions of a group, all or none, and undoes them as they were", async () => {
    const ctx = await newContext();
    await waiting(ctx);
    const review = await reviewOf(ctx);
    expect(review.suggested).toHaveLength(1);
    const ids = review.suggested[0].rows.map((row) => row.id);

    const done = await changeCategories(ctx, ids, { kind: "confirm" });
    expect(done.count).toBe(2);
    for (const id of ids) {
      expect(await getTransaction(ctx, id)).toMatchObject({
        categoryOrigin: "user",
        suggestedCategoryId: null,
      });
      expect((await getTransaction(ctx, id))?.categoryId).toBe(review.suggested[0].suggestedCategoryId);
    }
    expect((await reviewOf(ctx)).suggested).toEqual([]);

    expect(await undoChange(ctx, done.undoId!)).toBe(2);
    expect((await reviewOf(ctx)).suggested[0].count).toBe(2);
    for (const id of ids)
      expect(await getTransaction(ctx, id)).toMatchObject({ categoryId: null, categoryOrigin: null });
    // Once only.
    await expect(undoChange(ctx, done.undoId!)).rejects.toMatchObject({ code: "not_found" });
  });

  it("sets a category on a group and leaves alone what a person or a source already chose", async () => {
    const ctx = await newContext();
    await waiting(ctx);
    const other = (await listTransactions(ctx)).find((row) => row.payee === "Xyz Qwerty")!;
    const chosen = await createCategory(ctx, { name: "Chosen" });
    await setCategory(ctx, [other.id], chosen.id);
    const target = await createCategory(ctx, { name: "Target" });
    const all = (await listTransactions(ctx)).map((row) => row.id);

    const done = await changeCategories(ctx, all, { kind: "set", categoryId: target.id });

    expect(done.count).toBe(2);
    expect((await getTransaction(ctx, other.id))?.categoryId).toBe(chosen.id);
  });

  it("refuses another person's category and changes nothing of another person's movements", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    await waiting(theirs);
    const theirIds = (await listTransactions(theirs)).map((row) => row.id);
    const theirCategory = await createCategory(theirs, { name: "Theirs" });
    const myCategory = await createCategory(mine, { name: "Mine" });

    await expect(
      changeCategories(mine, theirIds, { kind: "set", categoryId: theirCategory.id }),
    ).rejects.toMatchObject({
      code: "invalid_reference",
    });
    expect((await changeCategories(mine, theirIds, { kind: "set", categoryId: myCategory.id })).count).toBe(
      0,
    );
    for (const id of theirIds) expect((await getTransaction(theirs, id))?.categoryOrigin).not.toBe("user");
  });

  it("finds the similar movements Ledgerly may touch, never a chosen one", async () => {
    const ctx = await newContext();
    const bank = await waiting(ctx);
    await upsertFromProvider(ctx, bank, [incoming("AMZN Mktp IT 9", 13)], { provider: BANK });
    await categorise(ctx, [bank]);
    const rows = (await listTransactions(ctx)).filter((row) => row.payee?.startsWith("AMZN"));
    const target = await createCategory(ctx, { name: "Target" });
    await setCategory(ctx, [rows[0].id], target.id);
    const kept = await createCategory(ctx, { name: "Kept" });
    await setCategory(ctx, [rows[1].id], kept.id);

    const similar = await similarTo(ctx, rows[0].id, target.id);

    expect(similar.rows.map((row) => row.id)).toEqual([rows[2].id]);
    expect(similar.text).toBe(rows[0].payee);
  });

  it("stores no confidence and no model where a list of movements can read it", async () => {
    const ctx = await newContext();
    await waiting(ctx);
    const [row] = await listTransactions(ctx);
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining(["categoryConfidence", "categoryModelVersion"]),
    );
    const [stored] = await getDb().select().from(transactions).where(eq(transactions.id, row.id));
    expect(stored.categoryConfidence).toBeNull();
  });
});
