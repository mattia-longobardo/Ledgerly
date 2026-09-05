import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";
import { assertPermission } from "@/platform/auth/principal";
import type { ApiApp, ApiDeps } from "@/platform/http/app";
import { ApiError } from "@/platform/http/errors";
import { parseExpectedVersion } from "@/platform/http/versioning";
import { withUserContext } from "@/platform/db/context";
import { applyImport } from "../application/apply-import";
import { markUploaded, validateUpload } from "../application/create-import";
import {
  ConflictError,
  DuplicateImportError,
  InvalidInputError,
  NotFoundError,
  VersionMismatchError,
} from "../application/errors";
import { getImport, listImports } from "../application/list-imports";
import { earningsSummary, getRecord, listRecords } from "../application/list-records";
import type { PayrollComponent, PayrollImport, PayrollRecord } from "../application/ports";
import { rejectImport, verifyImport } from "../application/review-import";
import { payrollDeps } from "../infrastructure/deps";
import { resolveDocumentStore } from "../infrastructure/document-store-resolver";
// `scanImport`/`parseImport` and `readOriginal` are the current, complete
// atomic units (Tasks 10, 13 as landed after this brief was written) — each
// resolves its own store/scanner and opens its own transaction(s), so they
// are called directly from the handler below, never wrapped in `withPayroll`.
import { parseImport, scanImport } from "../infrastructure/ingest";
import { readOriginal } from "../infrastructure/read-original";
import { resolveScanner } from "../infrastructure/scanner-resolver";
import { uploadPayslip } from "../infrastructure/upload";
import {
  EarningsSummarySchema,
  ListImportsQuerySchema,
  ListRecordsQuerySchema,
  PayrollImportDetailSchema,
  PayrollImportListResponseSchema,
  PayrollImportSchema,
  PayrollRecordDetailSchema,
  PayrollRecordListResponseSchema,
  RejectImportRequestSchema,
  UploadRequestSchema,
  VerifyImportRequestSchema,
} from "./schemas";

const IdParamSchema = z.object({ id: z.string().uuid() });
const IfMatchHeaderSchema = z.object({ "if-match": z.string().optional() });

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } };
}

/**
 * `ErrorResponseSchema` itself is the one shared copy, imported above from
 * `@/modules/accounts/api/schemas` — not redeclared. Only this wiring is
 * duplicated per module, matching accounts, integrations, expenses and
 * interests; it is a plain object of route descriptions, not an OpenAPI
 * component registration.
 */
const commonErrorResponses = {
  401: errorResponse("Not signed in (`unauthorized`)."),
  403: errorResponse("Missing permission (`permission_denied`), or a cookie-authenticated write sent without `X-Requested-With` (`csrf_required`)."),
  404: errorResponse("Not found (`not_found`)."),
  409: errorResponse("The action does not apply in this state (`conflict`), the payslip is already imported (`duplicate`), or the version is stale (`version_mismatch`)."),
  422: errorResponse("Validation failed (`validation_failed`)."),
  428: errorResponse("The version precondition is missing (`precondition_required`)."),
  429: errorResponse("Over the per-minute rate limit (`rate_limited`)."),
};

function toApiError(err: unknown): ApiError {
  if (err instanceof NotFoundError) return new ApiError(404, "not_found", err.message);
  if (err instanceof DuplicateImportError) {
    return new ApiError(409, "duplicate", err.message, { existingImportId: err.existingImportId });
  }
  if (err instanceof ConflictError) return new ApiError(409, "conflict", err.message, { reason: err.reason });
  if (err instanceof VersionMismatchError) return new ApiError(409, "version_mismatch", err.message);
  if (err instanceof InvalidInputError) return new ApiError(422, "validation_failed", err.message, err.issues);
  throw err;
}

/**
 * Picks exactly the fields `PayrollImportSchema` declares, and — critically —
 * never `storageKey` or `userId`. Never spread the domain object into a
 * response body: that leaks whatever the domain type adds next, silently, past
 * the OpenAPI contract (the lesson the Expenses API had to learn).
 */
function importDto(item: PayrollImport) {
  return {
    id: item.id,
    status: item.status,
    fileName: item.fileName,
    mime: item.mime,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
    storageProvider: item.storageProvider,
    pages: item.pages,
    textSource: item.textSource,
    parserVersion: item.parserVersion,
    scanStatus: item.scanStatus,
    scanner: item.scanner,
    scannedAt: item.scannedAt ? item.scannedAt.toISOString() : null,
    error: item.error,
    replacesImportId: item.replacesImportId,
    retentionUntil: item.retentionUntil.toISOString(),
    purgedAt: item.purgedAt ? item.purgedAt.toISOString() : null,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function importDetailDto(item: PayrollImport) {
  return { ...importDto(item), extraction: item.extraction, confidence: item.confidence };
}

/** Picks exactly the fields `PayrollRecordSchema` declares. Drops `userId`, `verifiedBy`, `corrections`. */
function recordDto(record: PayrollRecord) {
  return {
    id: record.id,
    importId: record.importId,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    payDate: record.payDate,
    kind: record.kind,
    currency: record.currency,
    gross: record.gross,
    net: record.net,
    verifiedAt: record.verifiedAt ? record.verifiedAt.toISOString() : null,
    supersededAt: record.supersededAt ? record.supersededAt.toISOString() : null,
    supersededByRecordId: record.supersededByRecordId,
    version: record.version,
  };
}

/** Picks exactly the fields `PayrollComponentSchema` declares. Drops `recordId`, `createdAt`. */
function componentDto(component: PayrollComponent) {
  return {
    id: component.id,
    code: component.code,
    labelRaw: component.labelRaw,
    kind: component.kind,
    amount: component.amount,
    quantity: component.quantity,
    unit: component.unit,
    currency: component.currency,
    confidence: component.confidence,
    source: component.source,
    mappedTo: component.mappedTo,
    sortOrder: component.sortOrder,
  };
}

const listImportsRoute = createRoute({
  method: "get",
  path: "/payroll/imports",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListImportsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const uploadRoute = createRoute({
  method: "post",
  path: "/payroll/imports",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: {
    headers: z.object({ "idempotency-key": z.string().optional() }),
    body: { content: { "multipart/form-data": { schema: UploadRequestSchema } } },
  },
  responses: { 201: { content: { "application/json": { schema: PayrollImportSchema } }, description: "Created" }, ...commonErrorResponses },
});

const getImportRoute = createRoute({
  method: "get",
  path: "/payroll/imports/{id}",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/verify",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: VerifyImportRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: PayrollImportDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const rejectRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/reject",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema, headers: IfMatchHeaderSchema, body: { content: { "application/json": { schema: RejectImportRequestSchema } } } },
  responses: { 200: { content: { "application/json": { schema: PayrollImportSchema } }, description: "OK" }, ...commonErrorResponses },
});

const applyRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/apply",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const retryRoute = createRoute({
  method: "post",
  path: "/payroll/imports/{id}/retry",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollImportSchema } }, description: "OK" }, ...commonErrorResponses },
});

const originalRoute = createRoute({
  method: "get",
  path: "/payroll/imports/{id}/original",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/pdf": { schema: z.string().openapi({ type: "string", format: "binary" }) } }, description: "The original payslip" },
    ...commonErrorResponses,
  },
});

const listRecordsRoute = createRoute({
  method: "get",
  path: "/payroll/records",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListRecordsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordListResponseSchema } }, description: "OK" }, ...commonErrorResponses },
});

const getRecordRoute = createRoute({
  method: "get",
  path: "/payroll/records/{id}",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { params: IdParamSchema },
  responses: { 200: { content: { "application/json": { schema: PayrollRecordDetailSchema } }, description: "OK" }, ...commonErrorResponses },
});

const earningsRoute = createRoute({
  method: "get",
  path: "/payroll/earnings",
  tags: ["Payroll"],
  security: [{ session: [] }],
  request: { query: ListRecordsQuerySchema },
  responses: { 200: { content: { "application/json": { schema: EarningsSummarySchema } }, description: "OK" }, ...commonErrorResponses },
});

/**
 * Resolves the store and the scanner, then builds a deps bag inside a fresh
 * user transaction. The resolution happens **before** `withUserContext` opens,
 * because it may decrypt a credential and open a connection (Ruling R4-8).
 *
 * Used only for the plain read/write use cases (list, get, verify, reject,
 * apply, list records, earnings) that already run start-to-finish inside one
 * caller-managed transaction. `scanImport`, `parseImport` and `readOriginal`
 * are each a complete, transaction-safe atomic unit on their own — they
 * resolve their own store/scanner and open their own transaction(s) — so they
 * are never routed through this helper.
 */
async function withPayroll<T>(
  deps: ApiDeps,
  userId: string,
  requestId: string | null,
  fn: (bag: ReturnType<typeof payrollDeps>) => Promise<T>,
): Promise<T> {
  const resolution = await resolveDocumentStore(userId);
  if (!resolution) {
    throw new ApiError(409, "integration_unavailable", "No payroll document store is configured.");
  }
  const opts = { documents: resolution.store, scanner: resolveScanner(), requestId };
  return withUserContext(deps.db, { userId }, (tx) => fn(payrollDeps(tx, opts)));
}

export function registerPayrollRoutes(app: ApiApp, deps: ApiDeps): void {
  app.openapi(listImportsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const items = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
      listImports(bag)(principal, { ...(query.status ? { statuses: [query.status] } : {}), ...(query.limit ? { limit: query.limit } : {}) }),
    );
    return c.json({ items: items.map(importDto) }, 200);
  });

  app.openapi(uploadRoute, async (c) => {
    const principal = c.get("principal");
    // The body is a binary file, so it is read here rather than through a Zod
    // body validator; `validateUpload` inside `reserveImport` is the one gate
    // every entry point shares (spec §8.3).
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "validation_failed", "Send the payslip as a `file` part of a multipart body.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateUpload({ fileName: file.name, mime: file.type, bytes });
    if (!validation.ok) throw new ApiError(422, "validation_failed", validation.message);
    try {
      const created = await uploadPayslip(principal, {
        fileName: file.name,
        mime: file.type,
        bytes,
        idempotencyKey: c.req.header("idempotency-key") ?? null,
        uploadedVia: "api",
        requestId: c.get("requestId"),
      });
      return c.json(importDto(created), 201);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(getImportRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const found = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => getImport(bag)(principal, id));
      return c.json(importDetailDto(found), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(verifyRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
        verifyImport(bag)(principal, id, {
          version: expectedVersion,
          month: body.month,
          isThirteenth: body.isThirteenth,
          values: body.values,
        }),
      );
      return c.json(importDetailDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(rejectRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const expectedVersion = parseExpectedVersion({ ifMatch: c.req.header("if-match") ?? null, body });
    try {
      const updated = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
        rejectImport(bag)(principal, id, expectedVersion),
      );
      return c.json(importDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(applyRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const applied = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => applyImport(bag)(principal, id));
      return c.json({ ...recordDto(applied.record), components: applied.components.map(componentDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(retryRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    const requestId = c.get("requestId");
    // Retrying is functionally "try uploading through the pipeline again", so
    // it is gated the same way the initial upload is (`payroll.upload`) — not
    // merely `payroll.read`. `scanImport`/`parseImport` (infrastructure/
    // ingest.ts) assert nothing themselves: they were built to be called only
    // by the internal cron job under a synthetic system principal, and this
    // route is the first place a real, arbitrary-role signed-in principal can
    // reach them over HTTP. Without this check, a viewer (who holds
    // `payroll.read` only) could trigger a real malware-scanner network call
    // or a real LLM call and DB writes with no upload or review right
    // anywhere else in the module — a genuine authorization bypass, not a
    // cosmetic gap.
    assertPermission(principal, "payroll.upload");
    try {
      // The manual lever the retired `POST /api/jobs/run` payslip-ingest branch
      // used to be. `scanImport`/`parseImport` (infrastructure/ingest.ts) are
      // each a complete atomic unit that resolves its own store/scanner and
      // opens its own transaction(s) — never wrapped in `withPayroll` here.
      // Which one applies is decided from the import's current state: still
      // waiting on (or stuck at) the scanner goes through `scanImport` again;
      // clean-scanned but parked at `needs_ocr` or stuck `extracting` goes
      // through `parseImport`.
      //
      // `received` is the fourth, dead-end case (Finding 3, B2 whole-branch
      // review): a crash, deploy, or DB blip between `uploadPayslip`'s
      // `store.put` succeeding and its `markUploaded` call leaves a row with
      // real bytes at `storageKey` but a status the ingest job's
      // `DUE_STATUSES` never selects. `markUploaded` is the same
      // recovery step `uploadPayslip` itself would have taken; once the row
      // is `scanning`, `scanImport` picks up immediately, same as the
      // already-scanning case below.
      const found = await withPayroll(deps, principal.userId, requestId, (bag) => getImport(bag)(principal, id));
      const needsRecovery = found.status === "received";
      const needsRescan = found.status === "scanning" || found.scanStatus === "unavailable";
      const needsReparse = found.scanStatus === "clean" && (found.status === "needs_ocr" || found.status === "extracting");
      if (!needsRecovery && !needsRescan && !needsReparse) {
        throw new ConflictError("This import is not waiting on a retry.", "not_retryable");
      }
      if (needsRecovery) {
        await withPayroll(deps, principal.userId, requestId, (bag) => markUploaded(bag)(principal, id));
        await scanImport(principal, id, { requestId });
      } else if (needsRescan) {
        await scanImport(principal, id, { requestId });
      } else {
        await parseImport(principal, id, { requestId });
      }
      const updated = await withPayroll(deps, principal.userId, requestId, (bag) => getImport(bag)(principal, id));
      return c.json(importDto(updated), 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(originalRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const original = await readOriginal(principal, id, { requestId: c.get("requestId") });
      // `no-store` and `nosniff` match the retiring Paperless preview route's
      // own headers; `inline` is what lets the review screen frame it.
      return new Response(original.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": original.mime,
          "content-length": String(original.bytes.byteLength),
          "cache-control": "private, no-store, max-age=0",
          "content-disposition": `inline; filename="payslip-${id}.pdf"`,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(listRecordsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const items = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => listRecords(bag)(principal, query));
    return c.json({ items: items.map(recordDto) }, 200);
  });

  app.openapi(getRecordRoute, async (c) => {
    const principal = c.get("principal");
    const { id } = c.req.valid("param");
    try {
      const detail = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) => getRecord(bag)(principal, id));
      return c.json({ ...recordDto(detail.record), components: detail.components.map(componentDto) }, 200);
    } catch (err) {
      throw toApiError(err);
    }
  });

  app.openapi(earningsRoute, async (c) => {
    const principal = c.get("principal");
    const query = c.req.valid("query");
    const summary = await withPayroll(deps, principal.userId, c.get("requestId"), (bag) =>
      earningsSummary(bag)(principal, query),
    );
    return c.json(summary, 200);
  });
}
