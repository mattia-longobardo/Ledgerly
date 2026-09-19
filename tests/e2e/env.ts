// tests/e2e/env.ts — one place for the site the specs drive and the users they drive it as.
//
// The e2e suite runs against the deployed site, https://dash.longobardo.me: there is no local
// server any more. It signs in only as the users below, all on the reserved `example.test` domain;
// the seed creates them with their sample data before the run and removes them, with everything
// they own, after it (scripts/seed-e2e.ts). No spec reads or writes anybody else's data.
export const BASE_URL = "https://dash.longobardo.me";

// Better Auth rate-limits password sign-ins to 5 per minute per client (/sign-in/email,
// src/platform/auth/auth.ts), and the whole run is one client. The suite spends 4; a spec that
// only needs to be signed in starts from a session the seed prepared and spends none.
export const USERS = {
  owner: { email: "owner@example.test", password: "owner-password-123", name: "Owner" },
  prefs: { email: "prefs@example.test", password: "prefs-password-123", name: "Prefs" },
  accounts: { email: "accounts@example.test", password: "accounts-password-123", name: "Accounts" },
  expenses: { email: "expenses@example.test", password: "expenses-password-123", name: "Expenses" },
  budgets: { email: "budgets@example.test", password: "budgets-password-123", name: "Budgets" },
  pockets: { email: "pockets@example.test", password: "pockets-password-123", name: "Pockets" },
  subscriptions: {
    email: "subscriptions@example.test",
    password: "subscriptions-password-123",
    name: "Subscriptions",
  },
  interests: { email: "interests@example.test", password: "interests-password-123", name: "Interests" },
  funds: { email: "funds@example.test", password: "funds-password-123", name: "Funds" },
} as const;

/** The only addresses the seed may create or delete. */
export const TEST_EMAIL_DOMAIN = "@example.test";

/**
 * A ready signed-in session for the journeys that are not about signing in, written by the seed.
 * The seed signs in through Better Auth's server API, in process, so a module's journey costs none
 * of the run's rate-limited sign-ins — the budget above is for the auth specs that need it.
 */
export const SESSIONS = {
  accounts: { user: "accounts", file: "accounts-session.json" },
  expenses: { user: "expenses", file: "expenses-session.json" },
  budgets: { user: "budgets", file: "budgets-session.json" },
  pockets: { user: "pockets", file: "pockets-session.json" },
  subscriptions: { user: "subscriptions", file: "subscriptions-session.json" },
  interests: { user: "interests", file: "interests-session.json" },
  funds: { user: "funds", file: "funds-session.json" },
} as const;

export const sessionState = (name: keyof typeof SESSIONS) => `${STATE_DIR}/${SESSIONS[name].file}`;

export const STATE_DIR = "tests/e2e/.state";
