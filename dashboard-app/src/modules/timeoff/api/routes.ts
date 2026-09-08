import { createRoute } from "@hono/zod-openapi";
import { AUTHENTICATED_SECURITY } from "@/platform/http/security-schemes";
import { getCachedTrekStats } from "@/lib/repo/trek-state";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { withUserContext } from "@/platform/db/context";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { ensureDefaultTypes } from "../application/ensure-default-types";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { getWorkspace, type BalanceView, type TimeoffWorkspace } from "../application/get-workspace";
import { listBalances } from "../application/list-balances";
import { listEvents } from "../application/list-events";
import type { TimeoffBalance, TimeoffEvent, TimeoffType } from "../application/ports";
import { removeEvent } from "../application/remove-event";
import { setEvent } from "../application/set-event";
import { timeoffDeps } from "../infrastructure/deps";
import {
  SetTimeoffEventRequestSchema,
  TimeoffBalanceListResponseSchema,
  TimeoffBalancesQuerySchema,
  TimeoffDateParamSchema,
  TimeoffEventListResponseSchema,
  TimeoffEventSchema,
  TimeoffEventsQuerySchema,
  TimeoffTypeListResponseSchema,
  TimeoffWorkspaceQuerySchema,
  TimeoffWorkspaceSchema,
} from "./schemas";

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module,
 * matching accounts, interests, funds and budgets.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("Version conflict (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields the wire schema declares. The domain `TimeoffType`
 * also carries `userId` — never product data a response should expose. Never
 * spread a domain object into a body: it leaks whatever the domain type adds
 * next, silently, past the OpenAPI contract.
 */
function typeDto(type: TimeoffType) {
  return {
    id: type.id,
    code: type.code,
    label: type.label,
    unit: type.unit,
    hoursPerDay: type.hoursPerDay,
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  };
}

/** Drops `userId` and `typeId` — `typeCode` is the wire identity of an event's type. */
function eventDto(event: TimeoffEvent) {
  return {
    id: event.id,
    date: event.date,
    fraction: event.fraction,
    typeCode: event.typeCode,
    status: event.status,
    origin: event.origin,
    pendingOp: event.pendingOp,
    note: event.note,
    syncedAt: event.syncedAt ? event.syncedAt.toISOString() : null,
    trekEntryId: event.trekEntryId,
    version: event.version,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/** Drops `userId` and `payrollRecordId`; `source` already carries the provenance. */
function balanceDto(balance: TimeoffBalance) {
  return {
    id: balance.id,
    typeId: balance.typeId,
    asOf: balance.asOf,
    accrued: balance.accrued,
    used: balance.used,
    remaining: balance.remaining,
    pending: balance.pending,
    unit: balance.unit,
    source: balance.source,
    createdAt: balance.createdAt.toISOString(),
  };
}

function balanceViewDto(view: BalanceView) {
  return {
    type: typeDto(view.type),
    asOf: view.asOf,
    remainingHours: view.remainingHours,
    remainingDays: view.remainingDays,
    usedYtdHours: view.usedYtdHours,
    source: view.source,
  };
}

function workspaceDto(workspace: TimeoffWorkspace) {
  return {
    year: workspace.year,
    today: workspace.today,
    types: workspace.types.map(typeDto),
    balances: workspace.balances.map(balanceViewDto),
    byDate: workspace.byDate,
    selected: workspace.selected
      ? {
          date: workspace.selected.date,
          event: workspace.selected.event ? eventDto(workspace.selected.event) : null,
          status: workspace.selected.status,
        }
      : null,
    upcoming: workspace.upcoming.map(eventDto),
    plannedDaysYtd: workspace.plannedDaysYtd,
    pendingCount: workspace.pendingCount,
    trekConnected: workspace.trekConnected,
    cachedStats: workspace.cachedStats,
  };
}

const listTypesRoute = createRoute({
  method: "get",
  path: "/timeoff/types",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  responses: { 200: { description: "The caller's time off types, seeded on first call.", content: { "application/json": { schema: TimeoffTypeListResponseSchema } } }, ...commonErrorResponses },
});

const workspaceRoute = createRoute({
  method: "get",
  path: "/timeoff/workspace",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  request: { query: TimeoffWorkspaceQuerySchema },
  responses: { 200: { description: "One year of time off: types, balances, every booked day, and the Trek state.", content: { "application/json": { schema: TimeoffWorkspaceSchema } } }, ...commonErrorResponses },
});

const listEventsRoute = createRoute({
  method: "get",
  path: "/timeoff/events",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  request: { query: TimeoffEventsQuerySchema },
  responses: { 200: { description: "Booked days in the range, `date asc`.", content: { "application/json": { schema: TimeoffEventListResponseSchema } } }, ...commonErrorResponses },
});

/**
 * PUT, not POST, and no `Idempotency-Key`: a day is addressed by its own date,
 * so the write is idempotent by construction, and a booked day is not a
 * financial record — it is an intention the Trek sync carries upstream.
 */
const setEventRoute = createRoute({
  method: "put",
  path: "/timeoff/events/{date}",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  request: { params: TimeoffDateParamSchema, body: { content: { "application/json": { schema: SetTimeoffEventRequestSchema } } } },
  responses: { 200: { description: "The staged day.", content: { "application/json": { schema: TimeoffEventSchema } } }, ...commonErrorResponses },
});

const removeEventRoute = createRoute({
  method: "delete",
  path: "/timeoff/events/{date}",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  request: { params: TimeoffDateParamSchema },
  responses: { 204: { description: "Removed, or staged for removal upstream." }, ...commonErrorResponses },
});

const listBalancesRoute = createRoute({
  method: "get",
  path: "/timeoff/balances",
  tags: ["Time off"],
  security: AUTHENTICATED_SECURITY,
  request: { query: TimeoffBalancesQuerySchema },
  responses: { 200: { description: "Every balance row whose `asOf` falls in the year, oldest first.", content: { "application/json": { schema: TimeoffBalanceListResponseSchema } } }, ...commonErrorResponses },
});

export function registerTimeoffRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listTypesRoute, async (c) => {
    const principal = c.get("principal");
    const types = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
      ensureDefaultTypes(timeoffDeps(tx, c.get("requestId")))(principal),
    );
    return c.json({ items: types.map(typeDto) }, 200);
  });

  app.openapi(workspaceRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const year = query.year ?? deps.now().getUTCFullYear();
    // Both resolved BEFORE the timeoff context opens: `inUserContext` opens one
    // of its own, and the shared conventions forbid nesting them.
    const trekConnected = await integrationDeps(deps.db, c.get("requestId")).inUserContext(
      principal.userId,
      async (d) => (await d.connections.getByProvider(principal.userId, "trek"))?.status === "connected",
    );
    const cachedStats = await getCachedTrekStats(principal.userId, year);
    try {
      const workspace = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getWorkspace(timeoffDeps(tx, c.get("requestId")))(principal, {
          year,
          selectedDate: query.date ?? null,
          trekConnected,
          cachedStats,
        }),
      );
      return c.json(workspaceDto(workspace), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listEventsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    try {
      const events = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listEvents(timeoffDeps(tx, c.get("requestId")))(principal, query),
      );
      return c.json({ items: events.map(eventDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(setEventRoute, async (c) => {
    const principal = c.get("principal");
    const { date } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const event = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        setEvent(timeoffDeps(tx, c.get("requestId")))(principal, {
          date,
          fraction: body.fraction,
          typeCode: body.typeCode,
          note: body.note ?? null,
        }),
      );
      return c.json(eventDto(event), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(removeEventRoute, async (c) => {
    const principal = c.get("principal");
    const { date } = c.req.valid("param");
    try {
      await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        removeEvent(timeoffDeps(tx, c.get("requestId")))(principal, date),
      );
      return c.body(null, 204);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listBalancesRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const year = query.year ?? deps.now().getUTCFullYear();
    const balances = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
      listBalances(timeoffDeps(tx, c.get("requestId")))(principal, year),
    );
    return c.json({ items: balances.map(balanceDto) }, 200);
  });
}
