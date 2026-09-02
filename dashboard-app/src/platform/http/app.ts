import { OpenAPIHono } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db/client";
import { PermissionDeniedError, type Principal } from "@/platform/auth/principal";
import { ApiError, toErrorBody } from "./errors";
import { rateLimit } from "./rate-limit";

export interface ApiDeps {
  db: DbClient;
  authenticate(req: Request): Promise<Principal | null>;
  now(): Date;
  /** Set to false to skip the Postgres-backed limiter, e.g. in unit tests without a db. */
  rateLimitEnabled?: boolean;
}
export type ApiEnv = { Variables: { principal: Principal; requestId: string } };
export type ApiApp = OpenAPIHono<ApiEnv>;

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
    const principal = await deps.authenticate(c.req.raw);
    if (!principal) throw new ApiError(401, "unauthorized", "Sign in to use the API");
    c.set("principal", principal);
    await next();
  });

  if (deps.rateLimitEnabled !== false) app.use("*", rateLimit({ db: deps.db, now: deps.now }));

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

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Finance Dashboard API", version: "1.0.0" },
    servers: [{ url: "/api/v1" }],
  });

  registerAllRoutes(app, deps);
  return app;
}

/** Route modules register here; Task 18 adds accounts. */
export function registerAllRoutes(_app: ApiApp, _deps: ApiDeps): void {}
