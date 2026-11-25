// scripts/seed-e2e/categories.ts — the users and the data of the flow `categories` (tests/e2e/categories/).
import { createAccount } from "@domain/modules/accounts/service";
import { createDefaultGroups } from "@domain/modules/transactions/categorize/review";
import { createRule } from "@domain/modules/transactions/categorize/user-rules-service";
import { categorise } from "@domain/modules/transactions/categorize/service";
import { DEFAULT_GROUPS } from "@domain/modules/transactions/categorize/tables";
import { createManualTransaction } from "@domain/modules/transactions/manual";
import { categorisableAccountIds } from "@domain/modules/transactions/service";
import { createCategory } from "@domain/modules/transactions/taxonomy";
import { and, eq } from "drizzle-orm";
import { transactions } from "@domain/modules/transactions/schema";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import { addDays, today } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf } from "./common";

/**
 * Release N3, second part (ux/n3-categories-manual.md): movements in every state of a category, on
 * an account kept by hand — the cascade reads it as it reads a bank's, and the seed needs no bank.
 * The default groups let the static tables answer: a brand with one meaning is automatic, a brand
 * that sells everything is a suggestion, an invented shop has nothing. "Cafe" beside "Bar, cafe"
 * is a pair that looks like one category.
 */
export async function seedReview(email: string = USERS.review.email): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  await createDefaultGroups(
    ctx,
    DEFAULT_GROUPS.map((group) => group.key),
    "en",
  );
  await createCategory(ctx, { name: "Cafe", type: "expense" });
  const cash = await createAccount(ctx, {
    name: "Contanti",
    type: "cash",
    currency: "EUR",
    openingBalance: { on: addDays(on, -20), cents: 100_000n },
  });
  const movements: [string, number, bigint][] = [
    ["TRENITALIA SPA 1021", 9, 2_950n],
    ["AMZN Mktp IT 11", 8, 1_999n],
    ["AMZN Mktp IT 22", 6, 3_450n],
    ["AMZN Mktp IT 33", 4, 1_200n],
    ["Bottega Verdi 1", 7, 800n],
    ["Bottega Verdi 2", 5, 950n],
    ["Edicola Centrale", 3, 350n],
  ];
  for (const [payee, back, amountCents] of movements) {
    await createManualTransaction(ctx, {
      kind: "expense",
      amountCents,
      on: addDays(on, -back),
      accountId: cash.id,
      categoryId: null,
      payee,
      note: "",
    });
  }
  await categorise(ctx, await categorisableAccountIds(ctx));
}

/** A person with movements and no category at all: the guided review starts from the groups. */
export async function seedReviewNew(email: string = USERS.reviewNew.email): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  const cash = await createAccount(ctx, { name: "Contanti", type: "cash", currency: "EUR" });
  for (const [payee, back] of [
    ["TRENITALIA SPA 1021", 3],
    ["Bottega Verdi 1", 2],
    ["Bottega Verdi 2", 1],
  ] as const) {
    await createManualTransaction(ctx, {
      kind: "expense",
      amountCents: 1_000n,
      on: addDays(on, -back),
      accountId: cash.id,
      categoryId: null,
      payee,
      note: "",
    });
  }
  await categorise(ctx, await categorisableAccountIds(ctx));
}

/**
 * Release N3.4 (categories-and-rules.md §4): the user of `seedReview` and two rules, the second one
 * off. The rules come after the cascade's pass: no movement has a category from a rule yet, so
 * "Apply" has something to change.
 */
export async function seedRules(email: string): Promise<void> {
  await seedReview(email);
  const ctx = await contextOf(email);
  const newsstand = await createCategory(ctx, { name: "Newsstand", type: "expense" });
  const shop = await createCategory(ctx, { name: "Corner shop", type: "expense" });
  await createRule(ctx, {
    name: "Newsstand",
    conditions: [
      { field: "text", op: "contains", value: "edicola" },
      { field: "direction", value: "out" },
    ],
    categoryId: newsstand.id,
  });
  await createRule(ctx, {
    name: "Corner shop",
    active: false,
    conditions: [{ field: "counterparty", op: "contains", value: "bottega verdi" }],
    categoryId: shop.id,
  });
}

/**
 * The import of another app's history and the selector's top (decision 14A): the default groups, so
 * the import has categories to match, and on an account kept by hand one movement suggested as a
 * group — written as the cascade writes it, because a model sure of a group only is not something a
 * seed can train — and one with nothing. Synthetic payees only.
 */
export async function seedHistory(email: string = USERS.history.email): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  await createDefaultGroups(
    ctx,
    DEFAULT_GROUPS.map((group) => group.key),
    "en",
  );
  const cash = await createAccount(ctx, {
    name: "Contanti",
    type: "cash",
    currency: "EUR",
    openingBalance: { on: addDays(on, -10), cents: 50_000n },
  });
  const written = new Map<string, string>();
  for (const [payee, back] of [
    ["Locale Comune", 2],
    ["Negozio Nuovo", 3],
  ] as const) {
    const row = await createManualTransaction(ctx, {
      kind: "expense",
      amountCents: 1_500n,
      on: addDays(on, -back),
      accountId: cash.id,
      categoryId: null,
      payee,
      note: "",
    });
    written.set(payee, row.transaction.id);
  }
  const food = (await listCategories(ctx)).find(
    (one) => one.name === "Food & Drinks" && one.parentId === null,
  );
  if (!food) throw new Error("seedHistory: the default group Food & Drinks is missing");
  await getDb()
    .update(transactions)
    .set({ suggestedCategoryId: food.id, categoryReason: "group", categoryReasonParams: {} })
    .where(and(eq(transactions.id, written.get("Locale Comune") ?? ""), userScoped(ctx).owns(transactions)));
}
