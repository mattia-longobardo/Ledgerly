// scripts/seed-e2e.ts — the e2e suite's users on the deployed site (tests/e2e/homelab.ts).
//
//   seed    removes any test users a failed run left behind, then creates them with their sample
//           data and writes the signed-in sessions the specs start from;
//   remove  deletes the test users; every row they own goes with them (ON DELETE CASCADE).
//
// Both touch only users whose address ends in `@example.test`: the site's real users and their
// data are never read or written here.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { eq, like } from "drizzle-orm";
import { applyProviderAccounts, createAccount, saveBalanceEntry } from "../src/modules/accounts/service";
import { createSubscription } from "../src/modules/subscriptions/service";
import { createFund, addDeposit, recordValuation } from "../src/modules/funds/service";
import { createPensionFund } from "../src/modules/funds/pension/service";
import {
  applyOperations,
  applyPosition,
  processCometaDocument,
  uploadCometaDocument,
} from "../src/modules/funds/pension/imports";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "../src/modules/payroll/service";
import { createRule } from "../src/modules/interests/service";
import { createToken } from "../src/platform/tokens/service";
import { EXPORT_AUGUST, POSITION_AUGUST } from "../tests/fixtures/cometa/samples";
import { twinOperationsHtml, twinPositionPdf } from "../tests/fixtures/cometa/twin";
import { APRIL, FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../tests/fixtures/payroll/samples";
import { twinPdf } from "../tests/fixtures/payroll/twin";
import { refreshRecurrences } from "../src/modules/transactions/jobs";
import { addToPocket, createPocket, recordWithdrawal } from "../src/modules/pockets/service";
import { saveAllowance, saveLeaveDay } from "../src/modules/timeoff/service";
import { accounts } from "../src/modules/accounts/schema";
import { setLimit } from "../src/modules/budgets/service";
import { upsertFromProvider } from "../src/modules/transactions/service";
import { listCategories } from "../src/modules/transactions/taxonomy";
import type { IncomingTransaction } from "../src/modules/transactions/rules";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addDays, addMonths, monthKey, today } from "../src/platform/dates";
import { getDb } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
import { isBookable } from "../src/platform/holidays/rules";
import { deleteFolder } from "../src/platform/storage";
import { WALLET_PROVIDER } from "../src/platform/integrations/rules";
import { BASE_URL, SESSIONS, STATE_DIR, TEST_EMAIL_DOMAIN, USERS, sessionState } from "../tests/e2e/env";

const mode = process.argv[2];
if (mode !== "seed" && mode !== "remove") throw new Error("usage: seed-e2e.ts seed|remove");

async function removeTestUsers(): Promise<void> {
  for (const user of Object.values(USERS)) {
    if (!user.email.endsWith(TEST_EMAIL_DOMAIN)) throw new Error(`Not a test address: ${user.email}`);
  }
  const removed = await getDb()
    .delete(users)
    .where(like(users.email, `%${TEST_EMAIL_DOMAIN}`))
    .returning({ id: users.id, email: users.email });
  // What they own outside the database, where no cascade reaches: the same three folders
  // `removePerson` clears (src/modules/users/admin.ts).
  for (const user of removed) {
    for (const folder of ["payslips", "cometa", "exports"]) {
      await deleteFolder(`${folder}/${user.id}/`);
    }
  }
  console.log(`e2e: removed ${removed.length} test users`);
  rmSync(STATE_DIR, { recursive: true, force: true });
}

await removeTestUsers();
if (mode === "remove") process.exit(0);

const auth = createAuth({ withNextCookies: false });
// The site already has its admin, so these are ordinary users — except `admin@example.test`,
// promoted below: Admin › Users and Admin › Server (F8) have no journey without one, and giving
// it its own user leaves every spec that signs in as an ordinary one saying what it means.
for (const user of Object.values(USERS)) {
  await auth.api.createUser({ body: user });
}
await getDb().update(users).set({ role: "admin" }).where(eq(users.email, USERS.admin.email));
mkdirSync(STATE_DIR, { recursive: true });

/**
 * A Playwright storage state holding one user's session cookie. Better Auth is called here as a
 * library rather than over HTTP, so setting these sessions up costs none of the run's rate-limited
 * sign-ins (tests/e2e/env.ts) and a spec that only needs to be signed in spends none either.
 */
async function writeSessionState(name: keyof typeof SESSIONS): Promise<void> {
  const user = USERS[SESSIONS[name].user];
  const { headers } = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const cookies = headers
    .getSetCookie()
    .map((header) => header.split(";")[0].split("="))
    .filter(([cookieName]) => cookieName.includes("session_token"))
    .map(([cookieName, ...value]) => ({
      name: cookieName,
      value: value.join("="),
      domain: new URL(BASE_URL).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    }));
  if (cookies.length === 0) throw new Error(`No session cookie for ${user.email}`);
  writeFileSync(sessionState(name), JSON.stringify({ cookies, origins: [] }, null, 2));
}

for (const name of Object.keys(SESSIONS) as (keyof typeof SESSIONS)[]) {
  await writeSessionState(name);
}

/**
 * The Expenses journey needs movements that arrived the way real ones do: a synced account adopted
 * through `applyProviderAccounts`, and transactions applied by `upsertFromProvider`. There is no
 * Wallet connection behind them, so the site's hourly sync has nothing to try for this user. Seeding through the services rather than with inserts means the journey
 * exercises the same path the hourly job uses — including the provider links that make it
 * idempotent — so a break in that path fails here too.
 */
/** The context of one of the test users, as the site would build it. */
async function contextOf(email: string): Promise<Ctx> {
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user for ${email}`);
  return { userId: user.id, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

/** A Wallet account adopted the way the sync adopts one; returns its id. */
async function syncedAccount(ctx: Ctx, providerAccountId: string, name: string): Promise<string> {
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    { provider: WALLET_PROVIDER, providerAccountId, name, type: "checking", currency: "EUR" },
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
function walletMovement(
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
const thisMonthOf = (ctx: Ctx) => monthKey(today(ctx.timeZone)).slice(0, 7);
const lastMonthOf = (ctx: Ctx) => addMonths(monthKey(today(ctx.timeZone)), -1).slice(0, 7);

async function seedExpenses(): Promise<void> {
  const ctx = await contextOf(USERS.expenses.email);
  const accountId = await syncedAccount(ctx, "e2e-acc-1", "ING Conto Arancio");
  const thisMonth = thisMonthOf(ctx);
  const lastMonth = lastMonthOf(ctx);
  await upsertFromProvider(ctx, accountId, [
    walletMovement("e2e-tx-1", `${thisMonth}-02`, -1299n, "Netflix", "Abbonamenti"),
    walletMovement("e2e-tx-2", `${thisMonth}-04`, -4550n, "Esselunga", "Spesa"),
    walletMovement("e2e-tx-3", `${thisMonth}-09`, -2100n, "Trenitalia", "Trasporti"),
    walletMovement("e2e-tx-4", `${thisMonth}-11`, 210000n, "Stipendio", null),
    walletMovement("e2e-tx-5", `${lastMonth}-12`, -1299n, "Netflix", "Abbonamenti"),
    // One leg of a giroconto whose other account is not linked here (F2.5): in the list, flagged as
    // unpaired, and in no total. Last month, so this month's figures stay what they were.
    walletMovement("e2e-tx-6", `${lastMonth}-15`, -50000n, "Revolut", null, "e2e-tx-7"),
  ]);
}

/**
 * Budgets (F3): this month's spending in four categories, three of them with a limit from this
 * month — one on track, one near its limit, one over it — and a giroconto that must count in none.
 */
async function seedBudgets(): Promise<void> {
  const ctx = await contextOf(USERS.budgets.email);
  const accountId = await syncedAccount(ctx, "e2e-bud-1", "ING Conto Arancio");
  const thisMonth = thisMonthOf(ctx);
  await upsertFromProvider(ctx, accountId, [
    walletMovement("e2e-bud-tx-1", `${thisMonth}-01`, -4550n, "Esselunga", "Spesa"),
    walletMovement("e2e-bud-tx-2", `${thisMonth}-01`, -4800n, "Da Mario", "Ristoranti"),
    walletMovement("e2e-bud-tx-3", `${thisMonth}-01`, -2100n, "Trenitalia", "Trasporti"),
    walletMovement("e2e-bud-tx-4", `${thisMonth}-01`, -1299n, "Netflix", "Abbonamenti"),
    walletMovement("e2e-bud-tx-5", `${thisMonth}-01`, -30000n, "Revolut", "Trasporti", "e2e-bud-tx-6"),
  ]);
  const byName = new Map((await listCategories(ctx)).map((category) => [category.name, category.id]));
  const month = `${thisMonth}-01`;
  for (const [name, cents] of [
    ["Spesa", 10000n],
    ["Ristoranti", 5000n],
    ["Trasporti", 2000n],
  ] as const) {
    await setLimit(ctx, { categoryId: byName.get(name)!, accountId: null, month, cents });
  }
}

/**
 * Pockets (F3): a savings account holding 10.000 €, a pocket with a target resting on it
 * (250 € a month + 3.850 € added − 850 € withdrawn = 3.250 €, three months to its 4.000 €), and a
 * standalone envelope with no target that has only its first 50 € accrual.
 */
async function seedPockets(): Promise<void> {
  const ctx = await contextOf(USERS.pockets.email);
  const on = today(ctx.timeZone);
  const account = await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: { on, cents: 1_000_000n },
  });
  const startMonth = `${thisMonthOf(ctx)}-01`;
  const holidays = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: account.id,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth,
  });
  await addToPocket(ctx, holidays.id, { cents: 385_000n, on });
  await recordWithdrawal(ctx, holidays.id, { cents: 85_000n, on, reason: "Ischia — hotel + traghetto" });
  await createPocket(ctx, {
    name: "Gifts",
    color: null,
    backingAccountId: null,
    targetCents: null,
    monthlyCents: 5_000n,
    startMonth,
  });
}

/**
 * Subscriptions (F3): three plans paid from one synced account holding 1.500 € — Netflix found at
 * its price today, Spotify found at 12,99 € against a plan of 10,99 € (amount differs), Amazon
 * Prime due in three days and not found yet — and a gym charged monthly for three months that no
 * subscription covers, for "Suggest from recurring payments".
 */
async function seedSubscriptions(): Promise<void> {
  const ctx = await contextOf(USERS.subscriptions.email);
  const accountId = await syncedAccount(ctx, "e2e-sub-1", "Revolut Main");
  const on = today(ctx.timeZone);
  await saveBalanceEntry(ctx, accountId, { on, cents: 150_000n });
  await upsertFromProvider(ctx, accountId, [
    walletMovement("e2e-sub-tx-1", on, -1299n, "NETFLIX.COM", "Streaming"),
    walletMovement("e2e-sub-tx-2", on, -1299n, "Spotify AB", "Streaming"),
    walletMovement("e2e-sub-tx-3", addDays(on, -90), -2990n, "FitActive", "Sport"),
    walletMovement("e2e-sub-tx-4", addDays(on, -60), -2990n, "FitActive", "Sport"),
    walletMovement("e2e-sub-tx-5", addDays(on, -30), -2990n, "FitActive", "Sport"),
  ]);
  await refreshRecurrences(ctx);
  // The two streaming ones carry the category the movements created, so the table has a category
  // tag with a colour in it to check (F8.1); Amazon Prime deliberately keeps none.
  const streaming = (await listCategories(ctx)).find((one) => one.name === "Streaming");
  const base = { categoryId: null, paymentAccountId: accountId, tolerance: "0.05" };
  await createSubscription(ctx, {
    ...base,
    categoryId: streaming?.id ?? null,
    name: "Netflix",
    utility: 8,
    priceCents: 1299n,
    cycle: "monthly",
    nextChargeOn: on,
    payeeMatch: "netflix",
  });
  await createSubscription(ctx, {
    ...base,
    categoryId: streaming?.id ?? null,
    name: "Spotify",
    utility: 9,
    priceCents: 1099n,
    cycle: "monthly",
    nextChargeOn: on,
    payeeMatch: "spotify",
  });
  await createSubscription(ctx, {
    ...base,
    name: "Amazon Prime",
    utility: 4,
    priceCents: 4990n,
    cycle: "yearly",
    nextChargeOn: addDays(on, 3),
    payeeMatch: "amazon",
  });
}

/**
 * Interests (F4): a savings account that has held 10.000,00 € since before last month, so a 3,65 %
 * rule on 365 days earns exactly 1,00 € a day and last month's payout is its number of days.
 */
async function seedInterests(): Promise<void> {
  const ctx = await contextOf(USERS.interests.email);
  await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(addMonths(monthKey(today(ctx.timeZone)), -1), -1), cents: 1_000_000n },
  });
}

/**
 * Funds (F4): a synced current account with two Fideuram direct debits of 251,00 €, on the 5th of
 * the two months before this one, for the deposit rule to turn into deposits.
 */
async function seedFunds(): Promise<void> {
  const ctx = await contextOf(USERS.funds.email);
  const accountId = await syncedAccount(ctx, "e2e-fund-1", "ING Conto Arancio");
  const thisMonth = monthKey(today(ctx.timeZone));
  await upsertFromProvider(ctx, accountId, [
    walletMovement(
      "e2e-fund-tx-1",
      `${addMonths(thisMonth, -2).slice(0, 7)}-05`,
      -25100n,
      "FIDEURAM PAC SDD",
      "Investimenti",
    ),
    walletMovement(
      "e2e-fund-tx-2",
      `${addMonths(thisMonth, -1).slice(0, 7)}-05`,
      -25100n,
      "FIDEURAM PAC SDD",
      "Investimenti",
    ),
  ]);
}

/**
 * Time off (F7): the year's allowance and three days off in it — one taken, one planned, and half
 * a day of ROL — so the cards, the calendar and both table filters all have something to show.
 * The dates are worked out from today so the seed does not go stale, and only working days are
 * booked: the service refuses anything else.
 */
async function seedTimeOff(): Promise<void> {
  const ctx = await contextOf(USERS.timeoff.email);
  const on = today(ctx.timeZone);
  const year = Number(on.slice(0, 4));
  // Days for both kinds since N9, and no carry-over to state: that one comes from the payslip.
  await saveAllowance(ctx, year, { vacationDays: 26, rolDays: 4, note: "CCNL" });
  await saveLeaveDay(ctx, { from: workingDay(on, -14), kind: "vacation", fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, 21), kind: "vacation", fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, -7), kind: "rol", fraction: 0.5 });
}

/** The first bookable day at least `delta` days from `from`, walking the same way as `delta`. */
function workingDay(from: string, delta: number): string {
  const step = delta >= 0 ? 1 : -1;
  let date = addDays(from, delta);
  while (!isBookable(date)) date = addDays(date, step);
  return date;
}

/**
 * The layout and accessibility check (tests/e2e/a11y.spec.ts) opens every screen of the app, and a
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
async function seedLayout(): Promise<void> {
  const ctx = await contextOf(USERS.layout.email);
  const on = today(ctx.timeZone);
  const thisMonth = thisMonthOf(ctx);
  const lastMonth = lastMonthOf(ctx);

  // ——— Accounts, movements and categories: Overview, Accounts, Expenses, Categories ———
  const current = await syncedAccount(ctx, "e2e-layout-1", "ING Conto Arancio");
  await saveBalanceEntry(ctx, current, { on, cents: 412_350n });
  await upsertFromProvider(ctx, current, [
    walletMovement("e2e-layout-tx-1", `${thisMonth}-02`, -1299n, "Netflix", "Abbonamenti"),
    walletMovement("e2e-layout-tx-2", `${thisMonth}-03`, -8750n, "Esselunga Superstore", "Spesa"),
    walletMovement("e2e-layout-tx-3", `${thisMonth}-05`, -2100n, "Trenitalia", "Trasporti"),
    walletMovement("e2e-layout-tx-4", `${thisMonth}-07`, -4800n, "Ristorante Da Mario", "Ristoranti"),
    walletMovement("e2e-layout-tx-5", `${thisMonth}-09`, -6500n, "Farmacia Comunale 3", "Salute"),
    walletMovement("e2e-layout-tx-6", `${thisMonth}-11`, 210_000n, "Stipendio", null),
    walletMovement("e2e-layout-tx-7", `${thisMonth}-14`, -3490n, "Amazon Marketplace", "Casa"),
    walletMovement("e2e-layout-tx-8", `${lastMonth}-12`, -1299n, "Netflix", "Abbonamenti"),
    walletMovement("e2e-layout-tx-9", `${lastMonth}-18`, -9120n, "Esselunga Superstore", "Spesa"),
    // An unpaired giroconto leg: flagged in the list and counted in no total (F2.5).
    walletMovement("e2e-layout-tx-10", `${lastMonth}-22`, -50_000n, "Revolut", null, "e2e-layout-tx-11"),
  ]);

  const savings = await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "Emergenze",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(addMonths(monthKey(on), -1), -1), cents: 1_000_000n },
  });

  // ——— Budgets ———
  const byName = new Map((await listCategories(ctx)).map((category) => [category.name, category.id]));
  for (const [name, cents] of [
    ["Spesa", 15_000n],
    ["Ristoranti", 5_000n],
    ["Trasporti", 2_000n],
    ["Salute", 8_000n],
  ] as const) {
    const categoryId = byName.get(name);
    if (categoryId) {
      await setLimit(ctx, { categoryId, accountId: null, month: `${thisMonth}-01`, cents });
    }
  }

  // ——— Pockets ———
  const startMonth = `${thisMonth}-01`;
  const holidays = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: savings.id,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth,
  });
  await addToPocket(ctx, holidays.id, { cents: 385_000n, on });
  await recordWithdrawal(ctx, holidays.id, { cents: 85_000n, on, reason: "Ischia — hotel e traghetto" });
  await createPocket(ctx, {
    name: "Gifts",
    color: null,
    backingAccountId: null,
    targetCents: null,
    monthlyCents: 5_000n,
    startMonth,
  });

  // ——— Subscriptions ———
  await upsertFromProvider(ctx, current, [
    walletMovement("e2e-layout-sub-1", addDays(on, -90), -2990n, "FitActive", "Sport"),
    walletMovement("e2e-layout-sub-2", addDays(on, -60), -2990n, "FitActive", "Sport"),
    walletMovement("e2e-layout-sub-3", addDays(on, -30), -2990n, "FitActive", "Sport"),
  ]);
  await refreshRecurrences(ctx);
  const streaming = (await listCategories(ctx)).find((one) => one.name === "Abbonamenti");
  const plan = { categoryId: streaming?.id ?? null, paymentAccountId: current, tolerance: "0.05" };
  await createSubscription(ctx, {
    ...plan,
    name: "Netflix",
    utility: 8,
    priceCents: 1299n,
    cycle: "monthly",
    nextChargeOn: addDays(on, 12),
    payeeMatch: "netflix",
  });
  await createSubscription(ctx, {
    ...plan,
    name: "Spotify Premium Family",
    utility: 9,
    priceCents: 1799n,
    cycle: "monthly",
    nextChargeOn: addDays(on, 4),
    payeeMatch: "spotify",
  });
  await createSubscription(ctx, {
    ...plan,
    categoryId: null,
    name: "Amazon Prime",
    utility: 4,
    priceCents: 4990n,
    cycle: "yearly",
    nextChargeOn: addDays(on, 3),
    payeeMatch: "amazon",
  });

  // ——— Interests: a rule on the savings account, accrued and settled up to today ———
  await createRule(ctx, {
    accountId: savings.id,
    taxRate: "0.26",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: addDays(addMonths(monthKey(on), -1), -1),
    mode: "analyze_only",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });

  // ——— An investment PAC with its deposits and valuations ———
  const pac = await createFund(ctx, {
    name: "Fideuram Master Selection",
    provider: "Fideuram",
    isin: "IT0005247157",
    compartment: "Bilanciato",
    debitAccountId: current,
    debitDay: 5,
    ter: "0.0185",
    startOn: `${addMonths(monthKey(on), -6).slice(0, 7)}-05`,
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
    valuationAccountId: null,
  });
  for (const back of [5, 4, 3, 2, 1]) {
    await addDeposit(ctx, pac.id, {
      on: `${addMonths(monthKey(on), -back).slice(0, 7)}-05`,
      chargedCents: 25_100n,
      feeCents: 100n,
      note: null,
    });
  }
  for (const [back, cents] of [
    [4, 50_400n],
    [3, 76_100n],
    [2, 99_800n],
    [1, 128_200n],
    [0, 153_900n],
  ] as const) {
    await recordValuation(ctx, pac.id, {
      // The 28th of each month, except this one's, which is valued today: a valuation in the
      // future is refused, and on the 21st the 28th has not happened yet.
      on: back === 0 ? on : `${addMonths(monthKey(on), -back).slice(0, 7)}-28`,
      cents,
      units: null,
      note: null,
    });
  }

  // ——— Payroll: the synthetic twins of a whole year, read, verified and applied ———
  for (const twin of [JANUARY, FEBRUARY, MARCH, APRIL, THIRTEENTH]) {
    const { document } = await uploadPayslip(ctx, {
      name: `${twin.period.replace(/\s+/g, "-").toLowerCase()}.pdf`,
      bytes: await twinPdf(twin),
    });
    await processPayslip(ctx, document.id);
    await verifyPayslip(ctx, document.id);
    await applyPayslip(ctx, document.id);
  }

  // ——— The pension fund, its operations export and its statement ———
  const pension = await createPensionFund(ctx, {
    name: "Cometa",
    provider: "Cometa",
    compartment: "Crescita",
    startOn: "2031-01-01",
    receivesPayroll: true,
  });
  const operations = await uploadCometaDocument(ctx, "cometa_operations", {
    name: "DettaglioOperazioni.xls",
    bytes: twinOperationsHtml(EXPORT_AUGUST),
  });
  await processCometaDocument(ctx, operations.document.id);
  await applyOperations(ctx, pension.id, operations.document.id);
  const position = await uploadCometaDocument(ctx, "cometa_position", {
    name: "riepilogo_posizione.pdf",
    bytes: await twinPositionPdf(POSITION_AUGUST),
  });
  await processCometaDocument(ctx, position.document.id);
  await applyPosition(ctx, pension.id, position.document.id);

  // ——— Time off ———
  const year = Number(on.slice(0, 4));
  await saveAllowance(ctx, year, { vacationDays: 26, rolDays: 4, note: "CCNL Metalmeccanici" });
  await saveLeaveDay(ctx, { from: workingDay(on, -14), kind: "vacation", fraction: 1 });
  await saveLeaveDay(ctx, { from: workingDay(on, -7), kind: "rol", fraction: 0.5 });
  await saveLeaveDay(ctx, { from: workingDay(on, 21), kind: "vacation", fraction: 1 });

  // ——— A personal access token, so Settings › Data has a row rather than its empty state ———
  await createToken(ctx, { name: "Home Assistant", scopes: ["read"], expiresInDays: 365 });
}

await seedExpenses();
await seedBudgets();
await seedPockets();
await seedSubscriptions();
await seedInterests();
await seedFunds();
await seedTimeOff();
await seedLayout();
console.log(`e2e: seeded ${Object.keys(USERS).length} test users`);

process.exit(0);
