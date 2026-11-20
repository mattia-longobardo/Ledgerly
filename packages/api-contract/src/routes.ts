// Every route of the contract, in one list: `apps/api` serves them, the OpenAPI document and the
// MCP tools of the reads are generated from them (rewrite plan R2). A module's step adds its own.
import * as accountLinks from "./accounts/links";
import * as accounts from "./accounts/accounts";
import * as balances from "./accounts/balances";
import * as removal from "./accounts/removal";
import * as accountSummary from "./accounts/summary";
import * as accountSwitch from "./accounts/switch";
import * as views from "./accounts/views";
import * as budgets from "./budgets/budgets";
import { metaRoute } from "./meta";
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
import * as manual from "./transactions/manual";
import * as movements from "./transactions/movements";
import * as review from "./transactions/review";
import * as rules from "./transactions/rules";
import * as spending from "./transactions/spending";

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
export const TRANSACTIONS = { movements, spending, manual, review, rules } as const;

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

export const CONTRACT_ROUTES: readonly RouteContract[] = [
  metaRoute,
  ...SETTINGS_ROUTES,
  ...ACCOUNTS_ROUTES,
  ...TRANSACTIONS_ROUTES,
  ...BUDGETS_ROUTES,
  ...POCKETS_ROUTES,
];
