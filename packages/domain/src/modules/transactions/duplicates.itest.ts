// An archived double counts in no month (decision H58), against a real Postgres: archiving records
// the twin, every total of the months leaves the double's movements out, the double's own page keeps
// them, "Restore" and a bank's "Choose the accounts" bring them back. A closed account (no twin)
// still counts in the months it lived.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts } from "../accounts/queries";
import {
  accountsOpenToProvider,
  archiveAccount,
  createAccount,
  linkProviderAccounts,
  restoreAccount,
  twinAccount,
} from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { categoryMacroTotals, listTransactions, monthlyTotals, transactionsSummary } from "./queries";
import type { IncomingTransaction } from "./rules";
import { upsertFromProvider } from "./service";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});
afterAll(closeDatabase);

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

async function account(name: string): Promise<string> {
  const created = await createAccount(ctx, { name, type: "checking", currency: "EUR" });
  return created.id;
}

function movement(id: string, day: string, cents: bigint, payee: string): IncomingTransaction {
  return {
    externalId: id,
    counterpartExternalId: null,
    occurredAt: new Date(`${day}T09:00:00Z`),
    amountCents: cents,
    currency: "EUR",
    type: cents < 0n ? "expense" : "income",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

/** A Wallet account, the same account read again by a bank, and an account closed in March. */
async function threeAccounts() {
  const twin = await account("Everyday");
  const double = await account("Everyday (bank)");
  const closed = await account("Old savings");
  await upsertFromProvider(
    ctx,
    twin,
    [movement("w-1", "2026-03-10", -2_500n, "Grocery"), movement("w-2", "2026-03-15", 100_000n, "Salary")],
    { provider: WALLET_PROVIDER, window: MARCH },
  );
  await upsertFromProvider(
    ctx,
    double,
    [
      movement("b-1", "2026-03-11", -2_500n, "GROCERY POS"),
      movement("b-2", "2026-03-15", 100_000n, "SALARY"),
    ],
    { provider: WALLET_PROVIDER, window: MARCH },
  );
  await upsertFromProvider(ctx, closed, [movement("c-1", "2026-03-20", -50_000n, "Transfer out")], {
    provider: WALLET_PROVIDER,
    window: MARCH,
  });
  return { twin, double, closed };
}

describe("an archived double (H58)", () => {
  it("counts in no month, while a closed account still does", async () => {
    const { twin, double, closed } = await threeAccounts();
    expect((await twinAccount(ctx, double))?.id).toBe(twin);
    expect(await twinAccount(ctx, closed)).toBeNull();

    const before = await transactionsSummary(ctx, MARCH);
    expect([before.incomeCents, before.expenseCents]).toEqual([200_000n, -55_000n]);

    await archiveAccount(ctx, double);
    await archiveAccount(ctx, closed);

    const after = await transactionsSummary(ctx, MARCH);
    expect([after.incomeCents, after.expenseCents, after.count]).toEqual([100_000n, -52_500n, 3]);
    expect(await monthlyTotals(ctx, MARCH)).toEqual([{ month: "2026-03-01", count: 3, netCents: 47_500n }]);
    const macros = await categoryMacroTotals(ctx, MARCH);
    expect(macros.reduce((sum, row) => sum + row.totalCents, 0n)).toBe(47_500n);
    // The archived double says its twin, and its own page keeps its history.
    expect((await twinAccount(ctx, double))?.id).toBe(twin);
    expect(await listTransactions(ctx, { ...MARCH, accountIds: [double] })).toHaveLength(2);
    expect(await listTransactions(ctx, MARCH)).toHaveLength(3);
  });

  it("counts again once restored", async () => {
    const { double } = await threeAccounts();
    await archiveAccount(ctx, double);
    await restoreAccount(ctx, double);
    expect((await transactionsSummary(ctx, MARCH)).incomeCents).toBe(200_000n);
    expect(await twinAccount(ctx, double)).not.toBeNull();
  });

  it("is offered by a bank's choice of accounts, which restores it", async () => {
    const { double } = await threeAccounts();
    await archiveAccount(ctx, double);
    const offered = await accountsOpenToProvider(ctx);
    expect(offered.find((one) => one.id === double)?.state).toBe("archived");

    await linkProviderAccounts(ctx, "plugin:bank", [
      { providerAccountId: "acc-1", currency: "EUR", target: { kind: "existing", accountId: double } },
    ]);
    const tied = (await listAccounts(ctx)).find((one) => one.id === double);
    expect(tied?.state).toBe("active");
    expect(tied?.provider).toBe("plugin:bank");
    expect((await transactionsSummary(ctx, MARCH)).incomeCents).toBe(200_000n);
  });
});
