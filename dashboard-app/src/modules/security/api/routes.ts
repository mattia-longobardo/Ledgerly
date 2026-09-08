import { createRoute } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import { withUserContext } from "@/platform/db/context";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { createToken } from "../application/create-token";
import { InvalidInputError, NotFoundError } from "../application/errors";
import { listTokens } from "../application/list-tokens";
import type { TokenRecord } from "../application/ports";
import { revokeToken } from "../application/revoke-token";
import { securityDeps } from "../infrastructure/deps";
import {
  CreateSecurityTokenRequestSchema,
  CreatedSecurityTokenSchema,
  SecurityTokenIdParamSchema,
  SecurityTokenListResponseSchema,
} from "./schemas";

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module,
 * matching accounts, interests, funds, budgets and time off.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse(
    "The request was authenticated by a personal access token rather than the session cookie (`permission_denied`), or a cookie-authenticated write was sent without `X-Requested-With` (`csrf_required`).",
  ),
  404: errorResponse("Not found (`not_found`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `SecurityTokenSchema` declares. `TokenRecord` also
 * carries `userId`, and the row behind it carries the hash — never spread a
 * domain object into a body.
 */
function tokenDto(token: TokenRecord) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    revokedAt: token.revokedAt ? token.revokedAt.toISOString() : null,
    createdAt: token.createdAt.toISOString(),
  };
}

/**
 * Ruling P8-2. A token must not be able to mint or revoke tokens: that would
 * turn one leaked credential into a permanent, self-renewing foothold that
 * survives revoking the token it came from. These three routes are therefore
 * reachable only with the session cookie, whatever scopes a token carries.
 */
function requireSessionAuth(method: string): void {
  if (method !== "session") {
    throw new ApiError(
      403,
      "permission_denied",
      "Personal access tokens are managed from a signed-in session, not with a token.",
    );
  }
}

const SECURITY_SESSION = [{ session: [] }];

const listTokensRoute = createRoute({
  method: "get",
  path: "/security/tokens",
  tags: ["Security"],
  security: SECURITY_SESSION,
  responses: {
    200: {
      description: "The caller's own tokens, newest first. Never the token or its hash.",
      content: { "application/json": { schema: SecurityTokenListResponseSchema } },
    },
    ...commonErrorResponses,
  },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/security/tokens",
  tags: ["Security"],
  security: SECURITY_SESSION,
  request: { body: { content: { "application/json": { schema: CreateSecurityTokenRequestSchema } } } },
  responses: {
    201: {
      description: "The new token. `token` is present in this response only and cannot be retrieved again.",
      content: { "application/json": { schema: CreatedSecurityTokenSchema } },
    },
    ...commonErrorResponses,
  },
});

const revokeTokenRoute = createRoute({
  method: "delete",
  path: "/security/tokens/{id}",
  tags: ["Security"],
  security: SECURITY_SESSION,
  request: { params: SecurityTokenIdParamSchema },
  responses: { 204: { description: "Revoked." }, ...commonErrorResponses },
});

export function registerSecurityRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listTokensRoute, async (c) => {
    requireSessionAuth(c.get("authMethod"));
    const principal = c.get("principal");
    const tokens = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
      listTokens(securityDeps(tx, c.get("requestId"), deps.now))(principal),
    );
    return c.json({ items: tokens.map(tokenDto) }, 200);
  });

  app.openapi(createTokenRoute, async (c) => {
    requireSessionAuth(c.get("authMethod"));
    const principal = c.get("principal");
    const body = c.req.valid("json");
    try {
      const created = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        createToken(securityDeps(tx, c.get("requestId"), deps.now))(principal, {
          name: body.name,
          scopes: body.scopes,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        }),
      );
      return c.json({ ...tokenDto(created.record), token: created.token }, 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(revokeTokenRoute, async (c) => {
    requireSessionAuth(c.get("authMethod"));
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        revokeToken(securityDeps(tx, c.get("requestId"), deps.now))(principal, id),
      );
      return c.body(null, 204);
    } catch (err) {
      throw toApiError(err);
    }
  });
}
