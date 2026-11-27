// The other leg of a giroconto with a manual account (PERS-733), against the database: written once
// and paired, found instead when it is there, never for an account a source reads, kept in line with
// its leg until the person changes it, and in the manual account's balance. Made-up data only.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { listAccounts, readingsAt } from "../accounts/queries";
import { applyProviderAccounts, createAccount, removeAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { fxRates } from "../../platform/fx/schema";
import { addDays, today } from "../../shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";
import { createManualTransaction, deleteManualTransaction, updateManualTransaction } from "./manual";
import type { IncomingTransaction } from "./rules";
import {
  chooseTransferSide,
  deleteHiddenTransactions,
  hideTransactions,
  pairByHand,
  purgeRemovedUpstream,
  upsertFromProvider,
} from "./service";
import { transactions } from "./schema";

vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
afterAll(() => {
  vi.useRealTimers();
});

const TODAY = today("Europe/Rome");
const day = (back: number) => addDays(TODAY, -back);

async function newContext(): Promise<Ctx> {
  const { id } = await createTestUser();
  return {
    userId: id,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

/** An account kept by hand, with a balance of zero ten days ago. */
async function manualAccount(ctx: Ctx, name: string, currency = "EUR"): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "savings",
    currency,
    openingBalance: { on: day(10), cents: 0n },
  });
  return account.id;
}

/** An account a source reads. */
async function syncedAccount(ctx: Ctx, name: string): Promise<string> {
  const remote = {
    provider: WALLET_PROVIDER,
    providerAccountId: name,
    name,
    type: "checking" as const,
    currency: "EUR",
  };
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [remote]);
  const account = (await listAccounts(ctx)).find((one) => one.name === name);
  if (!account) throw new Error("the account was not created");
  return account.id;
}

function bankMovement(externalId: string, amountCents: bigint, back = 1): IncomingTransaction {
  return {
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date(`${day(back)}T10:00:00Z`),
    amountCents,
    currency: "EUR",
    type: amountCents < 0n ? "expense" : "income",
    state: "cleared",
    payee: "Giroconto",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

async function read(ctx: Ctx, accountId: string, movements: IncomingTransaction[]): Promise<void> {
  await upsertFromProvider(ctx, accountId, movements, { provider: WALLET_PROVIDER });
}

function rowsOf(ctx: Ctx, accountId: string) {
  return getDb()
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, accountId)));
}

async function only(ctx: Ctx, accountId: string) {
  const rows = await rowsOf(ctx, accountId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function balance(ctx: Ctx, accountId: string): Promise<bigint | undefined> {
  return (await readingsAt(ctx, [accountId], TODAY)).get(accountId);
}

function manualMovement(accountId: string, over: Record<string, unknown> = {}) {
  return {
    kind: "expense",
    amountCents: 20_000n,
    on: day(2),
    accountId,
    categoryId: null,
    payee: "Giroconto",
    note: "",
    ...over,
  };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("a giroconto from a synced account to a manual one", () => {
  it("writes the opposite leg on the manual account, paired, once, and in its balance", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);

    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });
    // The same choice again writes nothing more.
    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });

    const twin = await only(ctx, savings);
    const origin = await only(ctx, bank);
    expect(twin).toMatchObject({
      amountCents: 50_000n,
      currency: "EUR",
      type: "transfer",
      origin: "manual",
      categoryId: null,
      twinOf: leg.id,
      occurredAt: leg.occurredAt,
    });
    expect(twin.transferGroupId).not.toBeNull();
    expect(origin.transferGroupId).toBe(twin.transferGroupId);
    expect(origin.transferAccountId).toBeNull();
    expect(await balance(ctx, savings)).toBe(50_000n);
  });

  it("pairs the leg already on the manual account instead of writing one", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await read(ctx, bank, [bankMovement("b1", -50_000n, 2)]);
    const leg = await only(ctx, bank);
    // The person wrote the other leg already, as a giroconto from the bank.
    await createManualTransaction(
      ctx,
      manualMovement(savings, { kind: "income", amountCents: 50_000n, transferAccountId: bank }),
    );

    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });

    const mine = await only(ctx, savings);
    expect(mine.twinOf).toBeNull();
    expect((await only(ctx, bank)).transferGroupId).toBe(mine.transferGroupId);
  });

  it("follows the leg's amount and day, and goes when the leg stops being a giroconto", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);
    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });

    await read(ctx, bank, [bankMovement("b1", -60_000n, 3)]);
    const twin = await only(ctx, savings);
    expect(twin.amountCents).toBe(60_000n);
    expect(twin.occurredAt).toEqual(new Date(`${day(3)}T10:00:00Z`));
    expect(await balance(ctx, savings)).toBe(60_000n);

    await chooseTransferSide(ctx, leg.id, { kind: "none" });
    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect(await balance(ctx, savings)).toBe(0n);
  });

  it("goes when the leg goes to another account or is paired by hand elsewhere", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    const drawer = await manualAccount(ctx, "Drawer");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);
    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });

    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: drawer });
    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect((await only(ctx, drawer)).twinOf).toBe(leg.id);

    const { transaction: other } = await createManualTransaction(
      ctx,
      manualMovement(savings, { kind: "income", amountCents: 50_000n }),
    );
    await pairByHand(ctx, leg.id, other.id);
    expect(await rowsOf(ctx, drawer)).toHaveLength(0);
    expect(await balance(ctx, drawer)).toBe(0n);
  });

  it("leaves alone a written leg the person changed", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);
    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });
    const twin = await only(ctx, savings);

    await updateManualTransaction(
      ctx,
      twin.id,
      manualMovement(savings, { kind: "income", amountCents: 49_000n, on: day(1), transferAccountId: bank }),
    );
    await read(ctx, bank, [bankMovement("b1", -60_000n)]);

    const mine = await only(ctx, savings);
    expect(mine).toMatchObject({ twinOf: null, amountCents: 49_000n });
  });

  it("writes nothing when the other account is read by a source", async () => {
    const ctx = await newContext();
    const bank = await syncedAccount(ctx, "Bank");
    const other = await syncedAccount(ctx, "Other bank");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);

    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: other });

    expect(await rowsOf(ctx, other)).toHaveLength(0);
    expect((await only(ctx, bank)).transferAccountId).toBe(other);
  });
});

describe("a giroconto written by hand", () => {
  it("writes, follows and deletes the other leg on a manual account", async () => {
    const ctx = await newContext();
    const cash = await manualAccount(ctx, "Cash");
    const savings = await manualAccount(ctx, "Savings");

    const { transaction } = await createManualTransaction(
      ctx,
      manualMovement(cash, { transferAccountId: savings, categoryId: null }),
    );
    expect(transaction).toMatchObject({ type: "transfer" });
    expect(await only(ctx, savings)).toMatchObject({ amountCents: 20_000n, twinOf: transaction.id });

    await updateManualTransaction(
      ctx,
      transaction.id,
      manualMovement(cash, { amountCents: 25_000n, transferAccountId: savings }),
    );
    const twin = await only(ctx, savings);
    expect(twin.amountCents).toBe(25_000n);
    expect((await only(ctx, cash)).transferGroupId).toBe(twin.transferGroupId);
    expect(await balance(ctx, savings)).toBe(25_000n);

    await deleteManualTransaction(ctx, transaction.id);
    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect(await balance(ctx, savings)).toBe(0n);
  });

  it("gives the other leg the payee and the note of its leg, and follows them", async () => {
    const ctx = await newContext();
    const cash = await manualAccount(ctx, "Cash");
    const savings = await manualAccount(ctx, "Savings");
    const { transaction } = await createManualTransaction(
      ctx,
      manualMovement(cash, { transferAccountId: savings, payee: "Piggy bank", note: "June" }),
    );
    expect(await only(ctx, savings)).toMatchObject({ payee: "Piggy bank", note: "June" });

    await updateManualTransaction(
      ctx,
      transaction.id,
      manualMovement(cash, { transferAccountId: savings, payee: "Holiday fund", note: "July" }),
    );
    expect(await only(ctx, savings)).toMatchObject({
      payee: "Holiday fund",
      note: "July",
      twinOf: transaction.id,
    });
  });

  it("deletes the other leg when the movement is changed into a spending", async () => {
    const ctx = await newContext();
    const cash = await manualAccount(ctx, "Cash");
    const savings = await manualAccount(ctx, "Savings");
    const { transaction } = await createManualTransaction(
      ctx,
      manualMovement(cash, { transferAccountId: savings }),
    );

    await updateManualTransaction(ctx, transaction.id, manualMovement(cash));

    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect(await only(ctx, cash)).toMatchObject({ type: "expense", transferGroupId: null });
  });
});

describe("a giroconto to a manual account in another currency", () => {
  it("converts at the rate of the day, and waits without one", async () => {
    const ctx = await newContext();
    const cash = await manualAccount(ctx, "Cash");
    const dollars = await manualAccount(ctx, "Dollars", "USD");

    const { transaction: waiting } = await createManualTransaction(
      ctx,
      manualMovement(cash, { transferAccountId: dollars, on: day(3) }),
    );
    expect(await rowsOf(ctx, dollars)).toHaveLength(0);
    expect(await only(ctx, cash)).toMatchObject({
      id: waiting.id,
      transferAccountId: dollars,
      transferGroupId: null,
    });

    // 1 USD = 0.8 EUR: 200 EUR are 250 USD.
    await getDb()
      .insert(fxRates)
      .values({ on: day(5), currency: "USD", eurPerUnit: "0.8" })
      .onConflictDoNothing();
    await chooseTransferSide(ctx, waiting.id, { kind: "account", accountId: dollars });

    expect(await only(ctx, dollars)).toMatchObject({
      amountCents: 25_000n,
      currency: "USD",
      twinOf: waiting.id,
    });
  });
});

// PERS-737: a leg the source leaves out for a while, and the deletions the twin falls with.
describe("the written leg and the deletions around it", () => {
  async function bankLegToSavings(ctx: Ctx) {
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await read(ctx, bank, [bankMovement("b1", -50_000n)]);
    const leg = await only(ctx, bank);
    await chooseTransferSide(ctx, leg.id, { kind: "account", accountId: savings });
    expect(await balance(ctx, savings)).toBe(50_000n);
    return { bank, savings, leg };
  }

  it("stays while the source leaves the leg out of a reading, and the pair holds when it is back", async () => {
    const ctx = await newContext();
    const { bank, savings, leg } = await bankLegToSavings(ctx);
    const window = { from: day(5), to: TODAY };

    await upsertFromProvider(ctx, bank, [], { provider: WALLET_PROVIDER, window });
    expect((await only(ctx, bank)).removedUpstreamAt).not.toBeNull();
    await upsertFromProvider(ctx, bank, [bankMovement("b1", -50_000n)], {
      provider: WALLET_PROVIDER,
      window,
    });

    const twin = await only(ctx, savings);
    expect(twin.twinOf).toBe(leg.id);
    expect((await only(ctx, bank)).transferGroupId).toBe(twin.transferGroupId);
    expect(await balance(ctx, savings)).toBe(50_000n);
  });

  // PERS-744 (D1): the source may only have replaced the leg with a new id, so the written leg
  // stays as one kept by hand, as before PERS-733.
  it("stays, kept by hand, when the source removes its leg for good", async () => {
    const ctx = await newContext();
    const { bank, savings } = await bankLegToSavings(ctx);
    await upsertFromProvider(ctx, bank, [], {
      provider: WALLET_PROVIDER,
      window: { from: day(5), to: TODAY },
    });

    await purgeRemovedUpstream(ctx, { provider: WALLET_PROVIDER });

    expect(await rowsOf(ctx, bank)).toHaveLength(0);
    expect((await only(ctx, savings)).twinOf).toBeNull();
    expect(await balance(ctx, savings)).toBe(50_000n);
  });

  async function pendingLegToSavings(ctx: Ctx) {
    const bank = await syncedAccount(ctx, "Bank");
    const savings = await manualAccount(ctx, "Savings");
    await upsertFromProvider(ctx, bank, [{ ...bankMovement("p1", -50_000n), state: "pending" }], {
      provider: WALLET_PROVIDER,
      window: { from: day(5), to: TODAY },
    });
    await chooseTransferSide(ctx, (await only(ctx, bank)).id, { kind: "account", accountId: savings });
    expect(await balance(ctx, savings)).toBe(50_000n);
    return { bank, savings };
  }

  async function expectPairedWithBooked(ctx: Ctx, bank: string, savings: string) {
    const booked = await only(ctx, bank);
    const twin = await only(ctx, savings);
    expect(booked.type).toBe("transfer");
    expect(booked.transferGroupId).not.toBeNull();
    expect(twin.transferGroupId).toBe(booked.transferGroupId);
    expect(await balance(ctx, savings)).toBe(50_000n);
  }

  it("pairs with the booked movement that replaces its pending leg in the same reading", async () => {
    const ctx = await newContext();
    const { bank, savings } = await pendingLegToSavings(ctx);
    const window = { from: day(5), to: TODAY };

    await upsertFromProvider(ctx, bank, [bankMovement("k1", -50_000n)], {
      provider: WALLET_PROVIDER,
      window,
    });
    await purgeRemovedUpstream(ctx, { provider: WALLET_PROVIDER });
    await expectPairedWithBooked(ctx, bank, savings);
    // The next reading keeps the pair.
    await upsertFromProvider(ctx, bank, [bankMovement("k1", -50_000n)], {
      provider: WALLET_PROVIDER,
      window,
    });
    await expectPairedWithBooked(ctx, bank, savings);
  });

  it("pairs with the booked movement that comes in a later reading", async () => {
    const ctx = await newContext();
    const { bank, savings } = await pendingLegToSavings(ctx);
    const window = { from: day(5), to: TODAY };

    await upsertFromProvider(ctx, bank, [], { provider: WALLET_PROVIDER, window });
    await purgeRemovedUpstream(ctx, { provider: WALLET_PROVIDER });
    expect(await balance(ctx, savings)).toBe(50_000n);
    await upsertFromProvider(ctx, bank, [bankMovement("k1", -50_000n)], {
      provider: WALLET_PROVIDER,
      window,
    });
    await purgeRemovedUpstream(ctx, { provider: WALLET_PROVIDER });
    await expectPairedWithBooked(ctx, bank, savings);
  });

  it("goes with a hidden leg deleted for good, and the balance follows", async () => {
    const ctx = await newContext();
    const { savings, leg } = await bankLegToSavings(ctx);
    await hideTransactions(ctx, [leg.id]);

    await deleteHiddenTransactions(ctx, [leg.id]);

    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect(await balance(ctx, savings)).toBe(0n);
  });

  it("goes with the account of its leg, and the balance follows", async () => {
    const ctx = await newContext();
    const { bank, savings } = await bankLegToSavings(ctx);

    await removeAccount(ctx, bank);

    expect(await rowsOf(ctx, savings)).toHaveLength(0);
    expect(await balance(ctx, savings)).toBe(0n);
  });
});
