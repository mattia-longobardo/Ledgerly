// scripts/seed-e2e.ts — the e2e suite's users on the deployed site (tests/e2e/homelab.ts).
//
//   seed    removes any test users a failed run left behind, then creates them with their sample
//           data and writes the signed-in sessions the specs start from;
//   remove  deletes the test users; every row they own goes with them (ON DELETE CASCADE).
//
// Both touch only users whose address ends in `@example.test`: the site's real users and their
// data are never read or written here.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { and, eq, isNull, like } from "drizzle-orm";
import {
  addConnection,
  applyProviderAccounts,
  createAccount,
  saveBalanceEntry,
} from "../src/modules/accounts/service";
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
import { EXPORT_AUGUST, POSITION_AUGUST } from "../tests/fixtures/cometa/samples";
import { twinOperationsHtml, twinPositionPdf } from "../tests/fixtures/cometa/twin";
import { APRIL, FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../tests/fixtures/payroll/samples";
import { twinPdf } from "../tests/fixtures/payroll/twin";
import { refreshRecurrences } from "../src/modules/transactions/jobs";
import { addPlannedExpense, addToPocket, createPocket, linkExpense } from "../src/modules/pockets/service";
import { expenseLinkCandidates } from "../src/modules/pockets/queries";
import {
  addAsset,
  createManualService,
  ensureAssetSeed,
  listAssets,
  recordOperation,
} from "../src/modules/investments/service";
import { serviceDetail } from "../src/modules/investments/queries";
import { connectInvestmentProvider, setSourcesForTests } from "../src/modules/investments/sync";
import { parseDecimal, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE } from "../src/modules/investments/rules";
import { linkCandidates } from "../src/modules/transactions/queries";
import { saveAllowance, saveLeaveDay } from "../src/modules/timeoff/service";
import { accounts } from "../src/modules/accounts/schema";
import { setLimit } from "../src/modules/budgets/service";
import { upsertFromProvider } from "../src/modules/transactions/service";
import { listCategories } from "../src/modules/transactions/taxonomy";
import type { IncomingTransaction } from "../src/modules/transactions/rules";
import { createAuth } from "../src/platform/auth/auth";
import { oauthClients } from "../src/platform/auth/oauth/schema";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addDays, addMonths, monthKey, today } from "../src/platform/dates";
import { getDb } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
import { isBookable } from "../src/platform/holidays/rules";
import { deleteFolder } from "../src/platform/storage";
import { PAPERLESS_PROVIDER, WALLET_PROVIDER } from "../src/platform/integrations/rules";
import { listConnections, saveConnection, saveSchedule } from "../src/platform/integrations/service";
import {
  BASE_URL,
  E2E_MCP_CLIENT_NAME,
  SESSIONS,
  STATE_DIR,
  TEST_EMAIL_DOMAIN,
  TOTP_FILE,
  USERS,
  WITHOUT_TOTP,
  sessionState,
} from "../tests/e2e/env";
import { totpCode } from "../tests/e2e/totp";

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
  // The MCP spec registers a public client the way Claude would: it has no owner, so no cascade
  // reaches it. Only that exact name, and only without an owner.
  await getDb()
    .delete(oauthClients)
    .where(and(eq(oauthClients.name, E2E_MCP_CLIENT_NAME), isNull(oauthClients.userId)));
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

/** A `cookie` request header from the cookies a response set. */
function cookieHeader(headers: Headers): Headers {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; "),
  });
}

/**
 * Turns TOTP on the way a person does on the setup page — password, secret, first code — so the
 * site's TWO_FACTOR_POLICY=required lets these users in. Returns the base32 secret for the specs.
 */
async function setUpTotp(user: { email: string; password: string }): Promise<string> {
  const { headers } = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const signedIn = cookieHeader(headers);
  const enabled = await auth.api.enableTwoFactor({ body: { password: user.password }, headers: signedIn });
  if (!("totpURI" in enabled) || !enabled.totpURI) throw new Error(`No TOTP URI for ${user.email}`);
  const secret = new URL(enabled.totpURI).searchParams.get("secret");
  if (!secret) throw new Error(`No TOTP secret for ${user.email}`);
  await auth.api.verifyTOTP({ body: { code: await totpCode(secret) }, headers: signedIn });
  return secret;
}

const totpSecrets: Record<string, string> = {};
for (const [name, user] of Object.entries(USERS) as [
  keyof typeof USERS,
  (typeof USERS)[keyof typeof USERS],
][]) {
  if (!WITHOUT_TOTP.has(name)) totpSecrets[user.email] = await setUpTotp(user);
}
writeFileSync(TOTP_FILE, JSON.stringify(totpSecrets, null, 2));

/**
 * A Playwright storage state holding one user's session cookie. Better Auth is called here as a
 * library rather than over HTTP, so setting these sessions up costs none of the run's rate-limited
 * sign-ins (tests/e2e/env.ts) and a spec that only needs to be signed in spends none either.
 */
async function writeSessionState(name: keyof typeof SESSIONS): Promise<void> {
  const user = USERS[SESSIONS[name].user];
  const signIn = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  let headers = signIn.headers;
  // With TOTP the password opens no session: the code does, through the challenge cookie.
  if (signIn.response && "twoFactorRedirect" in signIn.response) {
    const verified = await auth.api.verifyTOTP({
      body: { code: await totpCode(totpSecrets[user.email]) },
      headers: cookieHeader(headers),
      returnHeaders: true,
    });
    headers = verified.headers;
  }
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
 * Pockets (F3): a synced savings account holding 10.000 €, a pocket with a target resting on it
 * (250 € a month + 3.850 € added − the account's 850 € expense = 3.250 €, three months to its
 * 4.000 €) with a planned expense of 400 €, and a standalone envelope with no target holding its
 * first 50 € accrual and nothing linked yet — a 30 € expense of another account waits to be linked.
 */
async function seedPockets(): Promise<void> {
  const ctx = await contextOf(USERS.pockets.email);
  const on = today(ctx.timeZone);
  const account = await syncedAccount(ctx, "e2e-pockets-1", "Revolut Saving");
  await saveBalanceEntry(ctx, account, { on, cents: 1_000_000n });
  await upsertFromProvider(ctx, account, [
    walletMovement("e2e-pockets-tx-1", on, -85_000n, "Ischia — hotel + traghetto", null),
  ]);
  const main = await syncedAccount(ctx, "e2e-pockets-2", "Revolut Main");
  await saveBalanceEntry(ctx, main, { on, cents: 200_000n });
  await upsertFromProvider(ctx, main, [
    walletMovement("e2e-pockets-tx-2", on, -3_000n, "Libreria Feltrinelli", null),
  ]);
  const startMonth = `${thisMonthOf(ctx)}-01`;
  const holidays = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: account,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth,
  });
  await addToPocket(ctx, holidays.id, { cents: 385_000n, on });
  await addPlannedExpense(ctx, holidays.id, {
    cents: 40_000n,
    dueOn: addDays(on, 20),
    description: "Hotel Roma",
  });
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
 * Investments: no service yet — the journey creates its manual account — and the two bank movements
 * a deposit and a withdrawal can be linked to: 2.000 € sent to eToro ten days ago, 2.401,58 € back five
 * days ago, on a synced account.
 */
async function seedInvestments(): Promise<void> {
  const ctx = await contextOf(USERS.investments.email);
  const on = today(ctx.timeZone);
  const account = await syncedAccount(ctx, "e2e-investments-1", "ING Conto Arancio");
  await saveBalanceEntry(ctx, account, { on, cents: 500_000n });
  await upsertFromProvider(ctx, account, [
    walletMovement("e2e-investments-tx-1", addDays(on, -10), -200_000n, "Bonifico eToro", null),
    walletMovement("e2e-investments-tx-2", addDays(on, -5), 240_158n, "Accredito eToro", null),
  ]);
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
/**
 * The display-currency journey (docs/design/investments.md §1.8): one account in EUR and one in
 * USD. The USD one is converted at the site's own ECB rates (`fx_rates`), so the spec checks the
 * currency of the totals, never a converted figure.
 */
async function seedCurrency(): Promise<void> {
  const ctx = await contextOf(USERS.currency.email);
  const on = addDays(today(ctx.timeZone), -3);
  for (const [name, type, currency] of [
    ["Conto EUR", "checking", "EUR"],
    ["Broker USD", "investment", "USD"],
  ] as const) {
    await createAccount(ctx, {
      name,
      type,
      currency,
      color: null,
      reference: "",
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: { on, cents: 1_000_00n },
    });
  }
}

/**
 * A connected eToro service (docs/design/investments.md §3.3) for the screens of phase 3: the
 * connection is made through `connectInvestmentProvider` with a stand-in for eToro, so nothing is
 * sent anywhere, and its schedule is manual, so the dispatcher never tries the made-up key.
 */
async function seedEtoro(ctx: Ctx, on: string): Promise<void> {
  const asset = (symbol: string, name: string, kind: "stock" | "etf") => ({
    externalId: `instrument:${symbol}`,
    class: kind,
    name,
    symbol,
    currency: "USD",
  });
  const now = new Date();
  setSourcesForTests(() => ({
    verifyReadOnly: async () => ({
      result: "read-only",
      permissions: { "etoro-public:trade.real:read": true, "etoro-public:money.balance:read": true },
      ipRestricted: null,
      externalAccountId: "900001",
    }),
    fetchHoldings: async () => ({
      observedAt: now,
      externalAccountId: "900001",
      totalCents: 512_345n,
      cashCents: 12_345n,
      positions: [
        {
          asset: asset("AAPL", "Apple", "stock"),
          product: "trading",
          quantity: "10",
          price: "230.5",
          priceCurrency: "USD",
          priceSource: "etoro",
          valueCents: 230_500n,
        },
        {
          asset: asset("VOO", "Vanguard S&P 500 ETF", "etf"),
          product: "copy",
          quantity: "0.5",
          price: "540",
          priceCurrency: "USD",
          priceSource: "etoro",
          valueCents: 269_500n,
        },
      ],
      scopes: [
        { product: "cash", complete: true },
        { product: "copy", complete: true },
        { product: "trading", complete: true },
      ],
      empty: false,
      complete: true,
    }),
    fetchFlows: async () => ({
      events: [
        {
          externalId: "cash:e2e-1",
          occurredAt: new Date(`${addDays(on, -5)}T09:00:00Z`),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: null,
              product: null,
              quantity: null,
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "5000",
              nativeCurrency: "USD",
            },
          ],
        },
      ],
      coverage: [
        {
          stream: "trades",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: now,
          status: "complete",
          reason: null,
        },
        {
          stream: "deposits",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: new Date(`${addDays(on, -5)}T09:00:00Z`),
          status: "partial",
          reason: "before_first_movement",
        },
        {
          stream: "deposits",
          fromAt: new Date(`${addDays(on, -5)}T09:00:00Z`),
          toAt: now,
          status: "complete",
          reason: null,
        },
      ],
    }),
    fetchHistory: async () => ({
      points: [
        { on: addDays(on, -2), totalCents: 500_000n },
        { on: addDays(on, -1), totalCents: 505_000n },
      ],
      coverage: [
        {
          stream: "balance_history",
          fromAt: new Date("2020-01-01T00:00:00Z"),
          toAt: new Date(`${addDays(on, -2)}T00:00:00Z`),
          status: "gap",
          reason: "api_limit_12m",
        },
        {
          stream: "balance_history",
          fromAt: new Date(`${addDays(on, -2)}T00:00:00Z`),
          toAt: now,
          status: "complete",
          reason: null,
        },
      ],
    }),
  }));
  try {
    await connectInvestmentProvider(
      ctx,
      "etoro",
      { api_key: "e2e-not-a-key-0001", user_key: "e2e-not-a-key-0002" },
      { kind: "new", name: "eToro", currency: "USD" },
    );
  } finally {
    setSourcesForTests(null);
  }
  const etoro = (await listConnections(ctx)).find((one) => one.provider === "etoro");
  if (!etoro) throw new Error("e2e: the eToro connection is missing");
  await saveSchedule(ctx, etoro.id, { rules: [] });
}

/**
 * A connected Binance service (docs/design/investments.md §3.2) for the screens of phase 4: a
 * stand-in for the exchange, as for eToro, with a wallet the adapter does not read (B4), the
 * streams of D18 and the 24-month gap (D11), and a manual schedule.
 */
async function seedBinance(ctx: Ctx, on: string): Promise<void> {
  const coin = (symbol: string, name: string, kind: "crypto" | "stablecoin" = "crypto") => ({
    externalId: symbol,
    class: kind,
    name,
    symbol,
    currency: kind === "stablecoin" ? "USD" : "EUR",
  });
  const now = new Date();
  const from = new Date(now.getTime() - 730 * 86_400_000);
  const at = (days: number) => new Date(`${addDays(on, -days)}T10:00:00Z`);
  const streams = [
    "deposits",
    "withdrawals",
    "fiat_orders",
    "fiat_payments",
    "convert",
    "dividends",
    "trades",
  ];
  setSourcesForTests(() => ({
    verifyReadOnly: async () => ({
      result: "read-only",
      permissions: { enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false },
      ipRestricted: true,
      externalAccountId: null,
    }),
    fetchHoldings: async () => ({
      observedAt: now,
      externalAccountId: "900032",
      totalCents: 2_250_000n,
      cashCents: 0n,
      positions: [
        {
          asset: coin("BTC", "Bitcoin"),
          product: "spot",
          quantity: "0.0125",
          price: "95000",
          priceCurrency: "EUR",
          priceSource: "binance:BTC/EUR",
          valueCents: 118_750n,
        },
        {
          asset: coin("ETH", "Ethereum"),
          product: "earn",
          quantity: "0.4",
          price: "2100",
          priceCurrency: "EUR",
          priceSource: "binance:ETH/EUR",
          valueCents: 84_000n,
        },
        {
          asset: coin("USDT", "Tether", "stablecoin"),
          product: "funding",
          quantity: "250",
          price: "0.8969",
          priceCurrency: "EUR",
          priceSource: "binance:EUR/USDT",
          valueCents: 22_250n,
        },
      ],
      scopes: [
        { product: "spot", complete: true },
        { product: "funding", complete: true },
        { product: "earn", complete: true },
        { product: "other:cross-margin", complete: false },
      ],
      empty: false,
      complete: false,
    }),
    fetchFlows: async () => ({
      events: [
        {
          externalId: "fiat:e2e-1",
          occurredAt: at(40),
          note: "SEPA",
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: null,
              product: null,
              quantity: null,
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "900",
              nativeCurrency: "EUR",
            },
          ],
        },
        {
          externalId: "trade:ETHEUR:e2e-2",
          occurredAt: at(30),
          note: null,
          legs: [
            {
              leg: "base",
              kind: "buy",
              asset: coin("ETH", "Ethereum"),
              product: "spot",
              quantity: "0.4",
              unitPrice: "2000",
              priceCurrency: "EUR",
              nativeAmount: "800",
              nativeCurrency: "EUR",
            },
          ],
        },
        {
          externalId: "deposit:e2e-3",
          occurredAt: at(20),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: coin("BTC", "Bitcoin"),
              product: "spot",
              quantity: "0.0125",
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "0.0125",
              nativeCurrency: "BTC",
              fxRate: "92000",
              fxSource: `exchange:BTC/EUR@${addDays(on, -20)}`,
            },
          ],
        },
        {
          externalId: "deposit:e2e-4",
          occurredAt: at(10),
          note: null,
          legs: [
            {
              leg: "main",
              kind: "deposit",
              asset: coin("USDT", "Tether", "stablecoin"),
              product: "spot",
              quantity: "250",
              unitPrice: null,
              priceCurrency: null,
              nativeAmount: "250",
              nativeCurrency: "USDT",
              fxRate: "0.9",
              fxSource: `exchange:EUR/USDT@${addDays(on, -10)}`,
            },
          ],
        },
      ],
      coverage: streams.flatMap((stream) => [
        {
          stream,
          fromAt: new Date("2017-07-14T00:00:00Z"),
          toAt: from,
          status: "gap" as const,
          reason: "api_limit_24m",
        },
        { stream, fromAt: from, toAt: now, status: "complete" as const, reason: null },
      ]),
      cursor: { from: from.toISOString() },
      historyFrom: from,
      openingRates: {},
    }),
    fetchHistory: async () => ({ points: [], coverage: [] }),
  }));
  try {
    await connectInvestmentProvider(
      ctx,
      "ccxt:binance",
      { api_key: "e2e-not-a-key-0003", secret: "e2e-not-a-key-0004" },
      { kind: "new", name: "Binance", currency: "EUR" },
    );
  } finally {
    setSourcesForTests(null);
  }
  const binance = (await listConnections(ctx)).find((one) => one.provider === "ccxt:binance");
  if (!binance) throw new Error("e2e: the Binance connection is missing");
  await saveSchedule(ctx, binance.id, { rules: [] });
}

async function seedLayout(): Promise<void> {
  const ctx = await contextOf(USERS.layout.email);
  // A Paperless link on manual only (docs/scheduler.md): the card and its schedule control are on screen for the
  // check, and the dispatcher never tries to reach the address, which does not exist.
  const paperless = await saveConnection(ctx, {
    provider: PAPERLESS_PROVIDER,
    credentials: { baseUrl: "http://paperless.invalid", token: "e2e-not-a-token", payslipType: "Payroll" },
  });
  await saveSchedule(ctx, paperless.id, { rules: [] });
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
  // An account in another currency, so the screens are measured with its line in the display
  // currency under its own value (§1.8).
  await createAccount(ctx, {
    name: "Interactive Brokers",
    type: "investment",
    currency: "USD",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: { on: addDays(on, -3), cents: 250_000n },
  });

  // ——— What hangs off the accounts: the section replaces a table the owner kept by hand ———
  for (const [channel, name] of [
    ["iban", "Paypal"],
    ["iban", "Satispay"],
    ["iban", "Bollo Regione Lombardia"],
    ["card", "Google Pay"],
    ["card", "Amazon"],
  ] as const) {
    await addConnection(ctx, current, { channel, name });
  }
  await addConnection(ctx, savings.id, { channel: "iban", name: "Stipendio", note: "accredito mensile" });

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
  await addPlannedExpense(ctx, holidays.id, {
    cents: 85_000n,
    dueOn: addDays(on, 14),
    description: "Ischia — hotel e traghetto",
  });
  const gifts = await createPocket(ctx, {
    name: "Gifts",
    color: null,
    backingAccountId: null,
    targetCents: null,
    monthlyCents: 5_000n,
    startMonth,
  });
  const [gift] = await expenseLinkCandidates(ctx);
  if (gift) await linkExpense(ctx, gifts.id, gift.id);

  // ——— Investments (docs/design/investments.md §4): a manual account per asset with a position in
  // EUR and one in USD, its cash and a valuation, and a manual account kept as a total. A service
  // starts today, so every operation is dated today. (No synced account: phase 2 has no provider.)
  const transfer = (await linkCandidates(ctx, { direction: "out", from: `${lastMonth}-01`, to: on })).find(
    (candidate) => candidate.payee === "Revolut",
  );
  if (!transfer) throw new Error("e2e: the layout user's giroconto is missing");
  const directa = await createManualService(ctx, {
    target: "new",
    name: "Directa",
    category: "broker",
    currency: "EUR",
    mode: "assets",
    url: "https://www.directa.it",
  });
  await recordOperation(ctx, directa.accountId, { kind: "deposit", on, amountCents: 1_000_000n });
  await recordOperation(ctx, directa.accountId, {
    kind: "deposit",
    on,
    amountCents: transfer.cents < 0n ? -transfer.cents : transfer.cents,
    transactionId: transfer.id,
  });
  await ensureAssetSeed(ctx);
  const seeded = await listAssets(ctx);
  const assetOf = (symbol: string) => {
    const asset = seeded.find((one) => one.symbol === symbol);
    if (!asset) throw new Error(`e2e: the asset seed has no ${symbol}`);
    return asset.id;
  };
  await addAsset(ctx, directa.accountId, {
    asset: { id: assetOf("VWCE") },
    on,
    quantity: parseDecimal("100", QUANTITY_SCALE),
    unitPrice: parseDecimal("60", PRICE_SCALE),
    feeCents: 200n,
  });
  await addAsset(ctx, directa.accountId, {
    asset: { id: assetOf("CSPX") },
    on,
    quantity: parseDecimal("5", QUANTITY_SCALE),
    unitPrice: parseDecimal("550.25", PRICE_SCALE),
    fxRate: parseDecimal("0.92", RATE_SCALE),
  });
  const vwce = (await serviceDetail(ctx, directa.accountId))?.holdings.find(
    (holding) => holding.asset.id === assetOf("VWCE"),
  )?.id;
  if (!vwce) throw new Error("e2e: the VWCE position is missing");
  await recordOperation(ctx, directa.accountId, {
    kind: "valuation",
    holdingId: vwce,
    on,
    unitPrice: parseDecimal("65", PRICE_SCALE),
  });
  const fineco = await createManualService(ctx, {
    target: "new",
    name: "Fineco Conto Deposito",
    category: "accounts",
    currency: "EUR",
    mode: "total",
    url: null,
  });
  await recordOperation(ctx, fineco.accountId, { kind: "deposit", on, amountCents: 500_000n });
  await recordOperation(ctx, fineco.accountId, { kind: "account_valuation", on, amountCents: 512_340n });
  // A transfer to confirm (§2.4): 1.000 € out of Fineco and into Directa on the same day, so both
  // service pages show the proposal the screen checks measure.
  await recordOperation(ctx, fineco.accountId, { kind: "withdrawal", on, amountCents: 100_000n });
  await recordOperation(ctx, directa.accountId, { kind: "deposit", on, amountCents: 100_000n });
  await seedEtoro(ctx, on);
  await seedBinance(ctx, on);

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
}

await seedExpenses();
await seedBudgets();
await seedPockets();
await seedSubscriptions();
await seedInterests();
await seedFunds();
await seedInvestments();
await seedTimeOff();
await seedLayout();
await seedCurrency();
console.log(`e2e: seeded ${Object.keys(USERS).length} test users`);

process.exit(0);
