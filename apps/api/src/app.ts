// `apps/api` (10-modularity.md §10.2): the HTTP entry of `/api/v1`. Until R4 the web process serves
// it: `apps/web`'s Hono app mounts this router (`apps/web/src/platform/api/app.ts`).
import { Hono } from "hono";
import { metaApi } from "./meta";

/** The routes of the contract this release serves, besides `/meta`. A module's step adds its own. */
const SERVED = [] as const;

export const apiRoutes = new Hono().route("/", metaApi(SERVED));
