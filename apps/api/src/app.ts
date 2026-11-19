// `apps/api` (10-modularity.md §10.2): the HTTP entry of `/api/v1`. Until R4 the web process serves
// it: `apps/web`'s Hono app mounts this router with its adapters (`apps/web/src/platform/api/app.ts`).
import { Hono } from "hono";
import { type AccountCases, serveAccounts } from "./accounts/routes";
import { metaApi } from "./meta";
import type { ApiEnv, Guard } from "./serve";
import { serveTaxonomy } from "./settings/categories";
import { serveCategoryMoves } from "./settings/category-moves";
import { type ConnectionCases, serveConnections } from "./settings/connections";
import { serveProfile } from "./settings/profile";
import { serveSecurityAndPeople } from "./settings/security";
import { type ServerCases, serveServer } from "./settings/server";
import type { SourceName } from "./settings/taxonomy";

/**
 * What the web process lends the API until R4: its guard (`withToken`, so authentication lives
 * once) and the names of the sources (its registry of providers, until E5).
 */
export interface Adapters {
  guard: Guard;
  sourceName: SourceName;
  /** The use cases of the connections and the banks, until E5 and R4. */
  connections: ConnectionCases;
  /** The maintenance of the instance, until R4. */
  server: ServerCases;
  /** The compositions of accounts the web still holds (deletion, switch, monthly figures), until R4. */
  accounts: AccountCases;
}

/** Every module's routes, served behind the guard; `/meta` lists their capabilities. */
export function apiRoutes({ guard, sourceName, connections, server, accounts }: Adapters): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const served = [
    ...serveProfile(app, guard),
    ...serveTaxonomy(app, guard),
    ...serveCategoryMoves(app, guard, sourceName),
    ...serveConnections(app, guard, connections),
    ...serveSecurityAndPeople(app, guard),
    ...serveServer(app, guard, server),
    ...serveAccounts(app, guard, accounts),
  ];
  app.route("/", metaApi(served));
  return app;
}
