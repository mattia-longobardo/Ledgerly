import { createRoute } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { idempotency } from "@/platform/http/idempotency";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { addAllocation } from "../application/add-allocation";
import { addManualUsage } from "../application/add-manual-usage";
import { createBudget } from "../application/create-budget";
import { deleteManualUsage } from "../application/delete-manual-usage";
import { endAllocation } from "../application/end-allocation";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { getBudgetDetail, type AllocationView, type BudgetDetail } from "../application/get-budget-detail";
import { listBudgets, type BudgetSummary } from "../application/list-budgets";
import type { Allocation, AmountVersion, Budget, BudgetEvent, Scope, Usage } from "../application/ports";
import { refreshUsages } from "../application/refresh-usages";
import { setInitialAmount } from "../application/set-initial-amount";
import { setScopes } from "../application/set-scopes";
import { updateBudget } from "../application/update-budget";
import { budgetDeps } from "../infrastructure/deps";
import {
  AddAllocationRequestSchema,
  AddManualUsageRequestSchema,
  AllocationIdParamSchema,
  AllocationSchema,
  AmountVersionSchema,
  BudgetDetailSchema,
  BudgetIdParamSchema,
  BudgetListResponseSchema,
  BudgetSchema,
  CreateBudgetRequestSchema,
  EndAllocationRequestSchema,
  IfMatchHeaderSchema,
  ListBudgetsQuerySchema,
  RefreshUsagesResultSchema,
  ScopesResponseSchema,
  SetInitialAmountRequestSchema,
  SetScopesRequestSchema,
  UpdateBudgetRequestSchema,
  UsageIdParamSchema,
  UsageSchema,
} from "./schemas";

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module,
 * matching accounts, interests and funds.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("The budget, allocation, or usage does not exist for this caller (`not_found`)."),
  409: errorResponse("Version conflict (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`, `idempotency_key_reused`)."),
  428: errorResponse("The version precondition, or the `Idempotency-Key` header, is missing (`precondition_required`, `validation_failed`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `BudgetSchema` declares. The domain `Budget`
 * also carries `userId` — never product data the wire contract should
 * expose. Never spread the domain object directly into a response body.
 */
function budgetDto(budget: Budget) {
  return {
    id: budget.id,
    name: budget.name,
    description: budget.description,
    currency: budget.currency,
    status: budget.status,
    periodKind: budget.periodKind,
    startDate: budget.startDate,
    endDate: budget.endDate,
    goalAmount: budget.goalAmount,
    labels: budget.labels,
    archivedAt: budget.archivedAt ? budget.archivedAt.toISOString() : null,
    version: budget.version,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

function summaryDto(summary: BudgetSummary) {
  return { budget: budgetDto(summary.budget), figures: summary.figures, asOf: summary.asOf };
}

/** Drops `actorUserId` — internal provenance, not wire data. */
function allocationDto(allocation: Allocation) {
  return {
    id: allocation.id,
    budgetId: allocation.budgetId,
    sourceKind: allocation.sourceKind,
    sourceId: allocation.sourceId,
    amount: allocation.amount,
    recurrence: allocation.recurrence,
    effectiveFrom: allocation.effectiveFrom,
    effectiveTo: allocation.effectiveTo,
    note: allocation.note,
    version: allocation.version,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString(),
  };
}

function allocationViewDto(view: AllocationView) {
  return { ...allocationDto(view), sourceLabel: view.sourceLabel, availableInSource: view.availableInSource };
}

function scopeDto(scope: Scope) {
  return { id: scope.id, budgetId: scope.budgetId, kind: scope.kind, refId: scope.refId };
}

/** Drops `actorUserId` — same rationale as `allocationDto`. */
function usageDto(usage: Usage) {
  return {
    id: usage.id,
    budgetId: usage.budgetId,
    transactionId: usage.transactionId,
    amount: usage.amount,
    occurredAt: usage.occurredAt,
    matchedBy: usage.matchedBy,
    note: usage.note,
    createdAt: usage.createdAt.toISOString(),
  };
}

/** Drops `actorUserId` — same rationale as `allocationDto`. */
function versionDto(version: AmountVersion) {
  return {
    id: version.id,
    budgetId: version.budgetId,
    initialAmount: version.initialAmount,
    effectiveFrom: version.effectiveFrom,
    reason: version.reason,
    createdAt: version.createdAt.toISOString(),
  };
}

/** Drops `actorUserId` — same rationale as `allocationDto`. */
function eventDto(event: BudgetEvent) {
  return { id: event.id, budgetId: event.budgetId, kind: event.kind, detail: event.detail, createdAt: event.createdAt.toISOString() };
}

function detailDto(detail: BudgetDetail) {
  return {
    ...summaryDto(detail),
    versions: detail.versions.map(versionDto),
    allocations: detail.allocations.map(allocationViewDto),
    scopes: detail.scopes.map(scopeDto),
    usages: detail.usages.map(usageDto),
    events: detail.events.map(eventDto),
    series: detail.series,
  };
}

const listRoute = createRoute({
  method: "get",
  path: "/budgets",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { query: ListBudgetsQuerySchema },
  responses: { 200: { description: "The caller's budgets and current figures.", content: { "application/json": { schema: BudgetListResponseSchema } } }, ...commonErrorResponses },
});

const createBudgetRoute = createRoute({
  method: "post",
  path: "/budgets",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { body: { content: { "application/json": { schema: CreateBudgetRequestSchema } } } },
  responses: { 201: { description: "The created budget.", content: { "application/json": { schema: BudgetSchema } } }, ...commonErrorResponses },
});

const getDetailRoute = createRoute({
  method: "get",
  path: "/budgets/{id}",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: BudgetIdParamSchema },
  responses: { 200: { description: "Budget detail with figures, allocations, scopes, usages, events and a monthly remaining series.", content: { "application/json": { schema: BudgetDetailSchema } } }, ...commonErrorResponses },
});

const updateBudgetRoute = createRoute({
  method: "patch",
  path: "/budgets/{id}",
  tags: ["Budgets"],
  security: [{ session: [] }],
  description: "Send the current version in `If-Match` or `body.version`. Archive with `{ \"status\": \"archived\" }` — the server sets `archivedAt`.",
  request: {
    params: BudgetIdParamSchema,
    headers: IfMatchHeaderSchema,
    body: { content: { "application/json": { schema: UpdateBudgetRequestSchema } } },
  },
  responses: { 200: { description: "The updated budget.", content: { "application/json": { schema: BudgetSchema } } }, ...commonErrorResponses },
});

const setInitialAmountRoute = createRoute({
  method: "post",
  path: "/budgets/{id}/amount-versions",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: BudgetIdParamSchema, body: { content: { "application/json": { schema: SetInitialAmountRequestSchema } } } },
  responses: { 201: { description: "The new amount version.", content: { "application/json": { schema: AmountVersionSchema } } }, ...commonErrorResponses },
});

const addAllocationRoute = createRoute({
  method: "post",
  path: "/budgets/{id}/allocations",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: BudgetIdParamSchema, body: { content: { "application/json": { schema: AddAllocationRequestSchema } } } },
  responses: { 201: { description: "The created allocation.", content: { "application/json": { schema: AllocationSchema } } }, ...commonErrorResponses },
});

const endAllocationRoute = createRoute({
  method: "patch",
  path: "/budgets/{id}/allocations/{aid}",
  tags: ["Budgets"],
  security: [{ session: [] }],
  description: "Send the current version in `If-Match` or `body.version`.",
  request: {
    params: AllocationIdParamSchema,
    headers: IfMatchHeaderSchema,
    body: { content: { "application/json": { schema: EndAllocationRequestSchema } } },
  },
  responses: { 200: { description: "The ended allocation.", content: { "application/json": { schema: AllocationSchema } } }, ...commonErrorResponses },
});

const setScopesRoute = createRoute({
  method: "put",
  path: "/budgets/{id}/scopes",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: BudgetIdParamSchema, body: { content: { "application/json": { schema: SetScopesRequestSchema } } } },
  responses: { 200: { description: "The replaced scope set.", content: { "application/json": { schema: ScopesResponseSchema } } }, ...commonErrorResponses },
});

const addManualUsageRoute = createRoute({
  method: "post",
  path: "/budgets/{id}/usages",
  tags: ["Budgets"],
  security: [{ session: [] }],
  description: "Requires an `Idempotency-Key` header — this creates a financial record.",
  request: { params: BudgetIdParamSchema, body: { content: { "application/json": { schema: AddManualUsageRequestSchema } } } },
  responses: { 201: { description: "The created manual usage row.", content: { "application/json": { schema: UsageSchema } } }, ...commonErrorResponses },
});

const deleteManualUsageRoute = createRoute({
  method: "delete",
  path: "/budgets/{id}/usages/{uid}",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: UsageIdParamSchema },
  responses: { 204: { description: "Deleted." }, ...commonErrorResponses },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/budgets/{id}/refresh",
  tags: ["Budgets"],
  security: [{ session: [] }],
  request: { params: BudgetIdParamSchema },
  responses: { 200: { description: "Scope-matched usages recomputed from the transaction ledger.", content: { "application/json": { schema: RefreshUsagesResultSchema } } }, ...commonErrorResponses },
});

export function registerBudgetRoutes(app: ApiApp, deps: ApiDeps): void {
  app.on("POST", "/budgets/:id/usages", idempotency({ db: deps.db, now: deps.now }));

  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
      listBudgets(budgetDeps(tx, c.get("requestId")))(principal, { includeArchived: query.includeArchived === "true" }),
    );
    return c.json({ items: items.map(summaryDto) }, 200);
  });

  app.openapi(createBudgetRoute, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    try {
      const budget = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        createBudget(budgetDeps(tx, c.get("requestId")))(principal, body),
      );
      return c.json(budgetDto(budget), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getDetailRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getBudgetDetail(budgetDeps(tx, c.get("requestId")))(principal, id),
      );
      return c.json(detailDto(detail), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(updateBudgetRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    // `updateBudget`'s patch schema is `.strict()`: forward only the fields
    // it declares, never `version` (that's the concurrency token, consumed
    // above) and never `archivedAt` (the wire schema never declares it —
    // see `UpdateBudgetRequestSchema`'s comment).
    const { version: _version, ...patch } = body;
    try {
      const budget = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateBudget(budgetDeps(tx, c.get("requestId")))(principal, id, expectedVersion, patch),
      );
      return c.json(budgetDto(budget), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(setInitialAmountRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const version = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        setInitialAmount(budgetDeps(tx, c.get("requestId")))(principal, id, body),
      );
      return c.json(versionDto(version), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(addAllocationRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const allocation = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        addAllocation(budgetDeps(tx, c.get("requestId")))(principal, id, body),
      );
      return c.json(allocationDto(allocation), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(endAllocationRoute, async (c) => {
    const principal = c.get("principal");
    const { id, aid } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const allocation = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        endAllocation(budgetDeps(tx, c.get("requestId")))(principal, id, aid, expectedVersion, body.effectiveTo),
      );
      return c.json(allocationDto(allocation), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(setScopesRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const scopes = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        setScopes(budgetDeps(tx, c.get("requestId")))(principal, id, body),
      );
      return c.json({ items: scopes.map(scopeDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(addManualUsageRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const usage = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        addManualUsage(budgetDeps(tx, c.get("requestId")))(principal, id, body),
      );
      return c.json(usageDto(usage), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(deleteManualUsageRoute, async (c) => {
    const principal = c.get("principal");
    const { id, uid } = c.req.valid("param");
    try {
      await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        deleteManualUsage(budgetDeps(tx, c.get("requestId")))(principal, id, uid),
      );
      return c.body(null, 204);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(refreshRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        refreshUsages(budgetDeps(tx, c.get("requestId")))(principal, id),
      );
      return c.json(result, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });
}
