import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { movementsOutOfLine, retypeMovements } from "./macro";
import { type IncomingTransaction, typeByMacro, typeMarkerByMacro } from "./rules";
import { categories, transactions } from "./schema";
import { setCategory, upsertFromProvider } from "./service";
import { createCategory } from "./taxonomy";

// N3.3 (categories-and-rules.md §3.2, §3.4): the macro of the category decides how a movement counts.

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

const BANK = "plugin:enablebanking";

function bankMovement(externalId: string, amountCents: bigint): IncomingTransaction {
  return {
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T09:00:00Z"),
    amountCents,
    currency: "EUR",
    type: amountCents < 0n ? "expense" : "income",
    state: "cleared",
    payee: `Payee ${externalId}`,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

let ctx: Ctx;
let accountId: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  const account = await createAccount(ctx, {
    name: "Current account",
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    iban: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  accountId = account.id;
});
afterAll(closeDatabase);

/** Every movement of the person with its category's type, as the pure rule reads it. */
async function rows() {
  return getDb()
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: transactions.amountCents,
      origin: transactions.origin,
      transferGroupId: transactions.transferGroupId,
      categoryType: categories.type,
      locallyEdited: transactions.locallyEdited,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.userId, ctx.userId))
    .orderBy(transactions.id);
}

/** Movements as an image before N3.3 left them: a category written without the type. */
async function outOfLine() {
  const groceries = await createCategory(ctx, { name: "Groceries", type: "expense" });
  const savings = await createCategory(ctx, { name: "Savings", type: "transfer" });
  await upsertFromProvider(
    ctx,
    accountId,
    [
      bankMovement("b-1", -2_000n),
      bankMovement("b-2", -30_000n),
      bankMovement("b-3", 5_000n),
      bankMovement("b-4", 700n),
    ],
    { provider: BANK },
  );
  const [one, two, three, four] = await rows();
  const file = (id: string, categoryId: string) =>
    getDb().update(transactions).set({ categoryId }).where(eq(transactions.id, id));
  await file(two.id, savings.id);
  await file(three.id, savings.id);
  await file(one.id, groceries.id);
  // A transfer this rule wrote, whose category went back to Expenses.
  await getDb()
    .update(transactions)
    .set({ type: "transfer", locallyEdited: ["type"], categoryId: groceries.id })
    .where(eq(transactions.id, four.id));
  return { groceries, savings };
}

describe("retypeMovements", () => {
  it("writes the rule on the movements that disagree with it, and only on those", async () => {
    await outOfLine();
    const before = await rows();
    const disagreeing = before.filter(
      (row) =>
        row.type !== typeByMacro(row) ||
        JSON.stringify(row.locallyEdited) !== JSON.stringify(typeMarkerByMacro(row)),
    );
    expect(disagreeing).toHaveLength(3);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(3);

    expect(await retypeMovements(getDb(), ctx)).toBe(3);

    const after = await rows();
    for (const row of before) {
      const now = after.find((one) => one.id === row.id)!;
      // The SQL is the pure rule.
      expect(now.type).toBe(typeByMacro(row));
      expect(now.locallyEdited).toEqual(typeMarkerByMacro(row));
    }
    expect(after.filter((row) => row.type === "transfer")).toHaveLength(2);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);
    expect(await retypeMovements(getDb(), ctx)).toBe(0);
  });

  it("is what the migration of N3.3 runs, for every person", async () => {
    await outOfLine();
    const other = contextFor((await createTestUser()).id);
    const statement = readFileSync("drizzle/0060_macro_type.sql", "utf8");
    await getDb().execute(sql.raw(statement));
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);
    expect(await movementsOutOfLine(getDb(), other)).toBe(0);
  });

  it("leaves another person's movements alone", async () => {
    await outOfLine();
    const other = contextFor((await createTestUser()).id);
    expect(await retypeMovements(getDb(), other)).toBe(0);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(3);
  });
});

describe("a category of Transfers chosen by the person", () => {
  it("makes a transfer that the next reading of the bank does not write back", async () => {
    const savings = await createCategory(ctx, { name: "Savings", type: "transfer" });
    await upsertFromProvider(ctx, accountId, [bankMovement("b-1", -30_000n)], { provider: BANK });
    const [row] = await rows();

    await setCategory(ctx, [row.id], savings.id);
    expect((await rows())[0]).toMatchObject({ type: "transfer", locallyEdited: ["categoryId", "type"] });

    await upsertFromProvider(ctx, accountId, [{ ...bankMovement("b-1", -30_000n), payee: "Renamed" }], {
      provider: BANK,
    });
    expect((await rows())[0].type).toBe("transfer");

    // Back to no category: the sign decides again, and the marker goes.
    await setCategory(ctx, [row.id], null);
    expect((await rows())[0]).toMatchObject({ type: "expense", locallyEdited: ["categoryId"] });
  });
});
