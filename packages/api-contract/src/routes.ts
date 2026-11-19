// Every route of the contract, in one list: `apps/api` serves them, the OpenAPI document and the
// MCP tools of the reads are generated from them (rewrite plan R2). A module's step adds its own.
import * as accountLinks from "./accounts/links";
import * as accounts from "./accounts/accounts";
import * as balances from "./accounts/balances";
import * as removal from "./accounts/removal";
import * as accountSummary from "./accounts/summary";
import * as accountSwitch from "./accounts/switch";
import * as views from "./accounts/views";
import { metaRoute } from "./meta";
import type { RouteContract } from "./route";
import * as banks from "./settings/banks";
import * as categories from "./settings/categories";
import * as connections from "./settings/connections";
import * as labels from "./settings/labels";
import * as people from "./settings/people";
import * as profile from "./settings/profile";
import * as security from "./settings/security";
import * as server from "./settings/server";

/** The routes of users and settings by area, for `apps/api` to serve each one by name. */
export const SETTINGS = {
  profile,
  security,
  people,
  server,
  categories,
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

export const CONTRACT_ROUTES: readonly RouteContract[] = [metaRoute, ...SETTINGS_ROUTES, ...ACCOUNTS_ROUTES];
