// `GET /api/v1/meta` (rewrite plan R2): served without a token, because an app reads it before it
// signs in, to know whether the instance is new enough. It names no user and no data.
import { Hono } from "hono";
import { API_LEVEL, type ContractScope, MIN_CLIENT_LEVEL, metaRoute } from "@ledgerly/api-contract";
import type { RouteContract } from "@ledgerly/api-contract";
import { API_SCOPES } from "@ledgerly/domain/platform/auth";
import { APP_VERSION } from "@ledgerly/domain/platform/version";

// The scopes the authorization server grants, typed as scopes of the contract: a scope it grants and
// the contract does not name fails the build, because it would be a door nobody described.
const GRANTED: readonly ContractScope[] = API_SCOPES;

/** The router of `/meta`, for the routes the instance serves. */
export function metaApi(served: readonly RouteContract[]): Hono {
  const capabilities = [...new Set([metaRoute, ...served].map((route) => route.capability))].sort();
  const body = metaRoute.response.parse({
    version: APP_VERSION,
    apiLevel: API_LEVEL,
    minClientLevel: MIN_CLIENT_LEVEL,
    capabilities,
    scopes: [...GRANTED],
  });
  return new Hono().get(metaRoute.path, (context) => context.json(body));
}
