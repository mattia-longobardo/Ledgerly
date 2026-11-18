import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { addDays, today } from "../../platform/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { createManualTransaction, deleteManualTransaction, updateManualTransaction } from "./manual";
import { getTransaction, listTransactions, manualMovementsByAccount, transactionsInWindow } from "./queries";
import type { IncomingTransaction } from "./rules";
import { TransactionError, upsertFromProvider } from "./service";
import { createCategory } from "./taxonomy";

// The movement a person writes by hand, on the test database: the row it becomes, the double send,
// what belongs to somebody else, and what a provider's reading may do to it (nothing).

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

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const KEY = "018f4e9a-1111-7000-8000-00000000000a";
const TODAY = today("Europe/Rome");

async function cash(ctx: Ctx, name = "Cash") {
  return createAccount(ctx, { name, type: "cash" });
}

function movement(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "expense",
    amountCents: 450n,
    on: TODAY,
    accountId,
    categoryId: null,
    payee: "Corner bar",
    note: "",
    ...overrides,
  };
}

function incoming(externalId: string, on: string): IncomingTransaction {
  return {
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date(`${on}T11:00:00Z`),
    amountCents: -1_000n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Shop",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("createManualTransaction", () => {
  it("writes a row that is the person's: manual, signed by its kind, on its own day", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);

    const { transaction, created } = await createManualTransaction(ctx, movement(account.id));

    expect(created).toBe(true);
    expect(transaction).toMatchObject({
      accountId: account.id,
      origin: "manual",
      type: "expense",
      amountCents: -450n,
      currency: "EUR",
      payee: "Corner bar",
      note: null,
      locallyEdited: [],
    });
    const [row] = await listTransactions(ctx);
    expect(row.on).toBe(TODAY);
    expect(row.origin).toBe("manual");
  });

  it("writes one row for the same key sent twice, and answers with it (criterion 5 of N3)", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);

    const first = await createManualTransaction(ctx, movement(account.id), KEY);
    const second = await createManualTransaction(ctx, movement(account.id, { amountCents: 999n }), KEY);

    expect(second.created).toBe(false);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.transaction.amountCents).toBe(-450n);
    expect(await listTransactions(ctx)).toHaveLength(1);
  });

  it("writes one row for two requests with one key that arrive together", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);

    const answers = await Promise.all([
      createManualTransaction(ctx, movement(account.id), KEY),
      createManualTransaction(ctx, movement(account.id), KEY),
    ]);

    expect(new Set(answers.map((answer) => answer.transaction.id)).size).toBe(1);
    expect(answers.filter((answer) => answer.created)).toHaveLength(1);
    expect(await listTransactions(ctx)).toHaveLength(1);
  });

  it("keeps the same key apart for two people", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const first = await createManualTransaction(mine, movement((await cash(mine)).id), KEY);
    const second = await createManualTransaction(theirs, movement((await cash(theirs)).id), KEY);

    expect(second.created).toBe(true);
    expect(second.transaction.id).not.toBe(first.transaction.id);
  });

  it("writes two rows without a key: nothing says they are one", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    await createManualTransaction(ctx, movement(account.id));
    await createManualTransaction(ctx, movement(account.id));
    expect(await listTransactions(ctx)).toHaveLength(2);
  });

  it("refuses a day after today", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    await expect(
      createManualTransaction(ctx, movement(account.id, { on: addDays(TODAY, 1) })),
    ).rejects.toMatchObject({ code: "future_date" });
  });

  it("refuses another person's account and another person's category", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const account = await cash(mine);
    const theirAccount = await cash(theirs);
    const theirCategory = await createCategory(theirs, { name: "Bars" });

    await expect(createManualTransaction(mine, movement(theirAccount.id))).rejects.toMatchObject({
      code: "account_unavailable",
    });
    await expect(
      createManualTransaction(mine, movement(account.id, { categoryId: theirCategory.id })),
    ).rejects.toMatchObject({ code: "invalid_reference" });
    expect(await listTransactions(mine)).toHaveLength(0);
    expect(await listTransactions(theirs)).toHaveLength(0);
  });
});

describe("updateManualTransaction and deleteManualTransaction", () => {
  it("changes every field of a manual movement and marks nothing as edited", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    const other = await cash(ctx, "Drawer");
    const { transaction } = await createManualTransaction(ctx, movement(account.id));

    const changed = await updateManualTransaction(
      ctx,
      transaction.id,
      movement(other.id, { kind: "income", amountCents: 2_000n, payee: "", note: "Refund" }),
    );

    expect(changed.previousAccountId).toBe(account.id);
    expect(changed.transaction).toMatchObject({
      accountId: other.id,
      type: "income",
      amountCents: 2_000n,
      payee: null,
      note: "Refund",
      origin: "manual",
      locallyEdited: [],
    });
  });

  it("deletes a manual movement for good", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    const { transaction } = await createManualTransaction(ctx, movement(account.id));

    expect(await deleteManualTransaction(ctx, transaction.id)).toEqual({ accountId: account.id });
    expect(await getTransaction(ctx, transaction.id)).toBeNull();
  });

  it("refuses a provider's movement, and another person's manual movement", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const account = await cash(mine);
    await upsertFromProvider(mine, account.id, [incoming("ext-1", TODAY)], { provider: "plugin:bank" });
    const [fromProvider] = await listTransactions(mine);
    const theirOwn = await createManualTransaction(theirs, movement((await cash(theirs)).id));

    await expect(updateManualTransaction(mine, fromProvider.id, movement(account.id))).rejects.toMatchObject({
      code: "not_manual",
    });
    await expect(deleteManualTransaction(mine, fromProvider.id)).rejects.toMatchObject({
      code: "not_manual",
    });
    await expect(deleteManualTransaction(mine, theirOwn.transaction.id)).rejects.toBeInstanceOf(
      TransactionError,
    );
    expect(await getTransaction(theirs, theirOwn.transaction.id)).not.toBeNull();
  });
});

describe("a provider's reading and a manual movement", () => {
  it("never declares a manual movement gone, whatever the window it re-reads", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    const { transaction } = await createManualTransaction(ctx, movement(account.id));
    const window = { from: addDays(TODAY, -3), to: TODAY };

    // The bank answers about the same days and does not know the manual movement.
    const outcome = await upsertFromProvider(ctx, account.id, [incoming("ext-1", TODAY)], {
      provider: "plugin:bank",
      window,
    });

    expect(outcome).toMatchObject({ created: 1, removed: 0 });
    expect((await getTransaction(ctx, transaction.id))?.removedUpstreamAt).toBeNull();
    expect((await transactionsInWindow(ctx, account.id, window)).map((row) => row.id)).not.toContain(
      transaction.id,
    );
  });

  it("gives the balance rule the manual movements only, without the hidden ones", async () => {
    const ctx = await newContext();
    const account = await cash(ctx);
    await upsertFromProvider(ctx, account.id, [incoming("ext-1", TODAY)], { provider: "plugin:bank" });
    const { transaction } = await createManualTransaction(ctx, movement(account.id));

    const manual = await manualMovementsByAccount(ctx, [account.id]);
    expect(manual.get(account.id)).toEqual([
      { id: transaction.id, on: TODAY, cents: -450n, writtenAt: transaction.createdAt },
    ]);
    // Another person asking for the same account gets nothing.
    expect(await manualMovementsByAccount(await newContext(), [account.id])).toEqual(new Map());
  });
});
