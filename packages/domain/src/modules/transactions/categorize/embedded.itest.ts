import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyProviderAccounts } from "../../accounts/service";
import { listAccounts } from "../../accounts/queries";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { createTestUser } from "../../../../../../test/users";
import { getTransaction, listTransactions } from "../queries";
import type { IncomingTransaction } from "../rules";
import type { Embedder } from "../rules/embedding";
import { loadModel, predict, type StoredModel } from "./classifier";
import { categoryModels } from "../schema";
import { setCategory, upsertFromProvider } from "../service";
import { categorise, measureCategories, setEmbedder, suggestFor } from "./service";

// The embedding level of the automatic categories on the test database (rewrite plan R6): where
// it is stored, that a correction counts at the next reading, that it is off without a model, and
// that the measure reads only. The texts are invented; the model is a stand-in (the real one is
// tested in the worker): each word lights one position, so texts that share words are close.

const fake: Embedder = {
  revision: "fake:itest",
  dimensions: 32,
  embed(text: string) {
    const vector = new Float32Array(32);
    for (const word of text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)) {
      vector[[...word].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 9973, 7) % 32] += 1;
    }
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
  },
};

const ctxOf = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

const GIVES = "plugin:wallet";
const BANK = "plugin:testbank";

async function synced(ctx: Ctx, provider: string, name: string): Promise<string> {
  await applyProviderAccounts(ctx, provider, [
    { provider, providerAccountId: `${name}-1`, name, type: "checking", currency: "EUR" },
  ]);
  return (await listAccounts(ctx)).find((one) => one.name === name)!.id;
}

let serial = 0;
function incoming(payee: string, day: number, category: string | null = null): IncomingTransaction {
  serial += 1;
  return {
    externalId: `ext-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 8, 1 + (day % 28), 11, serial % 60)),
    amountCents: -1_500n,
    currency: "EUR",
    type: "expense",
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

/** A person whose source labelled two shops thirty times each, and a bank with nothing labelled. */
async function labelled() {
  const ctx = ctxOf((await createTestUser()).id);
  const source = await synced(ctx, GIVES, "Budget app");
  const rows = [
    ...Array.from({ length: 30 }, (_, day) => incoming(`Pizzeria Alfa ${day}`, day, "Restaurants")),
    ...Array.from({ length: 30 }, (_, day) => incoming(`Mercato Beta ${day}`, day, "Groceries")),
    ...Array.from({ length: 3 }, (_, day) => incoming(`Cinema Gamma ${day}`, day, "Leisure")),
  ];
  await upsertFromProvider(ctx, source, rows, { provider: GIVES });
  const bank = await synced(ctx, BANK, "Zeta current");
  return { ctx, source, bank };
}

const stored = async (ctx: Ctx) =>
  (await getDb().select().from(categoryModels).where(eq(categoryModels.userId, ctx.userId)))[0];

async function categoryOf(ctx: Ctx, payee: string) {
  const [row] = (await listTransactions(ctx, { includeHidden: true })).filter((one) => one.payee === payee);
  const full = (await getTransaction(ctx, row.id))!;
  return full.categoryId ?? full.suggestedCategoryId;
}

beforeEach(async () => {
  await resetDatabase();
  setEmbedder(fake);
});
afterEach(() => setEmbedder(null));
afterAll(closeDatabase);

describe("the embedding level (R6)", () => {
  it("trains the classifier with the embeddings in the worker, beside today's model in the same row", async () => {
    const { ctx, bank } = await labelled();
    const outcome = await categorise(ctx, [bank]);
    expect(outcome.trained).toBe(true);
    const row = await stored(ctx);
    expect(row.model).toMatchObject({ embedded: { revision: "fake:itest", examples: 63 } });
    // The same labels, the same model: nothing is trained or written again.
    expect((await categorise(ctx, [bank])).trained).toBe(false);
    expect((await stored(ctx)).version).toBe(row.version);
  });

  it("answers a correction of the person at the next reading", async () => {
    const { ctx, source, bank } = await labelled();
    const text = {
      ...incoming("Pizzeria Alfa Centro", 1),
      accountId: bank,
      counterparty: null,
      rawText: null,
    };
    const answer = async () => {
      const row = (await stored(ctx)).model as { embedded: { model: StoredModel } };
      return predict(loadModel(row.embedded.model)!, text, fake).categoryId;
    };
    await categorise(ctx, [bank]);
    expect(await answer()).toBe(await categoryOf(ctx, "Pizzeria Alfa 0"));

    const leisure = await categoryOf(ctx, "Cinema Gamma 0");
    const pizzerias = (await listTransactions(ctx, { includeHidden: true })).filter(
      (one) => one.accountId === source && one.payee?.startsWith("Pizzeria Alfa"),
    );
    await setCategory(
      ctx,
      pizzerias.map((one) => one.id),
      leisure,
    );
    expect((await categorise(ctx, [bank])).trained).toBe(true);
    expect(await answer()).toBe(leisure);
  });

  it("is off without a model: today's cascade, and a stored part from the worker is left alone", async () => {
    const { ctx, bank } = await labelled();
    await categorise(ctx, [bank]);
    const before = await stored(ctx);
    setEmbedder(null);
    await upsertFromProvider(ctx, bank, [incoming("Mercato Beta Nord", 3)], { provider: BANK });
    expect((await categorise(ctx, [bank])).trained).toBe(false);
    expect((await stored(ctx)).model).toEqual(before.model);
    expect(
      await suggestFor(ctx, {
        ...incoming("Mercato Beta 99", 4),
        accountId: bank,
        rawText: null,
        counterparty: null,
        kind: "expense",
        merchantCategoryCode: null,
        bankTransactionCode: null,
      }),
    ).not.toBeNull();
  });

  it("measures before and after on the person's labels, writing nothing", async () => {
    const { ctx, bank } = await labelled();
    await upsertFromProvider(ctx, bank, [incoming("Pizzeria Alfa Lago", 5)], { provider: BANK });
    const before = await stored(ctx);
    const measure = await measureCategories(ctx, fake, [bank]);
    expect(measure.labels).toBe(63);
    expect(measure.grouped.today.graded).toBe(63);
    expect(measure.grouped.withModel.graded).toBe(63);
    expect(measure.open.movements).toBe(1);
    expect(measure.chronological.today.all.graded).toBe(measure.chronological.withModel.all.graded);
    expect(await stored(ctx)).toEqual(before);
    expect(JSON.stringify(measure)).not.toMatch(/Pizzeria|Mercato|Cinema/);
  });
});
