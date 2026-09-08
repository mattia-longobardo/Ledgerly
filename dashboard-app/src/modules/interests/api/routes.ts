import { createRoute, z } from "@hono/zod-openapi";
import { AUTHENTICATED_SECURITY } from "@/platform/http/security-schemes";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import type { InterestAccrual, InterestEntry, InterestRule } from "../application/ports";
import { createInterestRule } from "../application/create-interest-rule";
import { getInterestRuleDetail } from "../application/get-interest-rule-detail";
import { listInterestRules } from "../application/list-interest-rules";
import { updateInterestRule } from "../application/update-interest-rule";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { interestDeps } from "../infrastructure/deps";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import {
  CreateInterestRuleRequestSchema,
  GetRuleDetailQuerySchema,
  InterestRuleDetailSchema,
  InterestRuleListResponseSchema,
  InterestRuleSchema,
  UpdateInterestRuleRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared here. Only this
 * `errorResponse()`/`commonErrorResponses` wiring is duplicated per module,
 * matching accounts, integrations and expenses; it is a plain object of
 * route descriptions, not an OpenAPI component registration.
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

/**
 * `InvalidInputError` is not in this task's "Consumes" list, but the create
 * and update use cases both throw it for input that clears the wire schema
 * (a bare `z.string()`) yet fails a stricter domain check — a `taxRate`
 * above 1, an impossible calendar date. Left unmapped, it falls through to
 * the app's generic `onError` handler as an uncaught `Error` and becomes a
 * `500 internal`, which is a wrong status for a client input mistake, not
 * just an unclean one. Accounts' `toApiError` already maps it to `422
 * validation_failed`; this does the same rather than repeating the gap.
 */
function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `InterestRuleSchema` declares. The domain
 * `InterestRule` also carries `userId` — never product data the wire
 * contract should expose. Never spread the domain object directly into a
 * response body: that leaks whatever the domain type adds next, silently,
 * past the OpenAPI contract (the lesson the Expenses API had to learn — see
 * global constraint / brief point 2).
 */
function ruleDto(rule: InterestRule) {
  return {
    id: rule.id,
    accountId: rule.accountId,
    annualRate: rule.annualRate,
    taxRate: rule.taxRate,
    dayCount: rule.dayCount,
    compounding: rule.compounding,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    postingMode: rule.postingMode,
    providerCategoryRef: rule.providerCategoryRef,
    noteMarker: rule.noteMarker,
    version: rule.version,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

/** Picks exactly the fields `InterestAccrualSchema` declares — see `ruleDto`. Drops `ruleId`, `source`, `entryId`. */
function accrualDto(accrual: InterestAccrual) {
  return {
    id: accrual.id,
    accrualDate: accrual.accrualDate,
    balanceBasis: accrual.balanceBasis,
    gross: accrual.gross,
    tax: accrual.tax,
    net: accrual.net,
    carryAfter: accrual.carryAfter,
    postedAt: accrual.postedAt ? accrual.postedAt.toISOString() : null,
  };
}

/** Picks exactly the fields `InterestEntrySchema` declares — see `ruleDto`. Drops `userId`, `accountId`, `transactionId`, `ruleId`. */
function entryDto(entry: InterestEntry) {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    gross: entry.gross,
    net: entry.net,
    kind: entry.kind,
    source: entry.source,
  };
}

const listRoute = createRoute({
  method: "get",
  path: "/interest-rules",
  tags: ["Interests"],
  security: AUTHENTICATED_SECURITY,
  responses: { 200: { content: { "application/json": { schema: InterestRuleListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const createRoute_ = createRoute({
  method: "post",
  path: "/interest-rules",
  tags: ["Interests"],
  security: AUTHENTICATED_SECURITY,
  request: { body: { content: { "application/json": { schema: CreateInterestRuleRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: InterestRuleSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRoute = createRoute({
  method: "get",
  path: "/interest-rules/{id}",
  tags: ["Interests"],
  security: AUTHENTICATED_SECURITY,
  request: { params: IdParamSchema, query: GetRuleDetailQuerySchema },
  responses: { 200: { content: { "application/json": { schema: InterestRuleDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/interest-rules/{id}",
  tags: ["Interests"],
  security: AUTHENTICATED_SECURITY,
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: UpdateInterestRuleRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: InterestRuleSchema } }, description: "OK" }, ...commonErrorResponses },
});

export function registerInterestRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) => listInterestRules(interestDeps(tx, c.get("requestId")))(principal));
    return c.json({ items: items.map(ruleDto) }, 200);
  });

  app.openapi(createRoute_, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    try {
      const rule = await withUserContext(deps.db, { userId: principal.userId }, (tx) => createInterestRule(interestDeps(tx, c.get("requestId")))(principal, body));
      return c.json(ruleDto(rule), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getInterestRuleDetail(interestDeps(tx, c.get("requestId")))(principal, id, query),
      );
      return c.json(
        {
          ...ruleDto(detail.rule),
          accruals: detail.accruals.map(accrualDto),
          entries: detail.entries.map(entryDto),
          reconciliation: detail.reconciliation,
          projection: detail.projection,
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
      const rule = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateInterestRule(interestDeps(tx, c.get("requestId")))(principal, id, expectedVersion, body),
      );
      return c.json(ruleDto(rule), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });
}
