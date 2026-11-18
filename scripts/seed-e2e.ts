// scripts/seed-e2e.ts — the e2e suite's users on the deployed site (tests/e2e/_shared/homelab.ts).
//
//   seed    removes any test users a failed run left behind, then creates them with their sample
//           data and writes the signed-in sessions the specs start from;
//   remove  deletes the test users; every row they own goes with them (ON DELETE CASCADE).
//
// Both touch only users whose address ends in `@example.test`: the site's real users and their
// data are never read or written here.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { and, eq, isNull, like } from "drizzle-orm";
import { createAuth } from "../src/platform/auth/auth";
import { oauthClients } from "../src/platform/auth/oauth/schema";
import { rateLimits, users } from "../src/platform/auth/schema";
import { getDb } from "../src/platform/db/client";
import { deleteFolder } from "../src/platform/storage";
import {
  BASE_URL,
  E2E_MCP_CLIENT_NAME,
  PREVIEW_CLIENT_PREFIX,
  SESSIONS,
  sessionState,
  STATE_DIR,
  TEST_EMAIL_DOMAIN,
  TOTP_FILE,
  USERS,
  WITHOUT_TOTP,
} from "../tests/e2e/_shared/env";
import { totpCode } from "../tests/e2e/_shared/totp";
import { seedCurrency, seedSwitching } from "./seed-e2e/accounts";
import { seedBudgets } from "./seed-e2e/budgets";
import { seedReview, seedReviewNew } from "./seed-e2e/categories";
import { seedPreviewRates } from "./seed-e2e/common";
import { seedConnections, seedSchedule } from "./seed-e2e/connections";
import {
  seedFunds,
  seedFundsCopy,
  seedFundsDetail,
  seedFundsHome,
  seedFundsNew,
  seedFundsSetup,
} from "./seed-e2e/funds";
import { seedInterests } from "./seed-e2e/interests";
import { seedInvestments } from "./seed-e2e/investments";
import { seedLayout } from "./seed-e2e/layout";
import { seedPockets } from "./seed-e2e/pockets";
import { seedSubscriptions } from "./seed-e2e/subscriptions";
import { seedTimeOff } from "./seed-e2e/timeoff";
import { seedExpenses, seedManual, seedSources } from "./seed-e2e/transactions";

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
  // The sign-ins counted for the clients of a preview's spec files: nobody else has these addresses.
  await getDb()
    .delete(rateLimits)
    .where(like(rateLimits.key, `${PREVIEW_CLIENT_PREFIX}%`));
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

// On an empty database (a local preview) the first user created is made an admin: the test users
// are ordinary ones there too, as they are on the site.
await getDb()
  .update(users)
  .set({ role: "user" })
  .where(like(users.email, `%${TEST_EMAIL_DOMAIN}`));

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
 * sign-ins (tests/e2e/_shared/env.ts) and a spec that only needs to be signed in spends none either.
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

await seedPreviewRates();

await seedExpenses();

await seedBudgets();

await seedPockets();

await seedSubscriptions();

await seedInterests();

await seedFunds();

await seedFundsHome();

await seedFundsDetail(USERS.fundsDetail.email);

await seedFundsCopy();

await seedFundsNew();

await seedFundsSetup();

await seedInvestments();

await seedTimeOff(USERS.timeoff.email);

await seedTimeOff(USERS.timeoffPhone.email);

await seedTimeOff(USERS.timeoffHolidays.email);

await seedLayout();

await seedConnections();

await seedManual();

await seedSources();

await seedSwitching();

await seedReview();

await seedReviewNew();

await seedReview(USERS.reviewJourney.email);

// Expenses › Categories (N3.2): the default groups and movements with their categories.
await seedReview(USERS.categories.email);

await seedReviewNew(USERS.reviewNewJourney.email);

await seedManual(USERS.manualJourney.email);

await seedSources(USERS.sendJourney.email);

await seedSources(USERS.sourceCategories.email);

await seedSwitching(USERS.switchJourney.email);

await seedConnections(USERS.connectionsJourney.email);

await seedSchedule();

await seedCurrency();

console.log(`e2e: seeded ${Object.keys(USERS).length} test users`);

process.exit(0);
