// `apps/api` (10-modularity.md §10.2): the HTTP entry of `/api/v1`. Until R4 the web process serves
// it: `apps/web`'s Hono app mounts this router with its adapters (`apps/web/src/platform/api/app.ts`).
import { Hono } from "hono";
import { metaApi } from "./meta";
import type { ApiEnv, Guard } from "./serve";
import { serveTaxonomy } from "./settings/categories";
import { serveCategoryMoves } from "./settings/category-moves";
import { serveProfile } from "./settings/profile";
import type { SourceName } from "./settings/taxonomy";

/**
 * What the web process lends the API until R4: its guard (`withToken`, so authentication lives
 * once) and the names of the sources (its registry of providers, until E5).
 */
interface Adapters {
  guard: Guard;
  sourceName: SourceName;
}

/** Every module's routes, served behind the guard; `/meta` lists their capabilities. */
export function apiRoutes({ guard, sourceName }: Adapters): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const served = [
    ...serveProfile(app, guard),
    ...serveTaxonomy(app, guard),
    ...serveCategoryMoves(app, guard, sourceName),
  ];
  app.route("/", metaApi(served));
  return app;
}
