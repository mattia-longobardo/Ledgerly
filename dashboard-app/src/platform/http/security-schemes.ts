/**
 * The `security` arrays route modules declare, in one place (Ruling P9-3).
 *
 * Both schemes are registered on the document in `app.ts`. `authenticate`
 * (`src/platform/http/authenticate.ts`) has accepted `Authorization: Bearer
 * pat_…` on every non-public route since Phase 8, but the route definitions
 * still advertised the session cookie alone — so the generated OpenAPI told a
 * token holder their token would not work, and every client generated from it
 * only knew how to send a cookie. Naming both here keeps the document honest
 * and keeps the next route from getting it wrong by copy-paste.
 *
 * Lives beside `app.ts` rather than in it because route modules import this as
 * a *value*: importing it from `app.ts` — which imports every route module —
 * would close an import cycle.
 */

import type { RouteConfig } from "@hono/zod-openapi";

/**
 * Annotated rather than inferred: without it TypeScript widens the array to a
 * union of two single-key object types, `createRoute` can no longer match it
 * against its own `security` field, and every `c.req.valid(...)` in the route
 * handler collapses to `never`.
 */
type Security = NonNullable<RouteConfig["security"]>;

/** A session cookie or a personal access token. The default for any authenticated route. */
export const AUTHENTICATED_SECURITY: Security = [{ session: [] }, { bearer: [] }];

/**
 * Session cookie only. For routes a token must not reach — today that is token
 * management itself, so a leaked token cannot mint its own successor (Ruling
 * P8-2). `src/modules/security/api/routes.ts` keeps its own local constant with
 * that reasoning attached; this one exists for anything that joins it later.
 */
export const SESSION_ONLY_SECURITY: Security = [{ session: [] }];
