import { createRoute, z } from "@hono/zod-openapi";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import type { Transaction, TransactionCategory, TransactionLabel } from "../domain/transaction";
import { getTransaction } from "../application/get-transaction";
import { listCategories } from "../application/list-categories";
import { listLabels } from "../application/list-labels";
import { listRecurringPatterns } from "../application/list-recurring-patterns";
import { listTransactions } from "../application/list-transactions";
import { updateTransaction } from "../application/update-transaction";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { expenseDeps } from "../infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  CategoryListResponseSchema,
  LabelListResponseSchema,
  ListTransactionsQuerySchema,
  RecurringPatternListResponseSchema,
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

export function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `TransactionSchema` declares. The domain
 * `Transaction` also carries `userId` and `syncRunId` — an internal foreign
 * key to the sync run that produced the row — neither of which is product
 * data the wire contract should expose. Never spread the domain object
 * directly into a response body: that leaks whatever the domain type adds
 * next, silently, past the OpenAPI contract.
 */
function transactionDto(t: Transaction) {
  return {
    id: t.id,
    accountId: t.accountId,
    occurredAt: t.occurredAt.toISOString(),
    bookedAt: t.bookedAt ? t.bookedAt.toISOString() : null,
    amount: t.amount,
    currency: t.currency,
    type: t.type,
    state: t.state,
    categoryId: t.categoryId,
    payee: t.payee,
    note: t.note,
    transferGroupId: t.transferGroupId,
    source: t.source,
    version: t.version,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Picks exactly the fields `TransactionCategorySchema` declares — see `transactionDto`. Drops `userId`, `parentId`, `createdAt`, `updatedAt`. */
function categoryDto(c: TransactionCategory) {
  return {
    id: c.id,
    name: c.name,
    groupName: c.groupName,
    kind: c.kind,
    color: c.color,
    source: c.source,
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
  };
}

/** Picks exactly the fields `TransactionLabelSchema` declares — see `transactionDto`. Drops `userId`, `createdAt`, `updatedAt`. */
function labelDto(l: TransactionLabel) {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    source: l.source,
  };
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

const recurringRoute = createRoute({
  method: "get",
  path: "/transactions/recurring-patterns",
  tags: ["Expenses"],
  security: [{ session: [] }],
  responses: { 200: { content: { "application/json": { schema: RecurringPatternListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
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
            transaction: transactionDto(i.transaction),
            category: i.category ? categoryDto(i.category) : null,
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

  // Registered before `getRoute`: both match `/transactions/*`, and Hono's
  // router breaks that tie by registration order rather than specificity —
  // this static route must be added first or `/transactions/recurring-patterns`
  // is captured by `getRoute`'s `{id}` param and fails its uuid validation.
  app.openapi(recurringRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
      listRecurringPatterns(expenseDeps(tx, c.get("requestId")))(principal),
    );
    return c.json(
      {
        items: items.map((p) => ({
          id: p.id,
          payee: p.payee,
          cadence: p.cadence,
          amountLow: p.amountLow,
          amountHigh: p.amountHigh,
          currency: p.currency,
          lastSeenAt: p.lastSeenAt.toISOString(),
          nextExpectedAt: p.nextExpectedAt?.toISOString() ?? null,
          occurrenceCount: p.occurrenceCount,
        })),
      },
      200,
    );
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) => getTransaction(expenseDeps(tx, c.get("requestId")))(principal, id));
      return c.json(
        {
          transaction: transactionDto(detail.transaction),
          category: detail.category ? categoryDto(detail.category) : null,
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
          transaction: transactionDto(updated),
          category: detail.category ? categoryDto(detail.category) : null,
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
    return c.json({ items: items.map(categoryDto) }, 200);
  });

  app.openapi(labelsRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listLabels(expenseDeps(tx, c.get("requestId")))(principal));
    return c.json({ items: items.map(labelDto) }, 200);
  });
}
