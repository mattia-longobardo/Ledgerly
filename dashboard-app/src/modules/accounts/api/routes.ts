import { createRoute } from "@hono/zod-openapi";
import type { MonthPoint } from "@/lib/contracts";
import { UpstreamError } from "@/lib/contracts";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { idempotency } from "@/platform/http/idempotency";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { assertPermission } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import type { Account, AccountGroup, BalancePoint } from "../domain/account";
import { createGroup, deleteGroup, listGroups, renameGroup } from "../application/groups";
import { createManualAccount } from "../application/create-manual-account";
import { deleteAccount } from "../application/delete-account";
import { accountDeps } from "../infrastructure/deps";
import { DeletionBlockedError, InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { getAccountDetail } from "../application/get-account-detail";
import { listAccounts } from "../application/list-accounts";
import { netWorthSeries, type NetWorthAccountSeries } from "../application/net-worth-series";
import type { ProviderLink } from "../application/ports";
import { recordManualBalance } from "../application/record-manual-balance";
import { updateAccount } from "../application/update-account";
import {
  AccountDetailQuerySchema,
  AccountDetailSchema,
  AccountGroupListResponseSchema,
  AccountGroupSchema,
  AccountIdParamSchema,
  AccountListResponseSchema,
  AccountSchema,
  BalancePointSchema,
  BalancesPageSchema,
  BalancesQuerySchema,
  CreateAccountRequestSchema,
  CreateGroupRequestSchema,
  DeleteAccountQuerySchema,
  DeleteAccountResponseSchema,
  DeleteResponseSchema,
  ErrorResponseSchema,
  GroupIdParamSchema,
  ListAccountsQuerySchema,
  NetWorthQuerySchema,
  NetWorthSeriesSchema,
  RecordBalanceRequestSchema,
  RenameGroupRequestSchema,
  UpdateAccountRequestSchema,
} from "./schemas";

/**
 * Maps a use-case error to the `ApiError` the brief pins down, and rethrows
 * anything else unchanged so `app.onError` turns it into a 500.
 */
function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof DeletionBlockedError) return new ApiError(409, "conflict", err.message, { reason: "linked" });
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  if (err instanceof UpstreamError) return new ApiError(503, "integration_unavailable", err.message);
  throw err;
}

function accountDto(a: Account) {
  return {
    id: a.id,
    groupId: a.groupId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    origin: a.origin,
    provider: a.provider,
    status: a.status,
    includeInNetWorth: a.includeInNetWorth,
    notes: a.notes,
    sortOrder: a.sortOrder,
    version: a.version,
    archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function balancePointDto(b: BalancePoint) {
  return {
    accountId: b.accountId,
    asOf: b.asOf,
    balance: b.balance,
    available: b.available,
    source: b.source,
    capturedAt: b.capturedAt.toISOString(),
  };
}

function monthPointDto(m: MonthPoint) {
  return { month: m.month, value: m.value };
}

function providerLinkDto(l: ProviderLink) {
  return {
    provider: l.provider,
    // This route only ever resolves a link via `liveFor("account", id)`, so the
    // link handed to this DTO is always an account link; the repository's
    // `entityType` is a wider union because other modules now share it too.
    entityType: l.entityType as "account",
    entityId: l.entityId,
    externalId: l.externalId,
    metadata: l.metadata,
    missingSince: l.missingSince ? l.missingSince.toISOString() : null,
  };
}

function groupDto(g: AccountGroup) {
  return {
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function netWorthAccountSeriesDto(r: NetWorthAccountSeries) {
  return {
    account: accountDto(r.account),
    series: r.series.map(monthPointDto),
    latest: r.latest ? balancePointDto(r.latest) : null,
  };
}

function parseMonths(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : Number(raw);
}

function encodeCursor(asOf: string): string {
  return Buffer.from(asOf, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf8");
}

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * Answerable on every route, because the middleware that produces them runs
 * ahead of every handler: authentication, the CSRF header check (`403
 * csrf_required` on a cookie-authenticated write) and the rate limiter. Spread
 * into each route so the document says so rather than leaving a consumer to
 * infer it.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

const errorResponses = {
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("Version or reference conflict (`version_mismatch`, `conflict`)."),
  422: errorResponse("Validation failed (`validation_failed`, `idempotency_key_reused`)."),
  428: errorResponse("A required precondition header is missing (`validation_failed` for `Idempotency-Key`, `precondition_required` for the version)."),
  503: errorResponse("The upstream integration is unavailable (`integration_unavailable`)."),
};

const listAccountsRoute = createRoute({
  method: "get",
  path: "/accounts",
  tags: ["Accounts"],
  security: [{ session: [] }],
  request: { query: ListAccountsQuerySchema },
  responses: {
    200: {
      description: "The caller's accounts, each with its latest balance and a monthly trend.",
      content: { "application/json": { schema: AccountListResponseSchema } },
    },
    ...commonErrorResponses,
  },
});

const createAccountRoute = createRoute({
  method: "post",
  path: "/accounts",
  tags: ["Accounts"],
  security: [{ session: [] }],
  description: "Requires an `Idempotency-Key` header.",
  request: { body: { content: { "application/json": { schema: CreateAccountRequestSchema } } } },
  responses: {
    201: { description: "The created account.", content: { "application/json": { schema: AccountSchema } } },
    422: errorResponses[422],
    428: errorResponses[428],
    ...commonErrorResponses,
  },
});

const getAccountRoute = createRoute({
  method: "get",
  path: "/accounts/{id}",
  tags: ["Accounts"],
  security: [{ session: [] }],
  request: { params: AccountIdParamSchema, query: AccountDetailQuerySchema },
  responses: {
    200: { description: "Account detail.", content: { "application/json": { schema: AccountDetailSchema } } },
    404: errorResponses[404],
    ...commonErrorResponses,
  },
});

const updateAccountRoute = createRoute({
  method: "patch",
  path: "/accounts/{id}",
  tags: ["Accounts"],
  security: [{ session: [] }],
  description: "Send the current version in the `If-Match` header (or `version` in the body).",
  request: {
    params: AccountIdParamSchema,
    body: { content: { "application/json": { schema: UpdateAccountRequestSchema } } },
  },
  responses: {
    200: { description: "The updated account.", content: { "application/json": { schema: AccountSchema } } },
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    428: errorResponses[428],
    ...commonErrorResponses,
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/accounts/{id}",
  tags: ["Accounts"],
  security: [{ session: [] }],
  request: {
    params: AccountIdParamSchema,
    query: DeleteAccountQuerySchema,
  },
  responses: {
    200: {
      description: "Deleted or archived, depending on whether anything still references the account.",
      content: { "application/json": { schema: DeleteAccountResponseSchema } },
    },
    404: errorResponses[404],
    409: errorResponses[409],
    ...commonErrorResponses,
  },
});

const recordBalanceRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/balances",
  tags: ["Accounts"],
  security: [{ session: [] }],
  description: "Requires an `Idempotency-Key` header. Manual accounts only.",
  request: {
    params: AccountIdParamSchema,
    body: { content: { "application/json": { schema: RecordBalanceRequestSchema } } },
  },
  responses: {
    201: { description: "The recorded balance.", content: { "application/json": { schema: BalancePointSchema } } },
    404: errorResponses[404],
    422: errorResponses[422],
    428: errorResponses[428],
    ...commonErrorResponses,
  },
});

const listBalancesRoute = createRoute({
  method: "get",
  path: "/accounts/{id}/balances",
  tags: ["Accounts"],
  security: [{ session: [] }],
  description: "Newest first. `cursor` is the base64url of the previous page's last `asOf`.",
  request: { params: AccountIdParamSchema, query: BalancesQuerySchema },
  responses: {
    200: { description: "A page of balances.", content: { "application/json": { schema: BalancesPageSchema } } },
    404: errorResponses[404],
    ...commonErrorResponses,
  },
});

const listGroupsRoute = createRoute({
  method: "get",
  path: "/account-groups",
  tags: ["Account groups"],
  security: [{ session: [] }],
  responses: {
    200: { description: "The caller's account groups.", content: { "application/json": { schema: AccountGroupListResponseSchema } } },
    ...commonErrorResponses,
  },
});

const createGroupRoute = createRoute({
  method: "post",
  path: "/account-groups",
  tags: ["Account groups"],
  security: [{ session: [] }],
  request: { body: { content: { "application/json": { schema: CreateGroupRequestSchema } } } },
  responses: {
    201: { description: "The created group.", content: { "application/json": { schema: AccountGroupSchema } } },
    422: errorResponses[422],
    ...commonErrorResponses,
  },
});

const renameGroupRoute = createRoute({
  method: "patch",
  path: "/account-groups/{id}",
  tags: ["Account groups"],
  security: [{ session: [] }],
  request: {
    params: GroupIdParamSchema,
    body: { content: { "application/json": { schema: RenameGroupRequestSchema } } },
  },
  responses: {
    200: { description: "The renamed group.", content: { "application/json": { schema: AccountGroupSchema } } },
    404: errorResponses[404],
    422: errorResponses[422],
    ...commonErrorResponses,
  },
});

const deleteGroupRoute = createRoute({
  method: "delete",
  path: "/account-groups/{id}",
  tags: ["Account groups"],
  security: [{ session: [] }],
  request: { params: GroupIdParamSchema },
  responses: {
    200: {
      description: "Deleted. Its accounts' `groupId` becomes null.",
      content: { "application/json": { schema: DeleteResponseSchema } },
    },
    404: errorResponses[404],
    ...commonErrorResponses,
  },
});

const netWorthRoute = createRoute({
  method: "get",
  path: "/net-worth",
  tags: ["Net worth"],
  security: [{ session: [] }],
  request: { query: NetWorthQuerySchema },
  responses: {
    200: { description: "Net worth over time.", content: { "application/json": { schema: NetWorthSeriesSchema } } },
    ...commonErrorResponses,
  },
});

export function registerAccountRoutes(app: ApiApp, deps: ApiDeps): void {
  app.on("POST", "/accounts", idempotency({ db: deps.db, now: deps.now }));
  app.on("POST", "/accounts/:id/balances", idempotency({ db: deps.db, now: deps.now }));

  app.openapi(listAccountsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    try {
      const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listAccounts(accountDeps(tx, c.get("requestId")))(principal, {
          months: parseMonths(query.months),
          includeArchived: query.includeArchived === "true",
        }),
      );
      return c.json(
        {
          items: items.map((i) => ({
            account: accountDto(i.account),
            latest: i.latest ? balancePointDto(i.latest) : null,
            trend: i.trend.map(monthPointDto),
            stale: i.stale,
          })),
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(createAccountRoute, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    try {
      const account = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        createManualAccount(accountDeps(tx, c.get("requestId")))(principal, body),
      );
      return c.json(accountDto(account), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getAccountRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getAccountDetail(accountDeps(tx, c.get("requestId")))(principal, id, { months: parseMonths(query.months) }),
      );
      return c.json(
        {
          account: accountDto(detail.account),
          latest: detail.latest ? balancePointDto(detail.latest) : null,
          history: detail.history.map(balancePointDto),
          series: detail.series.map(monthPointDto),
          link: detail.link ? providerLinkDto(detail.link) : null,
          stale: detail.stale,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(updateAccountRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const account = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateAccount(accountDeps(tx, c.get("requestId")))(principal, id, expectedVersion, body),
      );
      return c.json(accountDto(account), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        deleteAccount(accountDeps(tx, c.get("requestId")))(principal, id, {
          confirmSynced: query.confirmSynced === "true",
        }),
      );
      return c.json({ outcome: result.outcome }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(recordBalanceRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const recorded = await withUserContext(deps.db, { userId: principal.userId }, async (tx) => {
        const useCaseDeps = accountDeps(tx, c.get("requestId"));
        await recordManualBalance(useCaseDeps)(principal, id, body);
        const history = await useCaseDeps.accounts.history(principal.userId, [id], body.asOf);
        return history.find((p) => p.asOf === body.asOf && p.source === "manual") ?? history[history.length - 1]!;
      });
      return c.json(balancePointDto(recorded), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listBalancesRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const limit = Math.min(Math.max(1, query.limit ? Number(query.limit) : 50), 200);
    assertPermission(principal, "accounts.read");
    try {
      const page = await withUserContext(deps.db, { userId: principal.userId }, async (tx) => {
        const useCaseDeps = accountDeps(tx, c.get("requestId"));
        const account = await useCaseDeps.accounts.get(principal.userId, id);
        if (!account) throw new NotFoundError();
        const history = await useCaseDeps.accounts.history(principal.userId, [id], query.from ?? "0001-01-01");
        let items = history
          .filter((p) => !query.to || p.asOf < query.to)
          .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.capturedAt.getTime() - a.capturedAt.getTime());
        if (query.cursor) {
          const cursorAsOf = decodeCursor(query.cursor);
          items = items.filter((p) => p.asOf < cursorAsOf);
        }
        const slice = items.slice(0, limit + 1);
        const hasMore = slice.length > limit;
        const pageItems = slice.slice(0, limit);
        return {
          items: pageItems,
          nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1]!.asOf) : undefined,
        };
      });
      return c.json(
        { items: page.items.map(balancePointDto), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listGroupsRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const groups = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listGroups(accountDeps(tx, c.get("requestId")))(principal),
      );
      return c.json({ items: groups.map(groupDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(createGroupRoute, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    try {
      const group = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        createGroup(accountDeps(tx, c.get("requestId")))(principal, body),
      );
      return c.json(groupDto(group), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(renameGroupRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const group = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        renameGroup(accountDeps(tx, c.get("requestId")))(principal, id, body),
      );
      return c.json(groupDto(group), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(deleteGroupRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        deleteGroup(accountDeps(tx, c.get("requestId")))(principal, id),
      );
      return c.json({ deleted: true as const }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(netWorthRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    try {
      const series = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        netWorthSeries(accountDeps(tx, c.get("requestId")))(principal, parseMonths(query.months)),
      );
      return c.json(
        {
          months: series.months,
          total: series.total.map(monthPointDto),
          perAccount: series.perAccount.map(netWorthAccountSeriesDto),
          asOf: series.asOf ? series.asOf.toISOString() : null,
          stale: series.stale,
          unavailableCount: series.unavailableCount,
        },
        200,
      );
    } catch (err) {
      throw toApiError(err);
    }
  });
}
