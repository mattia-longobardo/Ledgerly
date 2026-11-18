// Every route of the contract, in one list: `apps/api` serves them, the OpenAPI document and the
// MCP tools of the reads are generated from them (rewrite plan R2). A module's step adds its own.
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

export const CONTRACT_ROUTES: readonly RouteContract[] = [metaRoute, ...SETTINGS_ROUTES];
