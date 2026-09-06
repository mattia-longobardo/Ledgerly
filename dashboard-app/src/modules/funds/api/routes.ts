import { createRoute } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { requireIdempotencyKey, runFinancialWrite } from "@/platform/http/financial-write";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { acknowledgeIssue } from "../application/acknowledge-issue";
import { addContribution } from "../application/add-contribution";
import { createFund } from "../application/create-fund";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "../application/errors";
import { getFundDetail, type FundDetail } from "../application/get-fund-detail";
import { listFunds } from "../application/list-funds";
import type {
  Fund,
  FundContribution,
  FundPlan,
  FundSchedule,
  ReconciliationIssue,
} from "../application/ports";
import type { FundSummary } from "../application/summary";
import { reconcileFund } from "../application/reconcile-fund";
import { reverseContribution } from "../application/reverse-contribution";
import { setPlan } from "../application/set-plan";
import { setSchedule } from "../application/set-schedule";
import { updateFund } from "../application/update-fund";
import { fundDeps } from "../infrastructure/deps";
import {
  AddContributionRequestSchema,
  ContributionIdParamSchema,
  CreateFundRequestSchema,
  FundContributionSchema,
  FundContributionsResponseSchema,
  FundDetailSchema,
  FundIdParamSchema,
  FundListResponseSchema,
  FundPlanSchema,
  FundScheduleSchema,
  FundSchema,
  IfMatchHeaderSchema,
  IssueIdParamSchema,
  ListContributionsQuerySchema,
  ListFundsQuerySchema,
  ReconcileResultSchema,
  ReconciliationIssueSchema,
  ReverseContributionRequestSchema,
  SetPlanRequestSchema,
  SetScheduleRequestSchema,
  UpdateFundRequestSchema,
} from "./schemas";

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write omitted `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("The fund, contribution, or issue does not exist for this caller (`not_found`)."),
  409: errorResponse("The fund version is stale (`version_mismatch`)."),
  422: errorResponse("The request is invalid (`validation_failed`, `idempotency_key_reused`)."),
  428: errorResponse("A required version or `Idempotency-Key` is missing (`precondition_required`, `validation_failed`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(error: unknown): ApiError {
  if (error instanceof NotFoundError) return new ApiError(404, "not_found", error.message);
  if (error instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", error.message);
  if (error instanceof InvalidInputError) return new ApiError(422, "validation_failed", error.message, error.issues);
  throw error;
}

function fundDto(fund: Fund) {
  return {
    id: fund.id,
    slug: fund.slug,
    name: fund.name,
    kind: fund.kind,
    currency: fund.currency,
    accountId: fund.accountId,
    status: fund.status,
    archivedAt: fund.archivedAt?.toISOString() ?? null,
    version: fund.version,
    createdAt: fund.createdAt.toISOString(),
    updatedAt: fund.updatedAt.toISOString(),
  };
}

function summaryDto(summary: FundSummary) {
  return {
    fund: fundDto(summary.fund),
    value: summary.value,
    valueAsOf: summary.valueAsOf,
    deposited: summary.deposited,
    absReturn: summary.absReturn,
    lastContributionMonth: summary.lastContributionMonth,
    openIssues: summary.openIssues,
  };
}

function scheduleDto(schedule: FundSchedule) {
  return {
    id: schedule.id,
    fundId: schedule.fundId,
    frequency: schedule.frequency,
    periodAnchorMonth: schedule.periodAnchorMonth,
    postingLagMonths: schedule.postingLagMonths,
    feePerPosting: schedule.feePerPosting,
    effectiveFrom: schedule.effectiveFrom,
    createdAt: schedule.createdAt.toISOString(),
  };
}

function planDto(plan: FundPlan) {
  return {
    id: plan.id,
    fundId: plan.fundId,
    effectiveFrom: plan.effectiveFrom,
    initialCapital: plan.initialCapital,
    fixedMonthlyAmount: plan.fixedMonthlyAmount,
    note: plan.note,
    createdAt: plan.createdAt.toISOString(),
  };
}

function contributionDto(contribution: FundContribution) {
  return {
    id: contribution.id,
    fundId: contribution.fundId,
    typeCode: contribution.typeCode,
    accrualPeriodStart: contribution.accrualPeriodStart,
    accrualPeriodEnd: contribution.accrualPeriodEnd,
    postedMonth: contribution.postedMonth,
    valueDate: contribution.valueDate,
    amount: contribution.amount,
    currency: contribution.currency,
    source: contribution.source,
    payrollRecordId: contribution.payrollRecordId,
    note: contribution.note,
    reversesId: contribution.reversesId,
    reconciliationStatus: contribution.reconciliationStatus,
    version: contribution.version,
    createdAt: contribution.createdAt.toISOString(),
    updatedAt: contribution.updatedAt.toISOString(),
  };
}

function issueDto(issue: ReconciliationIssue) {
  return {
    id: issue.id,
    domain: issue.domain,
    entityType: issue.entityType,
    entityId: issue.entityId,
    kind: issue.kind,
    severity: issue.severity,
    detail: issue.detail,
    status: issue.status,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

function detailDto(detail: FundDetail) {
  return {
    ...summaryDto(detail),
    plan: detail.plan ? planDto(detail.plan) : null,
    schedule: detail.schedule ? scheduleDto(detail.schedule) : null,
    plans: detail.plans.map(planDto),
    schedules: detail.schedules.map(scheduleDto),
    contributions: detail.contributions.map(contributionDto),
    quarters: detail.quarters.map((quarter) => ({
      quarter: quarter.quarter,
      accrualMonths: quarter.accrualMonths,
      postedMonth: quarter.postedMonth,
      gross: quarter.gross,
      fees: quarter.fees,
      net: quarter.net,
      posted: quarter.posted,
    })),
    valueSeries: detail.valueSeries.map((point) => ({
      month: point.month,
      value: point.value,
      deposited: point.deposited,
    })),
    issues: detail.issues.map(issueDto),
  };
}

const listRoute = createRoute({
  method: "get",
  path: "/funds",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { query: ListFundsQuerySchema },
  responses: { 200: { description: "The caller's funds and current summaries.", content: { "application/json": { schema: FundListResponseSchema } } }, ...commonErrorResponses },
});

const createRoute_ = createRoute({
  method: "post",
  path: "/funds",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { body: { content: { "application/json": { schema: CreateFundRequestSchema } } } },
  responses: { 201: { description: "The created fund.", content: { "application/json": { schema: FundSchema } } }, ...commonErrorResponses },
});

const getRoute = createRoute({
  method: "get",
  path: "/funds/{id}",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: FundIdParamSchema },
  responses: { 200: { description: "Fund detail.", content: { "application/json": { schema: FundDetailSchema } } }, ...commonErrorResponses },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/funds/{id}",
  tags: ["Funds"],
  security: [{ session: [] }],
  description: "Send the current version in `If-Match` or `body.version`.",
  request: {
    params: FundIdParamSchema,
    headers: IfMatchHeaderSchema,
    body: { content: { "application/json": { schema: UpdateFundRequestSchema } } },
  },
  responses: { 200: { description: "The updated fund.", content: { "application/json": { schema: FundSchema } } }, ...commonErrorResponses },
});

const setScheduleRoute = createRoute({
  method: "post",
  path: "/funds/{id}/schedules",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: FundIdParamSchema, body: { content: { "application/json": { schema: SetScheduleRequestSchema } } } },
  responses: { 201: { description: "The effective-dated contribution schedule.", content: { "application/json": { schema: FundScheduleSchema } } }, ...commonErrorResponses },
});

const setPlanRoute = createRoute({
  method: "post",
  path: "/funds/{id}/plans",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: FundIdParamSchema, body: { content: { "application/json": { schema: SetPlanRequestSchema } } } },
  responses: { 201: { description: "The effective-dated fund plan.", content: { "application/json": { schema: FundPlanSchema } } }, ...commonErrorResponses },
});

const listContributionsRoute = createRoute({
  method: "get",
  path: "/funds/{id}/contributions",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: FundIdParamSchema, query: ListContributionsQuerySchema },
  responses: { 200: { description: "Contributions whose posted month is within the inclusive range.", content: { "application/json": { schema: FundContributionsResponseSchema } } }, ...commonErrorResponses },
});

const addContributionRoute = createRoute({
  method: "post",
  path: "/funds/{id}/contributions",
  tags: ["Funds"],
  security: [{ session: [] }],
  description: "Requires an `Idempotency-Key` header.",
  request: { params: FundIdParamSchema, body: { content: { "application/json": { schema: AddContributionRequestSchema } } } },
  responses: { 201: { description: "The created contribution.", content: { "application/json": { schema: FundContributionSchema } } }, ...commonErrorResponses },
});

const reverseContributionRoute = createRoute({
  method: "post",
  path: "/funds/{id}/contributions/{cid}/reverse",
  tags: ["Funds"],
  security: [{ session: [] }],
  description: "Requires an `Idempotency-Key` header.",
  request: { params: ContributionIdParamSchema, body: { content: { "application/json": { schema: ReverseContributionRequestSchema } } } },
  responses: { 201: { description: "The compensating contribution.", content: { "application/json": { schema: FundContributionSchema } } }, ...commonErrorResponses },
});

const reconcileRoute = createRoute({
  method: "post",
  path: "/funds/{id}/reconcile",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: FundIdParamSchema },
  responses: { 200: { description: "Detected and resolved reconciliation issues.", content: { "application/json": { schema: ReconcileResultSchema } } }, ...commonErrorResponses },
});

const acknowledgeIssueRoute = createRoute({
  method: "post",
  path: "/funds/issues/{issueId}/acknowledge",
  tags: ["Funds"],
  security: [{ session: [] }],
  request: { params: IssueIdParamSchema },
  responses: { 200: { description: "The acknowledged reconciliation issue.", content: { "application/json": { schema: ReconciliationIssueSchema } } }, ...commonErrorResponses },
});

export function registerFundRoutes(app: ApiApp, deps: ApiDeps): void {
  app.on("POST", ["/funds/:id/contributions", "/funds/:id/contributions/:cid/reverse"], async (c, next) => {
    requireIdempotencyKey(c.req.header("idempotency-key"));
    await next();
  });

  app.openapi(listRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    try {
      const items = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        listFunds(fundDeps(tx, c.get("requestId")))(principal, { includeArchived: query.includeArchived === "true" }),
      );
      return c.json({ items: items.map(summaryDto) }, 200);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(createRoute_, async (c) => {
    const principal = c.get("principal");
    try {
      const fund = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        createFund(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("json")),
      );
      return c.json(fundDto(fund), 201);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(getRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getFundDetail(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id),
      );
      return c.json(detailDto(detail), 200);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(patchRoute, async (c) => {
    const principal = c.get("principal");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    const { version: _transportVersion, ...patch } = body;
    try {
      const fund = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        updateFund(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id, expectedVersion, patch),
      );
      return c.json(fundDto(fund), 200);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(setScheduleRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const schedule = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        setSchedule(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id, c.req.valid("json")),
      );
      return c.json(scheduleDto(schedule), 201);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(setPlanRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const plan = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        setPlan(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id, c.req.valid("json")),
      );
      return c.json(planDto(plan), 201);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(listContributionsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    try {
      const detail = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        getFundDetail(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id),
      );
      const items = detail.contributions.filter((row) =>
        (!query.from || row.postedMonth >= query.from) && (!query.to || row.postedMonth <= query.to),
      );
      return c.json({ items: items.map(contributionDto), nextCursor: null }, 200);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(addContributionRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const result = await runFinancialWrite(deps, "funds", principal.userId, {
        key: c.req.header("idempotency-key"), method: c.req.method, path: c.req.path, body: await c.req.text(),
      }, async (tx) => contributionDto(
        await addContribution(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id, c.req.valid("json")),
      ));
      // Existing replay records may also contain an error from the former middleware.
      return c.json(result.body, result.status as 201);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(reverseContributionRoute, async (c) => {
    const principal = c.get("principal");
    const { id, cid } = c.req.valid("param");
    try {
      const result = await runFinancialWrite(deps, "funds", principal.userId, {
        key: c.req.header("idempotency-key"), method: c.req.method, path: c.req.path, body: await c.req.text(),
      }, async (tx) => contributionDto(
        await reverseContribution(fundDeps(tx, c.get("requestId")))(principal, id, cid, c.req.valid("json").note),
      ));
      return c.json(result.body, result.status as 201);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(reconcileRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const result = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        reconcileFund(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").id),
      );
      return c.json({
        detected: result.detected.map((issue) => ({
          kind: issue.kind,
          entityType: issue.entityType,
          entityId: issue.entityId,
          severity: issue.severity,
          detail: issue.detail,
        })),
        resolved: result.resolved,
      }, 200);
    } catch (error) {
      throw toApiError(error);
    }
  });

  app.openapi(acknowledgeIssueRoute, async (c) => {
    const principal = c.get("principal");
    try {
      const issue = await withUserContext(deps.db, { userId: principal.userId }, (tx) =>
        acknowledgeIssue(fundDeps(tx, c.get("requestId")))(principal, c.req.valid("param").issueId),
      );
      return c.json(issueDto(issue), 200);
    } catch (error) {
      throw toApiError(error);
    }
  });
}
