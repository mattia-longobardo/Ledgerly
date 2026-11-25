// scripts/seed-e2e/transactions.ts — the users and the data of the flow `transactions` (tests/e2e/transactions/).
import { and, eq } from "drizzle-orm";
import { BANK_PLUGIN_ID as BANK_PLUGIN } from "../../apps/web/src/app/(app)/banks/plugin";
import { createManual } from "../../apps/web/src/app/(app)/expenses/manual";
import { setSourceCategory } from "../../apps/web/src/app/(app)/settings/finance/source";
import { accounts } from "@domain/modules/accounts/schema";
import { applyProviderAccounts, createAccount, saveProviderBalance } from "@domain/modules/accounts/service";
import { markNotSent } from "@domain/modules/transactions/sending";
import { listTransactions } from "@domain/modules/transactions/queries";
import { chooseTransferSide, upsertFromProvider } from "@domain/modules/transactions/service";
import { keepSourceCategory, listSourceCategories } from "@domain/modules/transactions/source-categories";
import { createCategory, listCategories } from "@domain/modules/transactions/taxonomy";
import { addDays, today } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import { pluginProvider } from "@domain/platform/integrations/rules";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, lastMonthOf, syncedAccount, thisMonthOf, walletMovement } from "./common";
import { WALLET_PROVIDER } from "../../test/fixtures/providers";

export async function seedExpenses(): Promise<void> {
  const ctx = await contextOf(USERS.expenses.email);
  const accountId = await syncedAccount(ctx, "e2e-acc-1", "ING Conto Arancio");
  const thisMonth = thisMonthOf(ctx);
  const lastMonth = lastMonthOf(ctx);
  // Never after today: the chart stops at today, so early in a month these figures would not be there.
  const upToToday = (day: string) => {
    const date = `${thisMonth}-${day}`;
    const on = today(ctx.timeZone);
    return date < on ? date : on;
  };
  await upsertFromProvider(
    ctx,
    accountId,
    [
      walletMovement("e2e-tx-1", upToToday("02"), -1299n, "Netflix", "Abbonamenti"),
      walletMovement("e2e-tx-2", upToToday("04"), -4550n, "Esselunga", "Spesa"),
      walletMovement("e2e-tx-3", upToToday("09"), -2100n, "Trenitalia", "Trasporti"),
      walletMovement("e2e-tx-4", upToToday("11"), 210000n, "Stipendio", null),
      walletMovement("e2e-tx-5", `${lastMonth}-12`, -1299n, "Netflix", "Abbonamenti"),
      // One leg of a giroconto whose other account is not linked here (F2.5): in the list, flagged as
      // unpaired, and in no total. Last month, so this month's figures stay what they were.
      walletMovement("e2e-tx-6", `${lastMonth}-15`, -50000n, "Revolut", null, "e2e-tx-7"),
    ],
    { provider: WALLET_PROVIDER },
  );
}

/**
 * The giroconti of decisions 6A–10A (2026-11-25), all last month on three Wallet accounts: one pair,
 * one leg outside, one waiting for its account, three that wait for the person to choose, two money out
 * each with two equal money in (four proposals), an expense and an income for a pair by hand, and two
 * expenses with and without a time of day. Synthetic names and amounts, each amount its own, so the
 * automatic pairing finds only what it is meant to.
 */
export async function seedGiroconti(): Promise<void> {
  const ctx = await contextOf(USERS.giroconti.email);
  const [one, two, three] = [
    await syncedAccount(ctx, "e2e-g-1", "Conto Uno"),
    await syncedAccount(ctx, "e2e-g-2", "Conto Due"),
    await syncedAccount(ctx, "e2e-g-3", "Conto Tre"),
  ];
  const day = (dd: string) => `${lastMonthOf(ctx)}-${dd}`;
  const read = (accountId: string, movements: ReturnType<typeof walletMovement>[]) =>
    upsertFromProvider(ctx, accountId, movements, { provider: WALLET_PROVIDER });
  const timed = walletMovement("g-time", day("12"), -1234n, "Morning bakery", null);
  const oneRows = [
    walletMovement("g-pair-out", day("03"), -10000n, "Pair out", null, "g-pair-in"),
    walletMovement("g-outside", day("04"), -2000n, "Gift out", null, "g-none-1"),
    walletMovement("g-waiting", day("06"), -3000n, "Wait out", null, "g-none-2"),
    walletMovement("g-second-in-a", day("15"), 6000n, "Second in A", null),
    walletMovement("g-hand-out", day("05"), -7700n, "Hand out", null),
    { ...timed, occurredAt: new Date(`${day("12")}T12:32:00Z`), timeKnown: true },
    walletMovement("g-no-time", day("13"), -1500n, "Corner kiosk", null),
  ];
  // The pairing runs after every reading: a money out read before both its equal money in would be
  // paired with the only one there. Each money out comes after its two candidates.
  await read(one, oneRows);
  await read(three, [
    walletMovement("g-in-b", day("10"), 5000n, "Proposal in B", null),
    walletMovement("g-second-in-b", day("15"), 6000n, "Second in B", null),
    walletMovement("g-hand-in", day("20"), 7700n, "Hand in", null),
  ]);
  await read(two, [
    walletMovement("g-pair-in", day("03"), 10000n, "Pair in", null, "g-pair-out"),
    walletMovement("g-choose", day("07"), -4000n, "Choose out", null, "g-none-4"),
    walletMovement("g-pick", day("08"), -4500n, "Pick out", null, "g-none-5"),
    walletMovement("g-leave", day("09"), -4600n, "Leave out", null, "g-none-6"),
    walletMovement("g-in-a", day("10"), 5000n, "Proposal in A", null),
    walletMovement("g-second", day("15"), -6000n, "Second out", null, "g-none-7"),
  ]);
  await read(one, [
    ...oneRows,
    walletMovement("g-proposal", day("10"), -5000n, "Proposal out", null, "g-none-3"),
  ]);
  const ids = new Map((await listTransactions(ctx, { limit: 100 })).map((row) => [row.payee ?? "", row.id]));
  await chooseTransferSide(ctx, ids.get("Gift out") ?? "", { kind: "outside" });
  await chooseTransferSide(ctx, ids.get("Wait out") ?? "", { kind: "account", accountId: three });
}

/**
 * Release N3 (ux/n3-categories-manual.md §9): what the manual movement's journey starts from. An
 * account kept by hand with a balance written five days ago, an account a bank only reads with the
 * balance read yesterday, two categories and one movement already written by hand, so the row with
 * its badge and its own menu is on screen for the check. The bank's account is tied to the plugin's
 * provider with nothing behind it: no connection, so no reading ever starts.
 */
export async function seedManual(email: string = USERS.manual.email): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  const cash = await createAccount(ctx, {
    name: "Contanti",
    type: "cash",
    currency: "EUR",
    openingBalance: { on: addDays(on, -5), cents: 8_000n },
  });
  const provider = pluginProvider(BANK_PLUGIN);
  await applyProviderAccounts(ctx, provider, [
    {
      provider,
      providerAccountId: "e2e-manual-bank-1",
      name: "Zeta Bank conto",
      type: "checking",
      currency: "EUR",
    },
  ]);
  const [bank] = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), eq(accounts.name, "Zeta Bank conto")));
  await saveProviderBalance(ctx, bank.id, { on: addDays(on, -1), cents: 100_000n });
  const bars = await createCategory(ctx, { name: "Ristoranti e bar", type: "expense" });
  await createCategory(ctx, { name: "Entrate", type: "income" });
  await createManual(ctx, {
    kind: "expense",
    amountCents: 1_250n,
    on: addDays(on, -2),
    accountId: cash.id,
    categoryId: bars.id,
    payee: "Edicola",
    note: "",
  });
}

/** `activate`: false for a user whose Wallet is off with its data here («Needs cleanup», H56). */
export async function seedSources(email: string = USERS.sources.email, activate = true): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  await createAccount(ctx, {
    name: "Contanti",
    type: "cash",
    currency: "EUR",
    openingBalance: { on: addDays(on, -5), cents: 8_000n },
  });
  const current = await syncedAccount(ctx, "e2e-sources-1", "Conto corrente app", "checking", activate);
  await upsertFromProvider(
    ctx,
    current,
    [
      walletMovement("e2e-sources-tx-1", addDays(on, -20), -8750n, "Esselunga Superstore", "Spesa"),
      walletMovement("e2e-sources-tx-2", addDays(on, -16), -4310n, "Mercato rionale", "Spesa"),
      walletMovement("e2e-sources-tx-3", addDays(on, -12), -1200n, "Tabaccheria Centrale", "Tabacchi"),
      walletMovement("e2e-sources-tx-4", addDays(on, -9), -600n, "Tabaccheria Centrale", "Tabacchi"),
      walletMovement("e2e-sources-tx-5", addDays(on, -8), -2300n, "Enoteca Rossi", "Alcolici e tabacchi"),
      walletMovement("e2e-sources-tx-6", addDays(on, -4), -3500n, "Zoo Market", "Animali"),
    ],
    { provider: WALLET_PROVIDER },
  );
  await saveProviderBalance(ctx, current, { on: addDays(on, -1), cents: 50_000n });
  const categories = await listCategories(ctx);
  const sourceCategories = await listSourceCategories(ctx);
  const named = (name: string) => sourceCategories.find((row) => row.name === name);
  // Every category has been looked at but the last to arrive, which keeps its "New" mark.
  for (const row of sourceCategories) if (row.name !== "Animali") await keepSourceCategory(ctx, row.id);
  const vices = categories.find((category) => category.name === "Alcolici e tabacchi");
  const tobacco = named("Tabacchi");
  if (!vices || !tobacco) throw new Error("The categories of the source were not adopted");
  await setSourceCategory(ctx, { id: tobacco.id, categoryId: vices.id });
  const groceries = categories.find((category) => category.name === "Spesa");
  await createManual(ctx, {
    kind: "expense",
    amountCents: 450n,
    on,
    accountId: current,
    categoryId: groceries?.id ?? null,
    payee: "Bar Centrale",
    note: "",
  });
  const refused = await createManual(ctx, {
    kind: "expense",
    amountCents: 200n,
    on: addDays(on, -1),
    accountId: current,
    categoryId: null,
    payee: "Edicola",
    note: "",
  });
  await markNotSent(ctx, refused.transaction.id);
}
