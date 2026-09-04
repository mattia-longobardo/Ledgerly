import { createRoute, z } from "@hono/zod-openapi";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { getTransaction } from "../application/get-transaction";
import { listCategories } from "../application/list-categories";
import { listLabels } from "../application/list-labels";
import { listTransactions } from "../application/list-transactions";
import { updateTransaction } from "../application/update-transaction";
import { NotFoundError, VersionMismatchError } from "../application/errors";
import { expenseDeps } from "../infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  CategoryListResponseSchema,
  LabelListResponseSchema,
  ListTransactionsQuerySchema,
  TransactionListItemSchema,
  TransactionListResponseSchema,
  UpdateTransactionRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported from
 * `@/modules/accounts/api/schemas` above — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module
 * (accounts, integrations, and now expenses each define their own), the way
 * accounts and integrations already do; that part is a plain object of route
 * descriptions, not an OpenAPI component registration, so duplicating it
 * carries none of `ErrorResponseSchema`'s collision risk.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("Version conflict (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  428: errorResponse("The version precondition is missing (`precondition_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  throw err;
}

const listRoute = createRoute({
  method: "get",
  path: "/transactions",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: { query: ListTransactionsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: TransactionListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRoute = createRoute({
  method: "get",
  path: "/transactions/{id}",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: TransactionListItemSchema } }, description: "OK" },
    ...commonErrorResponses,
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/transactions/{id}",
  tags: ["Expenses"],
  security: [{ session: [] }],
  request: {
    params: IdParamSchema,
    headers: IfMatchHeaderSchema,
    body: { content: { "application/json": { schema: UpdateTransactionRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: TransactionListItemSchema } }, description: "OK" },
    ...commonErrorResponses,
  },
});

const categoriesRoute = createRoute({
  method: "get",
  path: "/transaction-categories",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: CategoryListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const labelsRoute = createRoute({
  method: "get",
  path: "/transaction-labels",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: LabelListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

export function registerExpenseRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const q = c.req.valid("query");
    try {
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listTransactions(expenseDeps(tx, c.get("requestId")))(principal, q),
      );
      return c.json(
        {
          items: result.items.map((i) => ({
            transaction: { ...i.transaction, occurredAt: i.transaction.occurredAt.toISOString(), bookedAt: i.transaction.bookedAt?.toISOString() ?? null, createdAt: i.transaction.createdAt.toISOString(), updatedAt: i.transaction.updatedAt.toISOString() },
            category: i.category ? { ...i.category, archivedAt: i.category.archivedAt?.toISOString() ?? null } : null,
            labelIds: i.labelIds,
          })),
          nextCursor: result.nextCursor,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) => getTransaction(expenseDeps(tx, c.get("requestId")))(principal, id));
      return c.json(
        {
          transaction: { ...detail.transaction, occurredAt: detail.transaction.occurredAt.toISOString(), bookedAt: detail.transaction.bookedAt?.toISOString() ?? null, createdAt: detail.transaction.createdAt.toISOString(), updatedAt: detail.transaction.updatedAt.toISOString() },
          category: detail.category ? { ...detail.category, archivedAt: detail.category.archivedAt?.toISOString() ?? null } : null,
          labelIds: detail.labelIds,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(patchRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateTransaction(expenseDeps(tx, c.get("requestId")))(principal, id, expectedVersion, body),
      );
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) => getTransaction(expenseDeps(tx, c.get("requestId")))(principal, id));
      return c.json(
        {
          transaction: { ...updated, occurredAt: updated.occurredAt.toISOString(), bookedAt: updated.bookedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
          category: detail.category ? { ...detail.category, archivedAt: detail.category.archivedAt?.toISOString() ?? null } : null,
          labelIds: detail.labelIds,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(categoriesRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listCategories(expenseDeps(tx, c.get("requestId")))(principal));
    return c.json({ items: items.map((i) => ({ ...i, archivedAt: i.archivedAt?.toISOString() ?? null })) }, 200);
  });

  app.openapi(labelsRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listLabels(expenseDeps(tx, c.get("requestId")))(principal));
    return c.json({ items }, 200);
  });
}
