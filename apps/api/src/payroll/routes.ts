// Payroll (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's use cases, the ones the Server Actions call. Applying raises `PayslipApplied` inside the
// use case, the same for an action and a route. Hono tries the routes in order: `/payroll/codes` and
// the payslip's own paths do not shadow each other.
import type { Hono } from "hono";
import type { z } from "zod";
import { PAYROLL, PAYROLL_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import { ImportError, originalLinkFor } from "@ledgerly/domain/imports";
import {
  PayrollError,
  applyPayslip,
  codeMapView,
  createManualPayslip,
  decideField,
  deleteManualPayslip,
  deletePayslip,
  employerOf,
  fieldCatalogue,
  fillWithLlm,
  manualPayslipView,
  registerView,
  rejectPayslip,
  renamePayslip,
  reopenPayslip,
  resetCode,
  retryPayslip,
  reviewView,
  saveEmployer,
  setCodeRole,
  updateManualPayslip,
  verifyPayslip,
} from "@ledgerly/domain/payroll";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { parseCents } from "@ledgerly/domain/shared/money";
import { getSavedPreferences } from "@ledgerly/domain/users";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { codesOut, manualOut, registerOut, reviewOut } from "./dto";

const { payroll, codes, employer, manual } = PAYROLL;

const INVALID = new Set(["invalid_value", "derived_field", "invalid_name"]);
const UNAVAILABLE = new Set(["llm_not_configured", "llm_failed"]);

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PayrollError || error instanceof ImportError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      if (INVALID.has(error.code)) throw new ApiRefusal("invalid", error.code);
      if (UNAVAILABLE.has(error.code)) throw new ApiRefusal("unavailable", error.code);
      throw new ApiRefusal("conflict", error.code);
    }
    if (error instanceof RangeError) throw new ApiRefusal("invalid", "invalid_value");
    throw error;
  }
}

async function review(ctx: Ctx, id: string) {
  const view = await reviewView(ctx, id);
  if (view === null) throw new ApiRefusal("not_found");
  return reviewOut(view);
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, payroll.getPayroll, async ({ ctx }) => registerOut(await registerView(ctx)));
  serve(app, guard, payroll.getPayslip, async ({ ctx, params }) => review(ctx, params.id));
  serve(app, guard, codes.listPayrollCodes, async ({ ctx }) => codesOut(await codeMapView(ctx)));
  // UI-PAY-2 (rewrite plan R4): the address the web's viewer and an app open; the original itself is
  // served by `/api/v1/originals/<token>` (`apps/web/src/app/api/v1/originals`).
  serve(app, guard, payroll.getPayslipOriginalLink, async ({ ctx, params }) => {
    const view = await reviewView(ctx, params.id);
    if (!view?.document.storageKey) throw new ApiRefusal("not_found");
    const link = originalLinkFor(params.id, ctx.userId);
    return { url: `/api/v1/originals/${link.token}`, expiresAt: link.expiresAt.toISOString() };
  });
}

function serveReview(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, payroll.decidePayslipField, async ({ ctx, params, body }) => {
    await refusing(() => decideField(ctx, params.id, params.field, body.value));
    return review(ctx, params.id);
  });
  serve(app, guard, payroll.verifyPayslip, async ({ ctx, params, body }) => {
    await refusing(() => verifyPayslip(ctx, params.id, body));
  });
  serve(app, guard, payroll.applyPayslip, async ({ ctx, params }) => {
    await refusing(() => applyPayslip(ctx, params.id));
  });
  serve(app, guard, payroll.reopenPayslip, async ({ ctx, params }) =>
    refusing(() => reopenPayslip(ctx, params.id)),
  );
  serve(app, guard, payroll.rejectPayslip, async ({ ctx, params }) => {
    await refusing(() => rejectPayslip(ctx, params.id));
  });
  serve(app, guard, payroll.retryPayslip, async ({ ctx, params }) => {
    await refusing(() => retryPayslip(ctx, params.id));
  });
  serve(app, guard, payroll.renamePayslip, async ({ ctx, params, body }) => {
    await refusing(() => renamePayslip(ctx, params.id, body.name));
  });
  serve(app, guard, payroll.deletePayslip, async ({ ctx, params }) =>
    refusing(() => deletePayslip(ctx, params.id)),
  );
  serve(app, guard, payroll.fillPayslipWithLlm, async ({ ctx, params }) => {
    const { asked, filled } = await refusing(() => fillWithLlm(ctx, params.id));
    return { asked: asked.length, filled: filled.length };
  });
}

function serveCodes(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, codes.setPayrollCode, async ({ ctx, params, body }) => {
    await refusing(() => setCodeRole(ctx, { code: params.code, role: body.role, note: body.note }));
  });
  serve(app, guard, codes.resetPayrollCode, async ({ ctx, params }) => {
    await refusing(() => resetCode(ctx, params.code));
  });
}

function serveEmployer(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, employer.getPayrollEmployer, async ({ ctx }) => employerOf(ctx));
  serve(app, guard, employer.setPayrollEmployer, async ({ ctx, body }) => refusing(() => saveEmployer(ctx, body)));
  serve(app, guard, employer.listPayslipFields, async ({ ctx }) => ({
    fields: fieldCatalogue((await getSavedPreferences(ctx)).country),
  }));
}

type ManualBody = z.output<typeof manual.createManualPayslip.body>;

/** The body of a manual payslip as the use case takes it: amounts in cents. */
function manualInput(body: ManualBody) {
  const fields = Object.fromEntries(Object.entries(body.fields ?? {}).map(([key, value]) => [key, parseCents(value)]));
  return {
    ...body,
    gross: parseCents(body.gross),
    taxes: parseCents(body.taxes),
    contributions: parseCents(body.contributions),
    net: parseCents(body.net),
    fields,
    documentId: body.documentId ?? null,
  };
}

async function manualAnswer(ctx: Ctx, id: string) {
  const view = await manualPayslipView(ctx, id);
  if (view === null) throw new ApiRefusal("not_found");
  return manualOut(view);
}

function serveManual(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, manual.createManualPayslip, async ({ ctx, body }) => {
    const payslip = await refusing(() => createManualPayslip(ctx, manualInput(body)));
    return manualAnswer(ctx, payslip.id);
  });
  serve(app, guard, manual.getManualPayslip, async ({ ctx, params }) => manualAnswer(ctx, params.id));
  serve(app, guard, manual.updateManualPayslip, async ({ ctx, params, body }) => {
    await refusing(() => updateManualPayslip(ctx, params.id, manualInput(body)));
    return manualAnswer(ctx, params.id);
  });
  serve(app, guard, manual.deleteManualPayslip, async ({ ctx, params }) =>
    refusing(() => deleteManualPayslip(ctx, params.id)),
  );
}

/** Every route of payroll. */
export function servePayroll(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveReview(app, guard);
  serveCodes(app, guard);
  serveEmployer(app, guard);
  serveManual(app, guard);
  return PAYROLL_ROUTES;
}
