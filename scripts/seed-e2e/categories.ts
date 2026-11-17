// scripts/seed-e2e/categories.ts — the users and the data of the flow `categories` (tests/e2e/categories/).
import { createAccount } from "../../src/modules/accounts/service";
import { createDefaultGroups } from "../../src/modules/transactions/categorize/review";
import { categorise } from "../../src/modules/transactions/categorize/service";
import { DEFAULT_GROUPS } from "../../src/modules/transactions/categorize/tables";
import { createManualTransaction } from "../../src/modules/transactions/manual";
import { categorisableAccountIds } from "../../src/modules/transactions/service";
import { createCategory } from "../../src/modules/transactions/taxonomy";
import { addDays, today } from "../../src/platform/dates";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf } from "./common";

/**
 * Release N3, second part (ux/n3-categories-manual.md): movements in every state of a category, on
 * an account kept by hand — the cascade reads it as it reads a bank's, and the seed needs no bank.
 * The default groups let the static tables answer: a brand with one meaning is automatic, a brand
 * that sells everything is a suggestion, an invented shop has nothing. "Bars" beside "Restaurants
 * and bars" is a pair that looks like one category.
 */
export async function seedReview(email: string = USERS.review.email): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  await createDefaultGroups(
    ctx,
    DEFAULT_GROUPS.map((group) => group.key),
    "en",
  );
  await createCategory(ctx, { name: "Bars", type: "expense" });
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
