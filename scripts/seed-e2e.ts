// scripts/seed-e2e.ts — the e2e suite's users on the deployed site (tests/e2e/_shared/homelab.ts).
//
//   seed [--only <user>,…]  removes any test users a failed run left behind, then creates them with
//           their sample data and writes the signed-in sessions the specs start from. Every user
//           gets a password drawn for this run (tests/e2e/.state/passwords.json, not in git).
//           `--only` seeds those users alone: the deployed site gets only what its tests need
//           (SITE_USERS). A seed that fails removes what it created;
//   remove  deletes the test users; every row they own goes with them (ON DELETE CASCADE).
//
// Both touch only users whose address ends in `@example.test`: the site's real users and their
// data are never read or written here.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { and, count, eq, inArray, isNull, like, notInArray } from "drizzle-orm";
import { createAuth } from "@domain/platform/auth/auth";
import { oauthClients } from "@domain/platform/auth/oauth/schema";
import { rateLimits, users } from "@domain/platform/auth/schema";
import { DEFAULT_PREFERENCES } from "@domain/modules/users/rules";
import { userPreferences } from "@domain/modules/users/schema";
import { ADDONS } from "@ledgerly/api-contract";
import { getDb } from "@domain/platform/db/client";
import { deleteFolder } from "@domain/platform/storage";
import {
  BASE_URL,
  E2E_MCP_CLIENT_NAME,
  PASSWORDS_FILE,
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
import { cookieHeader, createTestUsers, drawPassword } from "./seed-e2e/users";
import { seedBeforeOpening, seedCurrency, seedSwitching } from "./seed-e2e/accounts";
import { seedBudgets } from "./seed-e2e/budgets";
import { seedHistory, seedReview, seedReviewNew, seedRules } from "./seed-e2e/categories";
import { seedPreviewPlugins, seedPreviewRates } from "./seed-e2e/common";
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
import { seedEditOps, seedInvestments, seedLegs, seedPlans, seedPortfolio } from "./seed-e2e/investments";
import { seedLayout } from "./seed-e2e/layout";
import { seedPayrollHand } from "./seed-e2e/payroll";
import {
  seedBankSchedule,
  seedPluginsCleanup,
  seedPluginsDisconnected,
  seedPluginsErrors,
  seedPluginsGone,
  seedPluginsJourney,
  seedPluginsLive,
  seedPluginsMixed,
  seedPluginsOff,
  seedPluginsOn,
} from "./seed-e2e/plugins";
import { seedPockets } from "./seed-e2e/pockets";
import { seedSubscriptions } from "./seed-e2e/subscriptions";
import { seedTimeOff } from "./seed-e2e/timeoff";
import {
  seedEditing,
  seedExpenses,
  seedGiroconti,
  seedManual,
  seedManualTransfer,
  seedSources,
} from "./seed-e2e/transactions";
import { wireDomain } from "../apps/api/src/wiring";

// The ports of the domain, as every process wires them (10-modularity.md §10.3).
wireDomain();

type Name = keyof typeof USERS;

const mode = process.argv[2];

if (mode !== "seed" && mode !== "remove")
  throw new Error("usage: seed-e2e.ts seed [--only <user>,…] | remove");

const only = process.argv[3] === "--only" ? (process.argv[4] ?? "").split(",") : undefined;
for (const name of only ?? []) {
  if (!(name in USERS)) throw new Error(`Not a test user: ${name}`);
}
const NAMES = (Object.keys(USERS) as Name[]).filter((name) => !only || only.includes(name));
const seeded = (...names: Name[]) => names.every((name) => NAMES.includes(name));

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
  // The end of a run fails while a test user is left in the database, the site's above all.
  const [left] = await getDb()
    .select({ n: count() })
    .from(users)
    .where(like(users.email, `%${TEST_EMAIL_DOMAIN}`));
  if (left.n > 0) throw new Error(`e2e: ${left.n} test users are still in the database`);
}

await removeTestUsers();

if (mode === "remove") process.exit(0);

const auth = createAuth({ withNextCookies: false });

/**
 * A Playwright storage state holding one user's session cookie. Better Auth is called here as a
 * library rather than over HTTP, so setting these sessions up costs none of the run's rate-limited
 * sign-ins (tests/e2e/_shared/env.ts) and a spec that only needs to be signed in spends none either.
 */
async function writeSessionState(
  name: keyof typeof SESSIONS,
  passwords: Record<string, string>,
  totpSecrets: Record<string, string>,
): Promise<void> {
  const user = USERS[SESSIONS[name].user];
  const signIn = await auth.api.signInEmail({
    body: { email: user.email, password: passwords[user.email] },
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
  writeFileSync(sessionState(name), JSON.stringify({ cookies, origins: [] }, null, 2), { mode: 0o600 });
}

/** The sample data, each with the users it writes on: it runs only when they are all seeded. */
const DATA: [Name[], () => Promise<unknown>][] = [
  [[], seedPreviewRates],
  [[], seedPreviewPlugins],
  [["expenses"], seedExpenses],
  [["giroconti"], seedGiroconti],
  [["editing"], seedEditing],
  [["history"], () => seedHistory()],
  [["suggestions"], () => seedHistory(USERS.suggestions.email)],
  [["budgets"], seedBudgets],
  [["pockets"], seedPockets],
  [["subscriptions"], seedSubscriptions],
  [["interests"], seedInterests],
  [["funds"], seedFunds],
  [["fundsHome"], seedFundsHome],
  [["fundsDetail"], () => seedFundsDetail(USERS.fundsDetail.email)],
  [["fundsCopy"], seedFundsCopy],
  [["fundsNew"], seedFundsNew],
  [["fundsSetup"], seedFundsSetup],
  [["investments"], seedInvestments],
  [["portfolio", "portfolioJourney"], seedPortfolio],
  [["legs"], seedLegs],
  [["editOps"], seedEditOps],
  [["plans", "plansJourney"], seedPlans],
  [["payrollHand"], seedPayrollHand],
  [["timeoff"], () => seedTimeOff(USERS.timeoff.email)],
  [["timeoffPhone"], () => seedTimeOff(USERS.timeoffPhone.email)],
  [["timeoffHolidays"], () => seedTimeOff(USERS.timeoffHolidays.email)],
  [["layout"], () => seedLayout()],
  [["addons"], () => seedLayout(USERS.addons.email)],
  [["hidden"], () => seedLayout(USERS.hidden.email)],
  [["connections"], () => seedConnections()],
  [["manual"], () => seedManual()],
  [["sources"], () => seedSources()],
  [["switching"], () => seedSwitching()],
  [["review"], () => seedReview()],
  [["reviewNew"], () => seedReviewNew()],
  [["reviewJourney"], () => seedReview(USERS.reviewJourney.email)],
  // Expenses › Categories (N3.2): the default groups and movements with their categories.
  [["categories"], () => seedReview(USERS.categories.email)],
  [["reviewNewJourney"], () => seedReviewNew(USERS.reviewNewJourney.email)],
  // Settings › Rules (N3.4): `rules` for the screen check, `rulesJourney` for the journey that writes.
  [["rules"], () => seedRules(USERS.rules.email)],
  [["rulesJourney"], () => seedRules(USERS.rulesJourney.email)],
  [["manualJourney"], () => seedManual(USERS.manualJourney.email)],
  [["manualTransfer"], () => seedManualTransfer(USERS.manualTransfer.email)],
  [["sendJourney"], () => seedSources(USERS.sendJourney.email)],
  [["sourceCategories"], () => seedSources(USERS.sourceCategories.email)],
  [["switchJourney"], () => seedSwitching(USERS.switchJourney.email)],
  [["connectionsJourney"], () => seedConnections(USERS.connectionsJourney.email)],
  [["schedule"], seedSchedule],
  // H56: the plugins' states, one user per column of the matrix (tests/e2e/connections/plugin-states.spec.ts).
  [["pluginsOff"], seedPluginsOff],
  [["pluginsOn"], seedPluginsOn],
  [["pluginsLive"], seedPluginsLive],
  [["bankSchedule"], seedBankSchedule],
  [["pluginsErrors"], seedPluginsErrors],
  [["pluginsMixed"], seedPluginsMixed],
  [["pluginsDisconnected"], seedPluginsDisconnected],
  [["pluginsCleanup"], () => seedPluginsCleanup()],
  [["pluginsGone"], seedPluginsGone],
  [["pluginsJourney"], seedPluginsJourney],
  [["currency"], seedCurrency],
  [["beforeOpening"], seedBeforeOpening],
];

const REGION = {
  timeZone: DEFAULT_PREFERENCES.timeZone,
  locale: DEFAULT_PREFERENCES.locale,
  numberFormat: DEFAULT_PREFERENCES.numberFormat,
  displayCurrency: DEFAULT_PREFERENCES.displayCurrency,
};

async function seed(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });
  // Written before the first user exists, and readable by this account only.
  const passwords = Object.fromEntries(NAMES.map((name) => [USERS[name].email, drawPassword()]));
  writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords, null, 2), { mode: 0o600 });

  // The site already has its admin, so these are ordinary users — except `admin@example.test`,
  // promoted once its TOTP is on: Admin › Users and Admin › Server (F8) have no journey without one.
  const totpSecrets = await createTestUsers(
    auth,
    NAMES.map((name) => ({
      ...USERS[name],
      password: passwords[USERS[name].email],
      totp: !WITHOUT_TOTP.has(name),
      admin: name === "admin",
    })),
  );
  writeFileSync(TOTP_FILE, JSON.stringify(totpSecrets, null, 2), { mode: 0o600 });

  // A sign-up since R5a has the first start ahead of it, with every addon off: the journeys of the test
  // users are those of a person who already finished it with every addon on. The two users of the first
  // start keep it ahead of them, as the sign-up left them (tests/e2e/welcome/). Their format is the
  // app's default, not the instance's: an admin who changes the instance's defaults moves no spec.
  await getDb()
    .update(userPreferences)
    .set({ onboardedAt: new Date(), modules: [...ADDONS], ...REGION })
    .where(
      inArray(
        userPreferences.userId,
        getDb()
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              like(users.email, `%${TEST_EMAIL_DOMAIN}`),
              notInArray(users.email, [USERS.welcome.email, USERS.welcomeJourney.email]),
            ),
          ),
      ),
    );

  for (const name of Object.keys(SESSIONS) as (keyof typeof SESSIONS)[]) {
    if (seeded(SESSIONS[name].user)) await writeSessionState(name, passwords, totpSecrets);
  }

  for (const [names, step] of DATA) {
    if (seeded(...names)) await step();
  }
}

try {
  await seed();
} catch (error) {
  // No half-seeded users stay behind a failed seed, on the site least of all.
  console.error(error);
  await removeTestUsers();
  process.exit(1);
}

console.log(`e2e: seeded ${NAMES.length} test users`);

process.exit(0);
