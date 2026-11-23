// scripts/seed-e2e/common.ts — the builders every flow's seed uses: a person's context, an account a provider
// syncs, a movement as Wallet sends it, this month and the last one, a working day, and the
// exchange rates of a local preview.
import { eq } from "drizzle-orm";
import { accounts } from "@domain/modules/accounts/schema";
import { applyProviderAccounts } from "@domain/modules/accounts/service";
import { type IncomingTransaction } from "@domain/modules/transactions/rules";
import { users } from "@domain/platform/auth/schema";
import { type Ctx } from "@domain/platform/context";
import { addDays, addMonths, monthKey, today } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import { saveRates, storedRange } from "@domain/platform/fx/service";
import { isBookable } from "@domain/platform/holidays/rules";
import { WALLET_PROVIDER } from "../../test/fixtures/providers";

/**
 * The Expenses journey needs movements that arrived the way real ones do: a synced account adopted
 * through `applyProviderAccounts`, and transactions applied by `upsertFromProvider`. There is no
 * Wallet connection behind them, so the site's hourly sync has nothing to try for this user. Seeding through the services rather than with inserts means the journey
 * exercises the same path the hourly job uses — including the provider links that make it
 * idempotent — so a break in that path fails here too.
 */
/** The context of one of the test users, as the site would build it. */
export async function contextOf(email: string): Promise<Ctx> {
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user for ${email}`);
  return {
    userId: user.id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

/** A Wallet account adopted the way the sync adopts one; returns its id. */
export async function syncedAccount(
  ctx: Ctx,
  providerAccountId: string,
  name: string,
  type: "checking" | "investment" = "checking",
): Promise<string> {
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    { provider: WALLET_PROVIDER, providerAccountId, name, type, currency: "EUR" },
  ]);
  const found = (
    await getDb()
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(userScoped(ctx).owns(accounts))
  ).find((account) => account.name === name);
  if (!found) throw new Error("The provider account was not adopted");
  return found.id;
}

/** One movement as Wallet hands it over; a counterpart makes it a giroconto leg. */
export function walletMovement(
  externalId: string,
  on: string,
  cents: bigint,
  payee: string,
  category: string | null,
  counterpartExternalId: string | null = null,
): IncomingTransaction {
  return {
    externalId,
    counterpartExternalId,
    occurredAt: new Date(`${on}T10:00:00Z`),
    amountCents: cents,
    currency: "EUR",
    type: counterpartExternalId !== null ? "transfer" : cents < 0n ? "expense" : "income",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: category === null ? null : `cat-${category.toLowerCase()}`,
    categoryName: category,
    // No groups here: the journeys check category rows one at a time.
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  };
}

/**
 * Dates are derived from today rather than written down: the pages open on the current month, so a
 * fixed month would make a journey pass until that month went by and then fail as though the page
 * were broken.
 */
export const thisMonthOf = (ctx: Ctx) => monthKey(today(ctx.timeZone)).slice(0, 7);

export const lastMonthOf = (ctx: Ctx) => addMonths(monthKey(today(ctx.timeZone)), -1).slice(0, 7);

/**
 * The first bookable day at least `delta` days from `from`, walking the same way as `delta`.
 *
 * Milan's patron saint is left out as well: `holidays.spec.ts` subscribes this user to Milan's
 * calendar and then looks at 7 December, which must not be a day the seed happened to book — as it
 * was whenever the suite ran three weeks before it.
 */
export function workingDay(from: string, delta: number): string {
  const step = delta >= 0 ? 1 : -1;
  let date = addDays(from, delta);
  while (!isBookable(date, { month: 12, day: 7 })) date = addDays(date, step);
  return date;
}

/**
 * The layout and accessibility check (tests/e2e/<flow>/a11y.spec.ts) opens every screen of the app, and a
 * screen opened on an empty state measures an empty state: the fault the check is looking for —
 * a table reaching past a phone's window, a figure spilling out of its card — only appears once
 * there is something to lay out. So this one user is given something on every page.
 *
 * The module journeys keep their own users, which start empty because their first step says so
 * ("No accounts yet", "No investment funds", "No payslips yet"): filling those would break them,
 * which is why the data lives here instead, on a user nothing else drives.
 *
 * Everything is written through the services, like the rest of this seed: a row no service would
 * write lays out a screen that does not exist.
 */
/**
 * The exchange rates of a local preview. The site has the ECB's own, read by its job; the test
 * database has none, and a value in USD would have no figure in EUR. One invented fixing, years
 * back, is the rate of every day after it. Never on the site, and never next to a real rate: a row
 * of `fx_rates` is kept for ever.
 */
export async function seedPreviewRates(): Promise<void> {
  if (!process.env.E2E_BASE_URL) return;
  if ((await storedRange()).latest !== null) return;
  await saveRates([{ on: "2020-01-02", currency: "USD", eurPerUnit: "0.9000000000" }]);
}
