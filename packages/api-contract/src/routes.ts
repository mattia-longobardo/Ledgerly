// Every route of the contract, in one list: `apps/api` serves them, the OpenAPI document and the
// MCP tools of the reads are generated from them (rewrite plan R2). A module's step adds its own.
import * as addons from "./addons";
import * as onboarding from "./onboarding";
import type { AddonId } from "./addons";
import * as accountLinks from "./accounts/links";
import * as accounts from "./accounts/accounts";
import * as balances from "./accounts/balances";
import * as removal from "./accounts/removal";
import * as accountSummary from "./accounts/summary";
import * as accountSwitch from "./accounts/switch";
import * as views from "./accounts/views";
import * as budgets from "./budgets/budgets";
import * as fundsHome from "./funds/funds";
import * as fundsRegister from "./funds/register";
import * as fundsSetup from "./funds/setup";
import * as imports from "./imports/imports";
import * as interests from "./interests/interests";
import * as investmentsConnection from "./investments/connection";
import * as investmentsFunds from "./investments/funds";
import * as investmentsInstruments from "./investments/instruments";
import * as investmentsPlans from "./investments/plans";
import * as investments from "./investments/investments";
import * as investmentsRegister from "./investments/register";
import { metaRoute } from "./meta";
import * as notifications from "./notifications";
import * as payrollCodes from "./payroll/codes";
import * as payroll from "./payroll/payroll";
import * as pockets from "./pockets/pockets";
import * as search from "./search";
import type { RouteContract } from "./route";
import * as banks from "./settings/banks";
import * as categories from "./settings/categories";
import * as categoryBoard from "./settings/category-board";
import * as connections from "./settings/connections";
import * as labels from "./settings/labels";
import * as people from "./settings/people";
import * as profile from "./settings/profile";
import * as security from "./settings/security";
import * as server from "./settings/server";
import * as sources from "./settings/sources";
import * as csv from "./transactions/csv";
import * as manual from "./transactions/manual";
import * as movements from "./transactions/movements";
import * as review from "./transactions/review";
import * as rules from "./transactions/rules";
import * as spending from "./transactions/spending";
import * as subscriptions from "./subscriptions/subscriptions";
import * as holidays from "./timeoff/holidays";
import * as timeoff from "./timeoff/timeoff";

/** The routes of users and settings by area, for `apps/api` to serve each one by name. */
export const SETTINGS = {
  profile,
  security,
  people,
  server,
  categories,
  categoryBoard,
  labels,
  connections,
  banks,
  sources,
} as const;

/** Users and settings, the first module of R2 (05-refactor.md §5.2). */
export const SETTINGS_ROUTES: readonly RouteContract[] = [
  ...Object.values(profile),
  ...Object.values(security),
  ...Object.values(people),
  ...Object.values(server),
  ...Object.values(categories),
  ...Object.values(categoryBoard),
  ...Object.values(labels),
  ...Object.values(connections),
  ...Object.values(banks),
  ...Object.values(sources),
];

/** Accounts by area, for `apps/api` to serve each one by name. */
export const ACCOUNTS = {
  accounts,
  balances,
  links: accountLinks,
  removal,
  switch: accountSwitch,
  summary: accountSummary,
  views,
} as const;

/** Accounts, the second module of R2 (05-refactor.md §5.2). */
export const ACCOUNTS_ROUTES: readonly RouteContract[] = Object.values(ACCOUNTS).flatMap((area) =>
  Object.values(area).filter((value): value is RouteContract => typeof value === "object" && "path" in value),
);

/** Transactions by area, for `apps/api` to serve each one by name. */
export const TRANSACTIONS = { movements, spending, manual, review, rules, csv } as const;

/** Transactions, the third module of R2 (05-refactor.md §5.2), and the search across modules. */
export const TRANSACTIONS_ROUTES: readonly RouteContract[] = [
  ...Object.values(TRANSACTIONS).flatMap((area) =>
    Object.values(area).filter(
      (value): value is RouteContract => typeof value === "object" && "path" in value,
    ),
  ),
  search.searchRecords,
];

/** Budgets by area, for `apps/api` to serve each one by name. */
export const BUDGETS = { budgets } as const;

/** Budgets, the fourth module of R2 (05-refactor.md §5.2). */
export const BUDGETS_ROUTES: readonly RouteContract[] = Object.values(budgets);

/** Pockets by area, for `apps/api` to serve each one by name. */
export const POCKETS = { pockets } as const;

/** Pockets, the fifth module of R2 (05-refactor.md §5.2). */
export const POCKETS_ROUTES: readonly RouteContract[] = Object.values(pockets);

/** Subscriptions by area, for `apps/api` to serve each one by name. */
export const SUBSCRIPTIONS = { subscriptions } as const;

/** Subscriptions, the sixth module of R2 (05-refactor.md §5.2). */
export const SUBSCRIPTIONS_ROUTES: readonly RouteContract[] = Object.values(subscriptions);

/** Interests by area, for `apps/api` to serve each one by name. */
export const INTERESTS = { interests } as const;

/** Interests, the seventh module of R2 (05-refactor.md §5.2). */
export const INTERESTS_ROUTES: readonly RouteContract[] = Object.values(interests);

/** Time off by area, for `apps/api` to serve each one by name. */
export const TIMEOFF = { timeoff, holidays } as const;

/** Time off, the eighth module of R2 (05-refactor.md §5.2), with its holiday calendars (TOF-6). */
export const TIMEOFF_ROUTES: readonly RouteContract[] = [
  ...Object.values(timeoff),
  ...Object.values(holidays),
];

/** Payroll by area, for `apps/api` to serve each one by name. */
export const PAYROLL = { payroll, codes: payrollCodes } as const;

/** Payroll, the ninth module of R2 (05-refactor.md §5.2): the register, the review and the code map. */
export const PAYROLL_ROUTES: readonly RouteContract[] = [
  ...Object.values(payroll),
  ...Object.values(payrollCodes),
];

/** Imports by area, for `apps/api` to serve each one by name. */
export const IMPORTS = { imports } as const;

/** Imports, the tenth module of R2 (05-refactor.md §5.2): the upload of a document. */
export const IMPORTS_ROUTES: readonly RouteContract[] = [imports.uploadDocument];

/** Funds by area, for `apps/api` to serve each one by name. */
export const FUNDS = { funds: fundsHome, register: fundsRegister, setup: fundsSetup } as const;

/** Funds, the eleventh module of R2 (05-refactor.md §5.2): the home, a fund's tabs and their writes. */
export const FUNDS_ROUTES: readonly RouteContract[] = [
  ...Object.values(fundsHome),
  ...Object.values(fundsRegister),
  ...Object.values(fundsSetup),
];

/** Investments by area, for `apps/api` to serve each one by name. */
export const INVESTMENTS = {
  investments,
  funds: investmentsFunds,
  register: investmentsRegister,
  connection: investmentsConnection,
  instruments: investmentsInstruments,
  plans: investmentsPlans,
} as const;

/** Investments, the twelfth module of R2 (05-refactor.md §5.2): the pages' reads and their writes. */
export const INVESTMENTS_ROUTES: readonly RouteContract[] = [
  ...Object.values(investments),
  ...Object.values(investmentsFunds),
  ...Object.values(investmentsRegister),
  ...Object.values(investmentsConnection),
  investmentsInstruments.searchInstruments,
  investmentsPlans.listPlans,
  investmentsPlans.createPlan,
  investmentsPlans.updatePlan,
  investmentsPlans.listPlanRuns,
  investmentsPlans.confirmPlanRun,
  investmentsPlans.skipPlanRun,
  investmentsPlans.backfillPlan,
];

/** The Addons of a person (R5a, H52): which modules are on. */
export const ADDONS_ROUTES: readonly RouteContract[] = [addons.getAddons, addons.setAddon];

/** The alerts of a person (R5e): «Da fare», the apps' periodic check, the channels of each event. */
export const NOTIFICATIONS_ROUTES: readonly RouteContract[] = [
  notifications.listTodo,
  notifications.listNotifications,
  notifications.markNotificationRead,
  notifications.getNotificationPreferences,
  notifications.setNotificationPreference,
];
/** The first start and the defaults of the instance (R5a, E4, E8). */
export const ONBOARDING = onboarding;
export const ONBOARDING_ROUTES: readonly RouteContract[] = Object.values(onboarding);

export const CONTRACT_ROUTES: readonly RouteContract[] = [
  metaRoute,
  ...SETTINGS_ROUTES,
  ...ADDONS_ROUTES,
  ...NOTIFICATIONS_ROUTES,
  ...ONBOARDING_ROUTES,
  ...ACCOUNTS_ROUTES,
  ...TRANSACTIONS_ROUTES,
  ...BUDGETS_ROUTES,
  ...POCKETS_ROUTES,
  ...SUBSCRIPTIONS_ROUTES,
  ...INTERESTS_ROUTES,
  ...TIMEOFF_ROUTES,
  ...PAYROLL_ROUTES,
  ...IMPORTS_ROUTES,
  ...FUNDS_ROUTES,
  ...INVESTMENTS_ROUTES,
];

// The addon each module's routes belong to (H52, PA10): a route of an addon that is off answers
// `module_inactive`, on REST and MCP alike. A route not listed is of a base module.
const ROUTE_ADDONS = new Map<string, AddonId>(
  (
    [
      // The pension funds are part of Investments since R5b (13-plugins-addons.md §13.7).
      ["investments", [...INVESTMENTS_ROUTES, ...FUNDS_ROUTES]],
      ["payroll", [...PAYROLL_ROUTES, ...IMPORTS_ROUTES]],
      ["timeoff", TIMEOFF_ROUTES],
      ["budgets", BUDGETS_ROUTES],
      ["subscriptions", SUBSCRIPTIONS_ROUTES],
      ["pockets", POCKETS_ROUTES],
      ["interests", INTERESTS_ROUTES],
    ] as const
  ).flatMap(([addon, routes]) => routes.map((route) => [route.id, addon] as const)),
);

/** The addon a route belongs to, or null for a route of a base module. */
export function addonOf(route: Pick<RouteContract, "id">): AddonId | null {
  return ROUTE_ADDONS.get(route.id) ?? null;
}
