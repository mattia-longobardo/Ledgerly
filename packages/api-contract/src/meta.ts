// `GET /api/v1/meta` (rewrite plan R2, 07-apps.md §7.1 constraint 6): what an app reads before
// anything else, without a token. The API only grows (OpenAPI «solo additivo»): an app newer than
// the instance hides the capabilities the instance does not list, and an instance below the app's
// minimum level leaves the app read-only on its cache.
import { z } from "zod";
import { defineRoute } from "./route";
import { CONTRACT_SCOPES } from "./scopes";

/** The level of the API: it grows when a release adds routes a client may depend on. */
export const API_LEVEL = 1;

/** The lowest client level this server still answers in full. */
export const MIN_CLIENT_LEVEL = 1;

export const metaRoute = defineRoute({
  id: "get_meta",
  method: "GET",
  path: "/meta",
  scope: null,
  capability: "meta",
  summary: "The version of the instance, the level of its API and what it can do.",
  actions: [],
  response: z.object({
    version: z.string(),
    apiLevel: z.number().int(),
    minClientLevel: z.number().int(),
    /** The capabilities of the routes this instance serves, sorted. */
    capabilities: z.array(z.string()),
    scopes: z.array(z.enum(CONTRACT_SCOPES)),
  }),
  errors: [],
  example: {
    response: {
      version: "0.37.0",
      apiLevel: 1,
      minClientLevel: 1,
      capabilities: ["meta", "preferences"],
      scopes: ["read", "write"],
    },
  },
});
