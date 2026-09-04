import { OpenAPIHono } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db/client";
import { PermissionDeniedError, type Principal } from "@/platform/auth/principal";
import { registerAccountRoutes } from "@/modules/accounts/api/routes";
import { registerIntegrationRoutes } from "@/modules/integrations/api/routes";
import { registerExpenseRoutes } from "@/modules/expenses/api/routes";
import { ApiError, toErrorBody } from "./errors";
import { rateLimit } from "./rate-limit";

/**
 * How the caller proved who they are. Cookie-authenticated requests are the
 * ones a third-party page can make on the user's behalf, so only those need the
 * CSRF header below; a token, once it exists (Phase 8), is never sent
 * automatically by a browser and so is exempt.
 */
export type AuthMethod = "session" | "token";

export interface Authenticated {
  principal: Principal;
  method: AuthMethod;
}

export interface ApiDeps {
  db: DbClient;
  authenticate(req: Request): Promise<Authenticated | null>;
  now(): Date;
  /** Set to false to skip the Postgres-backed limiter, e.g. in unit tests without a db. */
  rateLimitEnabled?: boolean;
}
export type ApiEnv = { Variables: { principal: Principal; authMethod: AuthMethod; requestId: string } };
export type ApiApp = OpenAPIHono<ApiEnv>;

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that authenticate themselves. Only the inbound webhook qualifies
 * today: it carries no cookie and no token, and proves itself with an HMAC
 * over the raw body under the receiving connection's own secret.
 *
 * `c.req.path` is the full request pathname, basePath included, so these are
 * absolute.
 */
const PUBLIC_PREFIXES = ["/api/v1/webhooks/"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function createApiApp(deps: ApiDeps): ApiApp {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError(422, "validation_failed", "Request validation failed", result.error.issues);
      }
    },
  }).basePath("/api/v1");

  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("x-request-id") ?? randomUUID());
    await next();
    c.header("x-request-id", c.get("requestId"));
  });

  app.use("*", async (c, next) => {
    if (isPublic(c.req.path)) return next();
    const authenticated = await deps.authenticate(c.req.raw);
    if (!authenticated) throw new ApiError(401, "unauthorized", "Sign in to use the API");
    c.set("principal", authenticated.principal);
    c.set("authMethod", authenticated.method);
    await next();
  });

  /**
   * Spec §8.3. A cookie rides along on any cross-site form post, so a writing
   * request authenticated by one has to carry something a cross-site form
   * cannot set. `X-Requested-With` is that something: adding a custom header
   * puts the request behind a CORS preflight, which this app answers for
   * nobody.
   *
   * The inbound webhook is exempt (`isPublic`): it carries no cookie at all —
   * `authMethod` is never set on that path — and is verified by HMAC instead.
   */
  app.use("*", async (c, next) => {
    if (isPublic(c.req.path)) return next();
    if (
      UNSAFE_METHODS.has(c.req.method.toUpperCase()) &&
      c.get("authMethod") === "session" &&
      !(c.req.header("x-requested-with") ?? "").trim()
    ) {
      throw new ApiError(403, "csrf_required", "Send the X-Requested-With header with cookie-authenticated requests");
    }
    await next();
  });

  if (deps.rateLimitEnabled !== false) {
    // The limiter counts per principal, and a webhook has none — calling it on
    // a public path would throw on `c.get("principal").userId`. Rate limiting
    // the webhook endpoint is a Phase 9 concern and needs a different key
    // (the connection, or the source address), not this one.
    // `rateLimit<ApiEnv>`, not a cast on the result: `rateLimit` is generic in
    // the caller's env (constrained to what it actually reads), so this asks
    // it for a handler typed against `ApiEnv` directly rather than silencing a
    // mismatch after the fact — a real one, if this middleware ever grows to
    // read a second `Variables` key `ApiEnv` doesn't carry, would still fail
    // to typecheck here.
    const limiter = rateLimit<ApiEnv>({ db: deps.db, now: deps.now });
    app.use("*", (c, next) => (isPublic(c.req.path) ? next() : limiter(c, next)));
  }

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (err instanceof ApiError) return c.json(toErrorBody(err, requestId), err.status as 400);
    if (err instanceof PermissionDeniedError) {
      return c.json(toErrorBody(new ApiError(403, "permission_denied", err.message), requestId), 403);
    }
    console.error(JSON.stringify({ level: "error", event: "api_unhandled", requestId, name: err.name }));
    return c.json(toErrorBody(new ApiError(500, "internal", "Something went wrong"), requestId), 500);
  });
  app.notFound((c) =>
    c.json(toErrorBody(new ApiError(404, "not_found", "No such route"), c.get("requestId") ?? "unknown"), 404),
  );

  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "__Host-authjs.session-token",
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Finance Dashboard API", version: "1.0.0" },
    // Every path key is already absolute (`/api/v1/...`), so the server must be
    // the origin root: anything else and a consumer resolves `/api/v1/api/v1/...`.
    servers: [{ url: "/" }],
  });

  registerAllRoutes(app, deps);
  return app;
}

/** Route modules register here. */
export function registerAllRoutes(app: ApiApp, deps: ApiDeps): void {
  registerAccountRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerExpenseRoutes(app, deps);
}
