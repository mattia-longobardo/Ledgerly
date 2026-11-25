import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { movementsOutOfLine, retypeMovements } from "./macro";
import { type IncomingTransaction, typeByMacro } from "./rules";
import { transactions } from "./schema";
import { chooseTransferSide, upsertFromProvider } from "./service";
import { createCategory } from "./taxonomy";

// What a movement counts as (categories-and-rules.md §3.2, as changed by the giroconti of 2026-11-25).

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

/** Every movement of the person, as the pure rule reads it. */
async function rows() {
  return getDb()
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: transactions.amountCents,
      origin: transactions.origin,
      transferGroupId: transactions.transferGroupId,
      transferOutside: transactions.transferOutside,
      suggestedCategoryId: transactions.suggestedCategoryId,
      locallyEdited: transactions.locallyEdited,
    })
    .from(transactions)
    .where(eq(transactions.userId, ctx.userId))
    .orderBy(transactions.id);
}

/** Movements an older image could leave: a giroconto of nobody's, one with a suggestion. */
async function outOfLine() {
  const groceries = await createCategory(ctx, { name: "Groceries", type: "expense" });
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
  const set = (id: string, values: Partial<typeof transactions.$inferInsert>) =>
    getDb().update(transactions).set(values).where(eq(transactions.id, id));
  // A transfer of no source and no decision: the sign decides.
  await set(one.id, { origin: "manual", type: "transfer" });
  await set(three.id, { origin: "manual", type: "transfer" });
  // A source's giroconto that still holds a suggestion: a giroconto has no category.
  await set(two.id, { type: "transfer", suggestedCategoryId: groceries.id });
  // A giroconto the person decided: it stays one.
  await set(four.id, { type: "transfer", locallyEdited: ["type"] });
  return { groceries };
}

describe("retypeMovements", () => {
  it("writes the rule on the movements that disagree with it, and only on those", async () => {
    await outOfLine();
    const before = await rows();
    expect(before.filter((row) => row.type !== typeByMacro(row))).toHaveLength(2);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(3);

    expect(await retypeMovements(getDb(), ctx)).toBe(3);

    const after = await rows();
    for (const row of before) {
      // The SQL is the pure rule.
      expect(after.find((one) => one.id === row.id)!.type).toBe(typeByMacro(row));
    }
    expect(after.filter((row) => row.type === "transfer")).toHaveLength(2);
    expect(after.every((row) => row.type !== "transfer" || row.suggestedCategoryId === null)).toBe(true);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);
    expect(await retypeMovements(getDb(), ctx)).toBe(0);
  });

  it("leaves another person's movements alone", async () => {
    await outOfLine();
    const other = contextFor((await createTestUser()).id);
    expect(await retypeMovements(getDb(), other)).toBe(0);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(3);
  });
});

describe("a giroconto chosen by the person", () => {
  it("is not written back by the next reading of the bank, and «none» gives the sign back", async () => {
    await upsertFromProvider(ctx, accountId, [bankMovement("b-1", -30_000n)], { provider: BANK });
    const [row] = await rows();

    await chooseTransferSide(ctx, row.id, { kind: "outside" });
    expect((await rows())[0]).toMatchObject({
      type: "transfer",
      transferOutside: true,
      locallyEdited: ["type"],
    });

    await upsertFromProvider(ctx, accountId, [{ ...bankMovement("b-1", -30_000n), payee: "Renamed" }], {
      provider: BANK,
    });
    expect((await rows())[0].type).toBe("transfer");

    await chooseTransferSide(ctx, row.id, { kind: "none" });
    expect((await rows())[0]).toMatchObject({ type: "expense", transferOutside: false });
  });
});
