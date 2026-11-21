// `apps/api` (10-modularity.md §10.2): the HTTP entry of `/api/v1`. Until R4 the web process serves
// it: `apps/web`'s Hono app mounts this router with its adapters (`apps/web/src/platform/api/app.ts`).
import { Hono } from "hono";
import { type AccountCases, serveAccounts } from "./accounts/routes";
import { serveBudgets } from "./budgets/routes";
import { serveFunds } from "./funds/routes";
import { serveImports } from "./imports/routes";
import { serveInterests } from "./interests/routes";
import { type InvestmentCases, serveInvestments } from "./investments/routes";
import { servePayroll } from "./payroll/routes";
import { serveTimeOff } from "./timeoff/routes";
import { servePockets } from "./pockets/routes";
import { serveSubscriptions } from "./subscriptions/routes";
import { metaApi } from "./meta";
import type { ApiEnv, Guard } from "./serve";
import { serveTaxonomy } from "./settings/categories";
import { serveCategoryBoard } from "./settings/category-board";
import { serveCategoryMoves } from "./settings/category-moves";
import { type ConnectionCases, serveConnections } from "./settings/connections";
import { serveProfile } from "./settings/profile";
import { serveSecurityAndPeople } from "./settings/security";
import { type ServerCases, serveServer } from "./settings/server";
import type { SourceName } from "./settings/taxonomy";
import type { TransactionCases } from "./transactions/cases";
import { serveTransactions } from "./transactions/routes";

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
  /** The manual movement, the source of a movement and the queue, until R4 and R5c. */
  transactions: TransactionCases;
  /** The queue of the worker, for «Sync now» and a new connection, until R4. */
  investments: InvestmentCases;
}

/** Every module's routes, served behind the guard; `/meta` lists their capabilities. */
export function apiRoutes({
  guard,
  sourceName,
  connections,
  server,
  accounts,
  transactions,
  investments,
}: Adapters): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const served = [
    ...serveProfile(app, guard),
    ...serveTaxonomy(app, guard),
    ...serveCategoryMoves(app, guard, sourceName),
    ...serveCategoryBoard(app, guard, sourceName),
    ...serveConnections(app, guard, connections),
    ...serveSecurityAndPeople(app, guard),
    ...serveServer(app, guard, server),
    ...serveAccounts(app, guard, accounts),
    ...serveTransactions(app, guard, transactions),
    ...serveBudgets(app, guard),
    ...servePockets(app, guard),
    ...serveSubscriptions(app, guard),
    ...serveInterests(app, guard),
    ...serveTimeOff(app, guard),
    ...servePayroll(app, guard),
    ...serveImports(app, guard),
    ...serveFunds(app, guard),
    ...serveInvestments(app, guard, investments),
  ];
  app.route("/", metaApi(served));
  return app;
}
