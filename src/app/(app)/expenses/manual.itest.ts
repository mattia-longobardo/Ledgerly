import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { balancesOn, listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import {
  accountDailyBalances,
  applyProviderAccounts,
  archiveAccount,
  createAccount,
  rebuildDerivedBalances,
  runSnapshot,
  saveBalanceEntry,
  saveProviderBalance,
} from "@/modules/accounts/service";
import { getTransaction, listTransactions } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import {
  changeVisibility,
  createManual,
  deleteManual,
  manualAccounts,
  previewManual,
  updateManual,
} from "./manual";

// The manual movement as a person meets it: which accounts take one, and what it does to the
// balance every screen reads (rewrite plan, 12-account-modes.md §12.2; criteria 6, 7 and 8 of N3).

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

const TODAY = today("Europe/Rome");
const day = (back: number) => addDays(TODAY, -back);
/** A provider that only reads: a plugin with no manifest that says it creates records. */
const BANK = "plugin:testbank";
/** A provider of the core that takes the movements written here. */
const TWO_WAY = "wallet";

async function balance(ctx: Ctx, accountId: string, on = TODAY): Promise<bigint | undefined> {
  return (await balancesOn(ctx, [accountId], on)).get(accountId);
}

async function cash(ctx: Ctx, cents: bigint | null, on = day(5)) {
  return createAccount(ctx, {
    name: "Cash",
    type: "cash",
    openingBalance: cents === null ? null : { on, cents },
  });
}

async function synced(
  ctx: Ctx,
  provider: string,
  name: string,
  type: "checking" | "investment" = "checking",
) {
  await applyProviderAccounts(ctx, provider, [
    { provider, providerAccountId: `${name}-1`, name, type, currency: "EUR" },
  ]);
  const account = (await listAccounts(ctx)).find((one) => one.name === name);
  if (!account) throw new Error("the account was not created");
  return account;
}

/** What a bank's pass does: the balance it read, then the rebuild the sink asks for. */
async function bankReads(ctx: Ctx, accountId: string, on: string, cents: bigint, at = new Date()) {
  await saveProviderBalance(ctx, accountId, { on, cents }, at);
  await rebuildDerivedBalances(ctx, [accountId]);
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

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the accounts that take a manual movement", () => {
  it("are the ones kept by hand and the ones a source only reads, with their mode", async () => {
    const ctx = await newContext();
    const kept = await cash(ctx, 8_000n);
    const bank = await synced(ctx, BANK, "Zeta current");
    await synced(ctx, TWO_WAY, "Budget app current");
    await synced(ctx, BANK, "Zeta portfolio", "investment");
    await createAccount(ctx, { name: "Pension", type: "pension" });
    const archived = await createAccount(ctx, { name: "Old cash", type: "cash" });
    await archiveAccount(ctx, archived.id);

    expect(await manualAccounts(ctx)).toEqual([
      { id: kept.id, name: "Cash", currency: "EUR", mode: "manual" },
      { id: bank.id, name: "Zeta current", currency: "EUR", mode: "read_only" },
    ]);
  });

  it("refuses a movement on a read-and-write account until its release, and on a portfolio", async () => {
    const ctx = await newContext();
    const twoWay = await synced(ctx, TWO_WAY, "Budget app current");
    const portfolio = await synced(ctx, BANK, "Zeta portfolio", "investment");
    const other = await cash(await newContext(), 100n);

    for (const account of [twoWay, portfolio, other]) {
      await expect(createManual(ctx, movement(account.id))).rejects.toMatchObject({
        code: "account_unavailable",
      });
    }
    expect(await listTransactions(ctx)).toHaveLength(0);
  });
});

describe("an account kept by hand", () => {
  it("has the new balance at once, on every read of a balance (criterion 6 of N3)", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);

    await createManual(ctx, movement(account.id));

    expect(await balance(ctx, account.id)).toBe(7_550n);
    // The balance of yesterday is the one that was known yesterday.
    expect(await balance(ctx, account.id, day(1))).toBe(8_000n);
    const { values } = await accountDailyBalances(ctx, account.id, { from: day(1), to: TODAY });
    expect(values).toEqual([8_000n, 7_550n]);
  });

  it("does not change today's balance for a day before the last balance written (criterion 8)", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n, day(2));

    await createManual(ctx, movement(account.id, { on: day(4) }));

    expect(await balance(ctx, account.id)).toBe(8_000n);
    expect((await listBalanceEntries(ctx, account.id)).map((entry) => entry.source)).toEqual(["manual"]);
  });

  it("corrects the balance when the movement is changed, hidden, restored and deleted", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    const { transaction } = await createManual(ctx, movement(account.id));

    await updateManual(ctx, transaction.id, movement(account.id, { amountCents: 1_000n }));
    expect(await balance(ctx, account.id)).toBe(7_000n);

    expect(await changeVisibility(ctx, [transaction.id], "hide")).toBe(1);
    expect(await balance(ctx, account.id)).toBe(8_000n);

    expect(await changeVisibility(ctx, [transaction.id], "restore")).toBe(1);
    expect(await balance(ctx, account.id)).toBe(7_000n);

    await deleteManual(ctx, transaction.id);
    expect(await balance(ctx, account.id)).toBe(8_000n);
    expect(await getTransaction(ctx, transaction.id)).toBeNull();
  });

  it("moves the balance of both accounts when the movement changes account", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    const drawer = await createAccount(ctx, {
      name: "Drawer",
      type: "cash",
      openingBalance: { on: day(5), cents: 2_000n },
    });
    const { transaction } = await createManual(ctx, movement(account.id));

    await updateManual(ctx, transaction.id, movement(drawer.id));

    expect(await balance(ctx, account.id)).toBe(8_000n);
    expect(await balance(ctx, drawer.id)).toBe(1_550n);
  });

  it("starts again from a balance the person writes after the movement", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    await createManual(ctx, movement(account.id, { on: day(2) }));
    expect(await balance(ctx, account.id)).toBe(7_550n);

    await saveBalanceEntry(ctx, account.id, { on: day(1), cents: 7_000n, note: "" });

    expect(await balance(ctx, account.id)).toBe(7_000n);
    // The day of the movement keeps what was known then.
    expect(await balance(ctx, account.id, day(2))).toBe(7_550n);
  });

  it("writes the same balance once for the same key sent twice", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    const key = "018f4e9a-1111-7000-8000-00000000000b";

    await createManual(ctx, movement(account.id), key);
    const again = await createManual(ctx, movement(account.id), key);

    expect(again.created).toBe(false);
    expect(await balance(ctx, account.id)).toBe(7_550n);
  });

  it("keeps the movement in the balance after the month's snapshot copied the balance before it", async () => {
    const ctx = await newContext();
    const account = await createAccount(ctx, {
      name: "Cash",
      type: "cash",
      openingBalance: { on: "2026-09-20", cents: 10_000n },
    });
    await runSnapshot(ctx, "2026-09-01", new Date("2026-10-01T00:05:00Z"));

    // Written in October, for a day of September after the balance and before the snapshot.
    await createManual(ctx, movement(account.id, { on: "2026-09-25", amountCents: 1_000n }));

    expect(await balance(ctx, account.id)).toBe(9_000n);
  });

  it("marks the account while it has a manual movement, and only then", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    const marked = async () =>
      (await listAccounts(ctx)).find((one) => one.id === account.id)?.hasManualMovements;
    expect(await marked()).toBe(false);

    const { transaction } = await createManual(ctx, movement(account.id));
    expect(await marked()).toBe(true);

    // Hidden: out of the balance, so nothing is left to rebuild from.
    await changeVisibility(ctx, [transaction.id], "hide");
    expect(await marked()).toBe(false);
    await changeVisibility(ctx, [transaction.id], "restore");
    expect(await marked()).toBe(true);

    await deleteManual(ctx, transaction.id);
    expect(await marked()).toBe(false);
  });

  it("follows a balance written later without being told the manual movements changed", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n, day(3));
    await createManual(ctx, movement(account.id, { on: day(1) }));
    expect(await balance(ctx, account.id)).toBe(7_550n);

    // The person corrects the balance of two days ago: the movement of yesterday adds to it.
    await saveBalanceEntry(ctx, account.id, { on: day(2), cents: 9_000n, note: "" });

    expect(await balance(ctx, account.id)).toBe(8_550n);
  });

  it("leaves every other person's balance alone", async () => {
    const mine = await newContext();
    const theirs = await newContext();
    const account = await cash(mine, 8_000n);
    const theirAccount = await cash(theirs, 8_000n);

    await createManual(mine, movement(account.id));

    expect(await balance(theirs, theirAccount.id)).toBe(8_000n);
  });
});

describe("an account a bank only reads", () => {
  it("has the new balance at once and the bank's balance after the next reading (criterion 7)", async () => {
    const ctx = await newContext();
    const account = await synced(ctx, BANK, "Zeta current");
    await bankReads(ctx, account.id, day(1), 100_000n, new Date(Date.now() - 86_400_000));

    const { transaction } = await createManual(ctx, movement(account.id, { amountCents: 5_000n }));
    expect(await balance(ctx, account.id)).toBe(95_000n);

    // The bank is read again later today and does not know the manual movement.
    await bankReads(ctx, account.id, TODAY, 100_000n, new Date(Date.now() + 60_000));

    expect(await balance(ctx, account.id)).toBe(100_000n);
    const kept = await getTransaction(ctx, transaction.id);
    expect(kept).toMatchObject({ origin: "manual", removedUpstreamAt: null, hiddenAt: null });
    expect((await listBalanceEntries(ctx, account.id)).map((entry) => entry.source)).not.toContain(
      "movement",
    );
  });

  it("counts a movement written after today's reading until the next one", async () => {
    const ctx = await newContext();
    const account = await synced(ctx, BANK, "Zeta current");
    await bankReads(ctx, account.id, TODAY, 100_000n, new Date(Date.now() - 3_600_000));

    await createManual(ctx, movement(account.id, { amountCents: 5_000n }));

    expect(await balance(ctx, account.id)).toBe(95_000n);
    const { values } = await accountDailyBalances(ctx, account.id, { from: TODAY, to: TODAY });
    expect(values).toEqual([95_000n]);
  });
});

describe("the balance line of the dialog", () => {
  it("says the balance before and after, from the rule that writes it", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);

    const preview = await previewManual(ctx, {
      accountId: account.id,
      kind: "expense",
      amountCents: 450n,
      on: TODAY,
    });
    expect(preview).toEqual({ account: "Cash", effect: { kind: "change", before: 8_000n, after: 7_550n } });

    await createManual(ctx, movement(account.id));
    expect(await balance(ctx, account.id)).toBe(7_550n);
  });

  it("says the balance does not change for a day the written balance already holds", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n, day(2));
    const preview = await previewManual(ctx, {
      accountId: account.id,
      kind: "expense",
      amountCents: 450n,
      on: day(4),
    });
    expect(preview?.effect).toEqual({ kind: "unchanged", readingOn: day(2) });
  });

  it("compares a movement being changed with the balance that holds it", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, 8_000n);
    const { transaction } = await createManual(ctx, movement(account.id));

    const preview = await previewManual(ctx, {
      accountId: account.id,
      kind: "expense",
      amountCents: 1_000n,
      on: TODAY,
      editingId: transaction.id,
    });
    expect(preview?.effect).toEqual({ kind: "change", before: 7_550n, after: 7_000n });
  });

  it("says nothing for an account with no balance, and for another person's account", async () => {
    const ctx = await newContext();
    const account = await cash(ctx, null);
    const input = { kind: "expense" as const, amountCents: 450n, on: TODAY };
    expect((await previewManual(ctx, { ...input, accountId: account.id }))?.effect).toEqual({ kind: "none" });
    expect(await previewManual(await newContext(), { ...input, accountId: account.id })).toBeNull();
  });
});
