// scripts/seed-e2e.ts — runs after the e2e server has migrated the database.
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { applyProviderAccounts } from "../src/modules/accounts/service";
import { accounts } from "../src/modules/accounts/schema";
import { upsertFromProvider } from "../src/modules/transactions/service";
import type { IncomingTransaction } from "../src/modules/transactions/rules";
import { createAuth } from "../src/platform/auth/auth";
import { createInvitation } from "../src/platform/auth/invitations";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { getDb } from "../src/platform/db/client";
import { userScoped } from "../src/platform/db/scope";
import { WALLET_PROVIDER } from "../src/platform/integrations/rules";
import { saveConnection } from "../src/platform/integrations/service";
import { ensureBucket } from "../src/platform/storage";
import { BASE_URL, INVITATIONS, SESSIONS, STATE_DIR, USERS, sessionState } from "../tests/e2e/env";

const auth = createAuth({ withNextCookies: false });
// In order: the first user created becomes the admin.
for (const user of [USERS.owner, USERS.prefs, USERS.reset, USERS.accounts, USERS.expenses]) {
  await auth.api.createUser({ body: user });
}
await ensureBucket();
mkdirSync(STATE_DIR, { recursive: true });
for (const { email, role, file } of Object.values(INVITATIONS)) {
  const { token } = await createInvitation({ email, role, invitedBy: null });
  writeFileSync(`${STATE_DIR}/${file}`, token);
}

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
      secure: false,
      sameSite: "Lax" as const,
    }));
  if (cookies.length === 0) throw new Error(`No session cookie for ${user.email}`);
  writeFileSync(sessionState(name), JSON.stringify({ cookies, origins: [] }, null, 2));
}

for (const name of Object.keys(SESSIONS) as (keyof typeof SESSIONS)[]) {
  await writeSessionState(name);
}

/**
 * The Expenses journey needs movements that arrived the way real ones do: a Wallet connection, a
 * synced account adopted through `applyProviderAccounts`, and transactions applied by
 * `upsertFromProvider`. Seeding through the services rather than with inserts means the journey
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

  await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "e2e-wallet-token" } });
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

  // Invented figures, two months apart so the month groups and the period stepper both have
  // something to show. September is the month the journey looks at.
  const movement = (
    externalId: string,
    on: string,
    cents: bigint,
    payee: string,
    category: string | null,
  ): IncomingTransaction => ({
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date(`${on}T10:00:00Z`),
    amountCents: cents,
    currency: "EUR",
    type: cents < 0n ? "expense" : "income",
    state: "cleared",
    payee,
    note: null,
    categoryExternalId: category === null ? null : `cat-${category.toLowerCase()}`,
    categoryName: category,
    labels: [],
  });

  await upsertFromProvider(ctx, account.id, [
    movement("e2e-tx-1", "2026-09-02", -1299n, "Netflix", "Abbonamenti"),
    movement("e2e-tx-2", "2026-09-04", -4550n, "Esselunga", "Spesa"),
    movement("e2e-tx-3", "2026-09-09", -2100n, "Trenitalia", "Trasporti"),
    movement("e2e-tx-4", "2026-09-11", 210000n, "Stipendio", null),
    movement("e2e-tx-5", "2026-08-12", -1299n, "Netflix", "Abbonamenti"),
  ]);
}

await seedExpenses();

process.exit(0);
