// tests/e2e/_shared/env.ts — one place for the site the specs drive and the users they drive it as.
//
// The e2e suite runs against the deployed site, https://dash.longobardo.me: there is no local
// server any more. It signs in only as the users below, all on the reserved `example.test` domain;
// the seed creates them with their sample data before the run and removes them, with everything
// they own, after it (scripts/seed-e2e.ts). No spec reads or writes anybody else's data.
//
// E2E_BASE_URL points them at a local preview instead, against `ledgerly_test`
// (scripts/preview-on-test.sh, docs/design/funds-ux.md §10).
import { readFileSync } from "node:fs";

export const BASE_URL = process.env.E2E_BASE_URL ?? "https://dash.longobardo.me";

/**
 * E2E_ORIGIN (`127.0.0.1`, Traefik's `web` entrypoint): the specs reach the site's origin through a
 * proxy of the run instead of Cloudflare (tests/e2e/_shared/origin.ts). `scripts/release.sh` sets it
 * for the `@smoke` tests, and the `@site` commands of `npm run test:select` carry it; every other run
 * goes through Cloudflare as before.
 */
export const ORIGIN = process.env.E2E_ORIGIN;
const ORIGIN_PROXY = "http://127.0.0.1:3990";

/** What a context needs to go through that proxy; nothing without E2E_ORIGIN. */
export const ORIGIN_OPTIONS = ORIGIN ? { proxy: { server: ORIGIN_PROXY }, ignoreHTTPSErrors: true } : {};
export const ORIGIN_PROXY_PORT = Number(new URL(ORIGIN_PROXY).port);

// Better Auth rate-limits password sign-ins to 5 per minute per client (/sign-in/email,
// src/platform/auth/auth.ts), and the whole run is one client. The suite spends 4; a spec that
// only needs to be signed in starts from a session the seed prepared and spends none.
// No password is written here: the repo is public, and the seed draws a new one for every user and
// every run (PASSWORDS_FILE, read with `passwordOf`).
export const USERS = {
  owner: { email: "owner@example.test", name: "Owner" },
  prefs: { email: "prefs@example.test", name: "Prefs" },
  accounts: { email: "accounts@example.test", name: "Accounts" },
  // Phase 1b (docs/design/investments.md §1.8): an account in EUR and one in USD, and the display
  // currency switched in Settings. Its own user, so no other journey sees its totals change.
  currency: { email: "currency@example.test", name: "Currency" },
  expenses: { email: "expenses@example.test", name: "Expenses" },
  // Giroconti in each of their states, and movements with and without a time of day.
  giroconti: { email: "giroconti@example.test", name: "Giroconti" },
  // The edit dialog of a movement: a change of type in each direction, on movements of its own.
  editing: { email: "editing@example.test", name: "Editing" },
  // A choice from the selector's top: the user that writes.
  history: { email: "history@example.test", name: "History" },
  // The same movements, only read: a group suggestion, and a movement with no suggestion. A write
  // trains the model again, and its pass would take the seeded suggestion away.
  suggestions: { email: "suggestions@example.test", name: "Suggestions" },
  budgets: { email: "budgets@example.test", name: "Budgets" },
  pockets: { email: "pockets@example.test", name: "Pockets" },
  subscriptions: {
    email: "subscriptions@example.test",
    name: "Subscriptions",
  },
  interests: { email: "interests@example.test", name: "Interests" },
  funds: { email: "funds@example.test", name: "Funds" },
  // Funds F2: years in each state of docs/design/funds-ux.md §6, with invented amounts. The `funds`
  // user starts empty on purpose, and `layout` has one year only.
  fundsHome: { email: "funds-home@example.test", name: "Funds Home" },
  // Funds F3: a fund's page, a fund with a debit plan and a fund fed by the payslip with its
  // operations, with invented amounts. Its own user, so the years of `fundsHome` keep meaning what its spec says.
  fundsDetail: {
    email: "funds-detail@example.test",
    name: "Funds Detail",
  },
  // Funds F4: the same funds in Italian, so the words of the new pages are read in both languages.
  fundsCopy: {
    email: "funds-copy@example.test",
    name: "Funds Copy",
  },
  investments: {
    email: "investments@example.test",
    name: "Investments",
  },
  // R5d: a manual portfolio with cash and one purchase, and a service kept by value, for the screen
  // check; `portfolioJourney` starts with a service kept by value only, and the journey writes on it.
  portfolio: { email: "portfolio@example.test", name: "Portfolio" },
  portfolioJourney: {
    email: "portfolio-journey@example.test",
    name: "Portfolio Journey",
  },
  // PERS-651: a manual portfolio with no operation and a bank account with two transfers out to it,
  // for the journey of a deposit paired with its bank transaction and its leg in Expenses and Accounts.
  legs: { email: "legs@example.test", name: "Legs" },
  // PERS-693: a manual portfolio with three deposits written out of date order and two accounts of
  // its own, for «Edit» of an operation and the order of the Activity.
  editOps: { email: "edit-ops@example.test", name: "Edit Ops" },
  // PERS-681: manual portfolios with basket plans in every state — proposals of today, one with a
  // price to type, one waiting for its price, a converted plan with no amount, a portfolio with no cash
  // and one with no plan — for the screen check; `plansJourney` has the same and the journey writes on it.
  plans: { email: "plans@example.test", name: "Plans" },
  plansJourney: {
    email: "plans-journey@example.test",
    name: "Plans Journey",
  },
  payroll: { email: "payroll@example.test", name: "Payroll" },
  // R5g, criterion 3: a person with no country, no reading profile and no payslip, who types them by
  // hand (`payrollManual`, the journey); `payrollHand` has one typed by hand, for the screen check.
  payrollManual: {
    email: "payroll-manual@example.test",
    name: "Payroll Manual",
  },
  payrollHand: {
    email: "payroll-hand@example.test",
    name: "Payroll Hand",
  },
  // Release N6: the journey of a fund fed by the payslip, with no document. It starts with no fund.
  fundsPayslip: {
    email: "funds-payslip@example.test",
    name: "Funds Payslip",
  },
  // Release N6: the form "Add pension fund". It starts with an account and no fund, so the payslip
  // is free for the fund the form creates.
  fundsNew: { email: "funds-new@example.test", name: "Funds New" },
  // Release N6: the funds the form, the sources and the fees are driven on. Its own user, because
  // these journeys add and remove what the pages of `fundsDetail` and `layout` are measured with.
  fundsSetup: {
    email: "funds-setup@example.test",
    name: "Funds Setup",
  },
  timeoff: { email: "timeoff@example.test", name: "Timeoff" },
  // The same year of time off, for the phone's journey (tests/e2e/timeoff/mobile.spec.ts): it books a day
  // while the desktop's journey counts the days of `timeoff`.
  timeoffPhone: {
    email: "timeoff-phone@example.test",
    name: "Timeoff Phone",
  },
  // The holiday calendars and the working day (tests/e2e/timeoff/holidays.spec.ts): they change how
  // a day is counted, so not on the user whose days `timeoff.spec.ts` counts beside them.
  timeoffHolidays: {
    email: "timeoff-holidays@example.test",
    name: "Timeoff Holidays",
  },
  // F8: the admin journey. Its own user rather than a promoted `owner`, so every spec that signs
  // in as an ordinary one keeps meaning what it says.
  admin: { email: "admin@example.test", name: "Admin" },
  // F8.1: Settings › Categories, which starts from the default tree and needs nobody else's data.
  categories: { email: "categories@example.test", name: "Categories" },
  // F8: the Client API and "Export my data", which need nobody else's data.
  security: { email: "security@example.test", name: "Security" },
  // F9: the one user every screen is measured on (tests/e2e/<flow>/a11y.spec.ts). It is seeded with
  // something on every page — accounts, movements, budgets, pockets, subscriptions, an interest
  // rule, a fund with a debit plan, a fund fed by the payslip and an applied payslip — because a layout check run against an
  // empty state measures an empty state. The module journeys keep their own users, which start
  // empty on purpose, so filling this one breaks none of them.
  layout: { email: "layout@example.test", name: "Layout" },
  // R5a and R5e: copies of `layout`, for the journeys that turn addons off and hide the amounts —
  // a change every page of the user shows, so never on the user the screens are measured on.
  addons: { email: "addons@example.test", name: "Addons" },
  hidden: { email: "hidden@example.test", name: "Hidden" },
  // R5a: two people with the first start still ahead of them, as a sign-up leaves them: `welcome` for
  // the screen checks, which never end it, and `welcomeJourney` for the journey that does.
  welcome: { email: "welcome@example.test", name: "Welcome" },
  welcomeJourney: {
    email: "welcome-journey@example.test",
    name: "Welcome Journey",
  },
  // Release N2: one connection in each of the five states (ux/n2-connection-status.md §2), the
  // history, "Advanced" and more than one bank. Its own user: the `layout` user keeps the section
  // "Banks" on its guide, with nothing saved.
  connections: {
    email: "connections@example.test",
    name: "Connections",
  },
  // Release N3: the movement written by hand (ux/n3-categories-manual.md §9). Its own user, with
  // an account kept by hand, an account a bank only reads and one manual movement: the journey
  // changes balances, and no other journey's numbers may move with it.
  manual: { email: "manual@example.test", name: "Manual" },
  // Release N3, second part: the automatic categories (ux/n3-categories-manual.md). `review` has
  // the default groups and movements in every state — automatic, suggested, with no category;
  // `reviewNew` has movements and no category at all, for the first step of the guided review.
  sources: { email: "sources@example.test", name: "Sources" },
  // Release N4b: an account of a source and the same account in a bank, not imported yet.
  switching: { email: "switching@example.test", name: "Switching" },
  review: { email: "review@example.test", name: "Review" },
  reviewNew: { email: "review-new@example.test", name: "Review New" },
  // The users of the journeys that change their data, each a copy of the user the screen check
  // measures (`a11y.spec.ts`), so that no journey moves what a screen is measured with, and no
  // two journeys share a user: each spec starts from its own data.
  reviewJourney: {
    email: "review-journey@example.test",
    name: "Review Journey",
  },
  reviewNewJourney: {
    email: "review-new-journey@example.test",
    name: "Review New Journey",
  },
  manualJourney: {
    email: "manual-journey@example.test",
    name: "Manual Journey",
  },
  // PERS-678: a movement imported before the opening, and «Move the opening».
  beforeOpening: {
    email: "before-opening@example.test",
    name: "Before Opening",
  },
  sendJourney: {
    email: "send-journey@example.test",
    name: "Send Journey",
  },
  sourceCategories: {
    email: "source-categories@example.test",
    name: "Source Categories",
  },
  switchJourney: {
    email: "switch-journey@example.test",
    name: "Switch Journey",
  },
  connectionsJourney: {
    email: "connections-journey@example.test",
    name: "Connections Journey",
  },
  // Release N3.4: Settings › Rules (categories-and-rules.md §4). `rules` is measured by the screen
  // check; `rulesJourney`, a copy, is the one the journey writes on.
  rules: { email: "rules@example.test", name: "Rules" },
  rulesJourney: {
    email: "rules-journey@example.test",
    name: "Rules Journey",
  },
  // The sync schedule editor (tests/e2e/connections/schedule.spec.ts): a Trek link and two services.
  schedule: { email: "schedule@example.test", name: "Schedule" },
  // F8: the one user Admin › Users is allowed to change the role of, block and finally remove.
  // Nothing else uses it, and the admin spec addresses it by this exact address — the page lists
  // the instance's real users too, and a spec must never touch one.
  disposable: {
    email: "disposable@example.test",
    name: "Disposable",
  },
  // H56 (PERS-619): one user per column of the matrix of the plugins' states (scripts/seed-e2e/plugins.ts).
  pluginsOff: {
    email: "plugins-off@example.test",
    name: "Plugins Off",
  },
  pluginsOn: { email: "plugins-on@example.test", name: "Plugins On" },
  pluginsLive: {
    email: "plugins-live@example.test",
    name: "Plugins Live",
  },
  pluginsErrors: {
    email: "plugins-errors@example.test",
    name: "Plugins Errors",
  },
  pluginsMixed: {
    email: "plugins-mixed@example.test",
    name: "Plugins Mixed",
  },
  pluginsDisconnected: {
    email: "plugins-disconnected@example.test",
    name: "Plugins Disconnected",
  },
  pluginsCleanup: {
    email: "plugins-cleanup@example.test",
    name: "Plugins Cleanup",
  },
  pluginsGone: {
    email: "plugins-gone@example.test",
    name: "Plugins Gone",
  },
  pluginsJourney: {
    email: "plugins-journey@example.test",
    name: "Plugins Journey",
  },
  // TOTP (docs/auth-design.md D2). The seed turns TOTP on for every user above, as the site's
  // TWO_FACTOR_POLICY=required would make them; these two are left without it on purpose:
  // `enroll` walks through the forced setup, `pending` keeps the setup page open for the a11y check.
  enroll: { email: "enroll@example.test", name: "Enroll" },
  pending: { email: "pending@example.test", name: "Pending" },
} as const;

/**
 * The users a run on the deployed site needs: the `@smoke` and `@site` tests and the docs' shots.
 * The site's own setup (global-setup.ts) seeds these alone; the preview seeds every user.
 */
export const SITE_USERS: readonly (keyof typeof USERS)[] = [
  "owner",
  "prefs",
  "enroll",
  "currency",
  "pockets",
  "admin",
  "layout",
  "security",
];

/** The users the seed leaves without TOTP. */
export const WITHOUT_TOTP: ReadonlySet<keyof typeof USERS> = new Set(["enroll", "pending"]);

/**
 * Where the requests of a spec file come from on a local preview (`previewClient`, helpers.ts):
 * the block reserved for documentation (TEST-NET-3), which no real client has. The seed forgets
 * the sign-ins counted for these addresses, so a second run does not start on the first one's count.
 */
export const PREVIEW_CLIENT_PREFIX = "203.0.113.";

/** The only addresses the seed may create or delete. */
export const TEST_EMAIL_DOMAIN = "@example.test";

/**
 * A ready signed-in session for the journeys that are not about signing in, written by the seed.
 * The seed signs in through Better Auth's server API, in process, so a module's journey costs none
 * of the run's rate-limited sign-ins — the budget above is for the auth specs that need it.
 */
export const SESSIONS = {
  accounts: { user: "accounts", file: "accounts-session.json" },
  currency: { user: "currency", file: "currency-session.json" },
  expenses: { user: "expenses", file: "expenses-session.json" },
  giroconti: { user: "giroconti", file: "giroconti-session.json" },
  editing: { user: "editing", file: "editing-session.json" },
  history: { user: "history", file: "history-session.json" },
  suggestions: { user: "suggestions", file: "suggestions-session.json" },
  budgets: { user: "budgets", file: "budgets-session.json" },
  pockets: { user: "pockets", file: "pockets-session.json" },
  subscriptions: { user: "subscriptions", file: "subscriptions-session.json" },
  interests: { user: "interests", file: "interests-session.json" },
  funds: { user: "funds", file: "funds-session.json" },
  fundsHome: { user: "fundsHome", file: "funds-home-session.json" },
  fundsDetail: { user: "fundsDetail", file: "funds-detail-session.json" },
  fundsCopy: { user: "fundsCopy", file: "funds-copy-session.json" },
  investments: { user: "investments", file: "investments-session.json" },
  portfolio: { user: "portfolio", file: "portfolio-session.json" },
  portfolioJourney: { user: "portfolioJourney", file: "portfolio-journey-session.json" },
  legs: { user: "legs", file: "legs-session.json" },
  editOps: { user: "editOps", file: "edit-ops-session.json" },
  plans: { user: "plans", file: "plans-session.json" },
  plansJourney: { user: "plansJourney", file: "plans-journey-session.json" },
  payroll: { user: "payroll", file: "payroll-session.json" },
  payrollManual: { user: "payrollManual", file: "payroll-manual-session.json" },
  payrollHand: { user: "payrollHand", file: "payroll-hand-session.json" },
  fundsPayslip: { user: "fundsPayslip", file: "funds-payslip-session.json" },
  fundsNew: { user: "fundsNew", file: "funds-new-session.json" },
  fundsSetup: { user: "fundsSetup", file: "funds-setup-session.json" },
  timeoff: { user: "timeoff", file: "timeoff-session.json" },
  timeoffPhone: { user: "timeoffPhone", file: "timeoff-phone-session.json" },
  timeoffHolidays: { user: "timeoffHolidays", file: "timeoff-holidays-session.json" },
  // The seed promotes this one, so Admin › Users and Admin › Server have a journey (F8).
  admin: { user: "admin", file: "admin-session.json" },
  categories: { user: "categories", file: "categories-session.json" },
  security: { user: "security", file: "security-session.json" },
  // F9: the layout and accessibility check (tests/e2e/<flow>/a11y.spec.ts).
  layout: { user: "layout", file: "layout-session.json" },
  // R5a and R5e: Settings › Addons and «Hide amounts» (tests/e2e/addons/).
  addons: { user: "addons", file: "addons-session.json" },
  hidden: { user: "hidden", file: "hidden-session.json" },
  // R5a: the first start (tests/e2e/welcome/).
  welcome: { user: "welcome", file: "welcome-session.json" },
  welcomeJourney: { user: "welcomeJourney", file: "welcome-journey-session.json" },
  // Release N2: the rows of the connections, in every state (tests/e2e/connections/connections.spec.ts).
  connections: { user: "connections", file: "connections-session.json" },
  // Release N3: the manual movement (tests/e2e/transactions/manual-movement.spec.ts).
  manual: { user: "manual", file: "manual-session.json" },
  // Release N3.1: a movement on its way to a source, and the categories of a source.
  sources: { user: "sources", file: "sources-session.json" },
  // Release N4b: the switch of an account to the bank (tests/e2e/accounts/account-switch.spec.ts).
  switching: { user: "switching", file: "switching-session.json" },
  // Release N3: "To review" and the automatic categories (tests/e2e/categories/review.spec.ts).
  review: { user: "review", file: "review-session.json" },
  reviewNew: { user: "reviewNew", file: "review-new-session.json" },
  // The journeys that change their data, on copies of the users of the screen check.
  reviewJourney: { user: "reviewJourney", file: "review-journey-session.json" },
  reviewNewJourney: { user: "reviewNewJourney", file: "review-new-journey-session.json" },
  manualJourney: { user: "manualJourney", file: "manual-journey-session.json" },
  beforeOpening: { user: "beforeOpening", file: "before-opening-session.json" },
  sendJourney: { user: "sendJourney", file: "send-journey-session.json" },
  sourceCategories: { user: "sourceCategories", file: "source-categories-session.json" },
  switchJourney: { user: "switchJourney", file: "switch-journey-session.json" },
  connectionsJourney: { user: "connectionsJourney", file: "connections-journey-session.json" },
  schedule: { user: "schedule", file: "schedule-session.json" },
  // Release N3.4: Settings › Rules (tests/e2e/categories/rules.spec.ts).
  rules: { user: "rules", file: "rules-session.json" },
  rulesJourney: { user: "rulesJourney", file: "rules-journey-session.json" },
  // H56 (PERS-619): the plugins' states (tests/e2e/connections/plugin-states.spec.ts).
  pluginsOff: { user: "pluginsOff", file: "plugins-off-session.json" },
  pluginsOn: { user: "pluginsOn", file: "plugins-on-session.json" },
  pluginsLive: { user: "pluginsLive", file: "plugins-live-session.json" },
  pluginsErrors: { user: "pluginsErrors", file: "plugins-errors-session.json" },
  pluginsMixed: { user: "pluginsMixed", file: "plugins-mixed-session.json" },
  pluginsDisconnected: { user: "pluginsDisconnected", file: "plugins-disconnected-session.json" },
  pluginsCleanup: { user: "pluginsCleanup", file: "plugins-cleanup-session.json" },
  pluginsGone: { user: "pluginsGone", file: "plugins-gone-session.json" },
  pluginsJourney: { user: "pluginsJourney", file: "plugins-journey-session.json" },
  // TOTP: sessions of users who still have to set it up, so they land on the setup page.
  enroll: { user: "enroll", file: "enroll-session.json" },
  pending: { user: "pending", file: "pending-session.json" },
} as const;

export const sessionState = (name: keyof typeof SESSIONS) => `${STATE_DIR}/${SESSIONS[name].file}`;

export const STATE_DIR = "tests/e2e/.state";

/** Each TOTP user's base32 secret, written by the seed, read by the specs that sign in by hand. */
export const TOTP_FILE = `${STATE_DIR}/totp.json`;

/** Each user's password, drawn by the seed for this run only; the folder is not in git. */
export const PASSWORDS_FILE = `${STATE_DIR}/passwords.json`;

/** The password the seed drew for this address. */
export function passwordOf(email: string): string {
  const passwords = JSON.parse(readFileSync(PASSWORDS_FILE, "utf8")) as Record<string, string>;
  const password = passwords[email];
  if (!password) throw new Error(`No password for ${email}: run the seed first`);
  return password;
}

/** The name the MCP spec registers its client under; the seed's remove deletes it (no owner, no cascade). */
export const E2E_MCP_CLIENT_NAME = "Ledgerly e2e MCP";
