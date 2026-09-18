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
import { applyProviderAccounts } from "../src/modules/accounts/service";
import { accounts } from "../src/modules/accounts/schema";
import { upsertFromProvider } from "../src/modules/transactions/service";
import type { IncomingTransaction } from "../src/modules/transactions/rules";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addMonths, monthKey, today } from "../src/platform/dates";
import { getDb } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
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
    .returning({ email: users.email });
  console.log(`e2e: removed ${removed.length} test users`);
  rmSync(STATE_DIR, { recursive: true, force: true });
}

await removeTestUsers();
if (mode === "remove") process.exit(0);

const auth = createAuth({ withNextCookies: false });
// The site already has its admin, so these are ordinary users.
for (const user of Object.values(USERS)) {
  await auth.api.createUser({ body: user });
}
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
async function seedExpenses(): Promise<void> {
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, USERS.expenses.email));
  if (!user) throw new Error(`No user for ${USERS.expenses.email}`);
  const ctx: Ctx = {
    userId: user.id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
  };

  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    {
      provider: WALLET_PROVIDER,
      providerAccountId: "e2e-acc-1",
      name: "ING Conto Arancio",
      type: "checking",
      currency: "EUR",
    },
  ]);
  const [account] = await getDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(userScoped(ctx).owns(accounts));
  if (!account) throw new Error("The provider account was not adopted");

  // Invented figures, in this month and the one before, so the month groups and the period
  // stepper both have something to show. The dates are derived from today rather than written
  // down: `/expenses` opens on the current month, so a fixed month would make the journey pass
  // until that month went by and then fail as though Expenses were broken.
  const thisMonth = monthKey(today(ctx.timeZone)).slice(0, 7);
  const lastMonth = addMonths(monthKey(today(ctx.timeZone)), -1).slice(0, 7);
  const movement = (
    externalId: string,
    on: string,
    cents: bigint,
    payee: string,
    category: string | null,
    counterpartExternalId: string | null = null,
  ): IncomingTransaction => ({
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
    // No groups here: this journey checks the "By category" rows one category at a time.
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  });

  await upsertFromProvider(ctx, account.id, [
    movement("e2e-tx-1", `${thisMonth}-02`, -1299n, "Netflix", "Abbonamenti"),
    movement("e2e-tx-2", `${thisMonth}-04`, -4550n, "Esselunga", "Spesa"),
    movement("e2e-tx-3", `${thisMonth}-09`, -2100n, "Trenitalia", "Trasporti"),
    movement("e2e-tx-4", `${thisMonth}-11`, 210000n, "Stipendio", null),
    movement("e2e-tx-5", `${lastMonth}-12`, -1299n, "Netflix", "Abbonamenti"),
    // One leg of a giroconto whose other account is not linked here (F2.5): in the list, flagged as
    // unpaired, and in no total. Last month, so this month's figures stay what they were.
    movement("e2e-tx-6", `${lastMonth}-15`, -50000n, "Revolut", null, "e2e-tx-7"),
  ]);
}

await seedExpenses();
console.log(`e2e: seeded ${Object.keys(USERS).length} test users`);

process.exit(0);
