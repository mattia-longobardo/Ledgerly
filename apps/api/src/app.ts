// `apps/api` (10-modularity.md §10.2): the HTTP entry of `/api/v1`. Until R4 the web process serves
// it: `apps/web`'s Hono app mounts this router with its guard (`apps/web/src/platform/api/app.ts`).
import { Hono } from "hono";
import { metaApi } from "./meta";
import type { ApiEnv, Guard } from "./serve";
import { serveProfile } from "./settings/profile";

/** Every module's routes, served behind the guard; `/meta` lists their capabilities. */
export function apiRoutes(guard: Guard): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const served = [...serveProfile(app, guard)];
  app.route("/", metaApi(served));
  return app;
}
