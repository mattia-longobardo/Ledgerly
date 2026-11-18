// "Delete account" against a real Postgres (PERS-419): what rests on an account, the move of each
// kind, the deletion that never archives, and an account of a source that is deleted, not made
// again by the next reading, and chosen again from the integration. Wallet is a stubbed `fetch`
// answering with the fixtures in `test/fixtures/wallet/`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount, listAccounts } from "@domain/modules/accounts/queries";
import { applyProviderAccounts, archiveAccount, createAccount } from "@domain/modules/accounts/service";
import { setLimit } from "@domain/modules/budgets/service";
import { createRule } from "@domain/modules/interests/service";
import { createPocket } from "@domain/modules/pockets/service";
import { createSubscription } from "@domain/modules/subscriptions/service";
import { createCategory } from "@domain/modules/transactions/taxonomy";
import { listTransactions } from "@domain/modules/transactions/queries";
import type { Ctx } from "@domain/platform/context";
import { addDays } from "@domain/platform/dates";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import {
  deleteConnection,
  readSyncJob,
  resolveExternal,
  saveConnection,
  saveSchedule,
  skippedAccounts,
} from "@domain/platform/integrations/service";
import type { WalletClientOptions } from "@domain/platform/integrations/wallet/client";
import {
  chooseWalletAccounts,
  requestWalletBackfill,
  syncWalletNow,
  walletAccountChoices,
} from "@domain/platform/integrations/wallet/sync";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { debitFund } from "../../../../../../../test/funds";
import { createTestUser } from "../../../../../../../test/users";
import { accountDependents, DeleteError, deleteAccount, moveDependent } from "./delete";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DeleteError);
  return (error as DeleteError).code;
}

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
});
afterAll(closeDatabase);

const checking = (name: string) => createAccount(ctx, { name, type: "checking" }).then((one) => one.id);

/** One thing of each kind on `account`: a pocket, a rule, two limits, a subscription, a fund and a debit source. */
async function everythingOn(account: string) {
  const groceries = (await createCategory(ctx, { name: "Groceries" })).id;
  await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: account,
    targetCents: 400_000n,
    monthlyCents: null,
    startMonth: "2026-01-01",
  });
  await createRule(ctx, {
    accountId: account,
    taxRate: "0",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: "2026-01-01",
    validTo: null,
    payeeMatch: "interessi",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });
  await setLimit(ctx, { categoryId: null, accountId: account, month: "2026-01-01", cents: 3_000n });
  await setLimit(ctx, { categoryId: groceries, accountId: account, month: "2026-01-01", cents: 2_000n });
  await setLimit(ctx, { categoryId: groceries, accountId: account, month: "2026-02-01", cents: 2_500n });
  await createSubscription(ctx, {
    name: "Netflix",
    categoryId: null,
    utility: 7,
    priceCents: 1_299n,
    cycle: "monthly",
    nextChargeOn: "2026-02-01",
    paymentAccountId: account,
    payeeMatch: "netflix",
    tolerance: "0.05",
  });
  const fund = await debitFund(ctx, {
    name: "Pension",
    startOn: "2026-01-01",
    monthlyCents: 10_000n,
    debitDay: 5,
    debitAccountId: account,
  });
  return { groceries, fund };
}

describe("an archived account (PERS-421)", () => {
  it("is deleted at once when nothing rests on it", async () => {
    const old = await checking("Old");
    await archiveAccount(ctx, old);
    expect(await accountDependents(ctx, old)).toEqual([]);
    await deleteAccount(ctx, old);
    expect(await getAccount(ctx, old)).toBeNull();
  });

  it("is deleted, as an open one, only once what rests on it is moved", async () => {
    const old = await checking("Old");
    const next = await checking("Next");
    await everythingOn(old);
    await archiveAccount(ctx, old);
    const listed = await accountDependents(ctx, old);
    expect(listed).toHaveLength(6);
    expect(await codeOf(deleteAccount(ctx, old))).toBe("in_use");
    expect((await getAccount(ctx, old))?.state).toBe("archived");

    for (const one of listed) await moveDependent(ctx, old, { kind: one.kind, id: one.id, to: next });
    await deleteAccount(ctx, old);
    expect(await getAccount(ctx, old)).toBeNull();
    expect(await accountDependents(ctx, next)).toHaveLength(6);
  });
});

describe("what rests on an account", () => {
  it("is listed, kind by kind, and each thing is moved to another account by its owner's rules", async () => {
    const old = await checking("Old");
    const next = await checking("Next");
    const { groceries, fund } = await everythingOn(old);
    // The fund's own account is what values it: moving the fund is moving that.
    const valued = await accountDependents(ctx, fund.valuationAccountId);
    expect(valued).toEqual([{ kind: "fund", id: fund.id, label: "Pension" }]);

    const listed = await accountDependents(ctx, old);
    expect(listed.map((one) => [one.kind, one.label])).toEqual([
      ["pocket", "Holidays"],
      ["interestRule", "2026-01-01"],
      ["budgetLimit", "Groceries"],
      ["budgetLimit", null],
      ["subscription", "Netflix"],
      ["fundSource", "Pension"],
    ]);
    expect(listed.find((one) => one.label === "Groceries")?.id).toBe(groceries);

    expect(await codeOf(deleteAccount(ctx, old))).toBe("in_use");
    // Never archived in secret.
    expect((await getAccount(ctx, old))?.state).toBe("active");

    for (const one of listed) await moveDependent(ctx, old, { kind: one.kind, id: one.id, to: next });
    expect(await accountDependents(ctx, old)).toEqual([]);
    expect((await accountDependents(ctx, next)).map((one) => [one.kind, one.label])).toEqual(
      listed.map((one) => [one.kind, one.label]),
    );

    await deleteAccount(ctx, old);
    expect(await getAccount(ctx, old)).toBeNull();
  });

  it("refuses a move its owner refuses, and a thing that does not rest on this account", async () => {
    const old = await checking("Old");
    const next = await checking("Next");
    await everythingOn(old);
    const listed = await accountDependents(ctx, old);
    const of = (kind: string) => listed.find((one) => one.kind === kind)!;

    // The same account, an id of something else, another person's account.
    expect(await codeOf(moveDependent(ctx, old, { kind: "pocket", id: of("pocket").id, to: old }))).toBe(
      "same_account",
    );
    expect(await codeOf(moveDependent(ctx, next, { kind: "pocket", id: of("pocket").id, to: old }))).toBe(
      "not_found",
    );
    const stranger = contextFor((await createTestUser()).id);
    const theirs = (await createAccount(stranger, { name: "Theirs", type: "checking" })).id;
    expect(await codeOf(moveDependent(ctx, old, { kind: "pocket", id: of("pocket").id, to: theirs }))).toBe(
      "invalid_account",
    );
    expect(await codeOf(accountDependents(stranger, old))).toBe("not_found");

    // A budget limit of the same scope and months already on the target.
    await setLimit(ctx, { categoryId: null, accountId: next, month: "2026-01-01", cents: 1_000n });
    const accountLimit = listed.find((one) => one.kind === "budgetLimit" && one.id === "")!;
    expect(await codeOf(moveDependent(ctx, old, { kind: "budgetLimit", id: "", to: next }))).toBe("conflict");
    expect(accountLimit).toBeDefined();

    // A fund on an account that already values another fund.
    const other = await debitFund(ctx, { name: "Other", startOn: "2026-01-01" });
    const fund = await debitFund(ctx, { name: "Third", startOn: "2026-01-01" });
    expect(
      await codeOf(
        moveDependent(ctx, fund.valuationAccountId, {
          kind: "fund",
          id: fund.id,
          to: other.valuationAccountId,
        }),
      ),
    ).toBe("account_taken");

    // An interest rule that publishes to the source needs an account of a source.
    await applyProviderAccounts(ctx, WALLET_PROVIDER, [
      {
        provider: WALLET_PROVIDER,
        providerAccountId: "w-s",
        name: "Synced",
        type: "savings",
        currency: "EUR",
      },
    ]);
    const synced = (await listAccounts(ctx)).find((row) => row.providerAccountId === "w-s")!.id;
    const posting = await createRule(ctx, {
      accountId: synced,
      taxRate: "0",
      dayBasis: "365",
      settlement: "monthly",
      validFrom: "2026-01-01",
      validTo: null,
      payeeMatch: "interessi",
      mode: "post_to_provider",
      tiers: [{ upToCents: null, annualRate: "0.0365" }],
    });
    expect(await codeOf(moveDependent(ctx, synced, { kind: "interestRule", id: posting.id, to: next }))).toBe(
      "not_synced",
    );
  });
});

// ——— An account of a source ————————————————————————————————————————————————————————————————————

const FIXTURES = join(process.cwd(), "test/fixtures/wallet");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const CATEGORIES = fixture("categories.json");
type WireRecord = { recordDate: string; accountId?: string; [key: string]: unknown };
const ACCOUNTS = (fixture("accounts.json").accounts as { id: string }[]).filter((one) =>
  ["wa-general", "wa-cash"].includes(one.id),
);
/** One expense, 2026-01-05, on `wa-general`. */
const JANUARY = fixture("records-january-first-half.json").records as WireRecord[];
const NOW = new Date("2026-01-06T08:07:00Z");

function walletStub(): WalletClientOptions {
  return {
    baseUrl: "https://wallet.test/api",
    sleep: async () => undefined,
    jitter: () => 0,
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: ACCOUNTS });
      if (url.pathname.endsWith("/categories")) return Response.json(CATEGORIES);
      const bounds = url.searchParams.getAll("recordDate");
      const from = bounds.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
      const to = bounds.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
      return Response.json({
        records: JANUARY.filter((row) => row.recordDate >= from && row.recordDate <= to),
        appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${addDays(to, 1)}T00:00:00.000Z`],
      });
    },
  };
}

const general = async () =>
  (await listAccounts(ctx, { includeArchived: true })).find((one) => one.providerAccountId === "wa-general");

describe("an account of Wallet", () => {
  it("is deleted, is not made again by the next reading, and comes back with its movements when chosen again", async () => {
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const options = { now: NOW, clientOptions: walletStub() };
    await syncWalletNow(ctx, connection.id, options);
    const before = await general();
    expect(before).toBeDefined();
    const movements = await listTransactions(ctx, { accountIds: [before!.id], includeHidden: true });
    expect(movements.length).toBeGreaterThan(0);

    await deleteAccount(ctx, before!.id);
    expect(await getAccount(ctx, before!.id)).toBeNull();
    expect(await skippedAccounts(ctx, connection.id)).toEqual(new Set(["wa-general"]));
    const externalIds = JANUARY.map((row) => String(row.id));
    expect((await resolveExternal(ctx, WALLET_PROVIDER, "transaction", externalIds)).size).toBe(0);

    // The next reading leaves it out: no account, no movement, and Cash still read.
    await syncWalletNow(ctx, connection.id, { ...options, now: new Date(NOW.getTime() + 3_600_000) });
    expect(await general()).toBeUndefined();
    expect((await listAccounts(ctx)).map((one) => one.providerAccountId)).toEqual(["wa-cash"]);

    // The choice on the integration's page says which accounts are here and which are not.
    const choices = await walletAccountChoices(ctx, connection.id, { clientOptions: walletStub() });
    expect(choices.map((one) => [one.externalId, one.local === null, one.chosen])).toEqual([
      ["wa-cash", false, true],
      ["wa-general", true, false],
    ]);

    // Chosen again: the history is downloaded again, and the movements come back.
    expect(
      await chooseWalletAccounts(ctx, connection.id, ["wa-general"], { clientOptions: walletStub() }),
    ).toEqual({ added: 1 });
    expect(await skippedAccounts(ctx, connection.id)).toEqual(new Set());
    expect((await readSyncJob(ctx, connection.id, "transactions"))?.cursor?.backfillMonths).toBe("12");
    await syncWalletNow(ctx, connection.id, { ...options, now: new Date(NOW.getTime() + 7_200_000) });
    const after = await general();
    expect(after).toBeDefined();
    expect(after!.id).not.toBe(before!.id);
    const back = await listTransactions(ctx, { accountIds: [after!.id], includeHidden: true });
    expect(back.map((one) => one.amountCents)).toEqual(movements.map((one) => one.amountCents));
  });

  it("disconnected and connected again: the accounts left out or deleted stay out, the schedule stays (H55)", async () => {
    const options = { now: NOW, clientOptions: walletStub() };
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    await chooseWalletAccounts(ctx, connection.id, ["wa-general"], { clientOptions: walletStub() });
    const schedule = {
      rules: [{ kind: "times" as const, times: ["06:30"], days: { kind: "every" as const } }],
    };
    await saveSchedule(ctx, connection.id, schedule, NOW);
    await syncWalletNow(ctx, connection.id, options);
    await requestWalletBackfill(ctx, connection.id, 24);
    const general = (await listAccounts(ctx)).find((one) => one.providerAccountId === "wa-general")!;

    await deleteConnection(ctx, connection.id);
    // Deleted while Wallet is disconnected: remembered all the same.
    await deleteAccount(ctx, general.id);

    const again = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t2" } });
    expect(again.schedule).toEqual(schedule);
    expect(await skippedAccounts(ctx, again.id)).toEqual(new Set(["wa-cash", "wa-general"]));
    expect((await readSyncJob(ctx, again.id, "transactions"))?.cursor?.backfillMonths).toBe("24");
    await syncWalletNow(ctx, again.id, { ...options, now: new Date(NOW.getTime() + 3_600_000) });
    expect(await listAccounts(ctx, { includeArchived: true })).toEqual([]);
    const choices = await walletAccountChoices(ctx, again.id, { clientOptions: walletStub() });
    expect(choices.map((one) => [one.externalId, one.chosen])).toEqual([
      ["wa-cash", false],
      ["wa-general", false],
    ]);
  });

  it("left out before the first reading, is never added; the others are", async () => {
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    expect(
      await chooseWalletAccounts(ctx, connection.id, ["wa-general"], { clientOptions: walletStub() }),
    ).toEqual({ added: 0 });
    await syncWalletNow(ctx, connection.id, { now: NOW, clientOptions: walletStub() });
    expect((await listAccounts(ctx)).map((one) => one.providerAccountId)).toEqual(["wa-general"]);
  });
});
