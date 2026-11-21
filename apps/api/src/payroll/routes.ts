// Payroll (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's use cases, the ones the Server Actions call. Applying raises `PayslipApplied` inside the
// use case, the same for an action and a route. Hono tries the routes in order: `/payroll/codes` and
// the payslip's own paths do not shadow each other.
import type { Hono } from "hono";
import { PAYROLL, PAYROLL_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import { ImportError } from "@ledgerly/domain/imports";
import {
  PayrollError,
  applyPayslip,
  codeMapView,
  decideField,
  deletePayslip,
  fillWithLlm,
  registerView,
  rejectPayslip,
  renamePayslip,
  reopenPayslip,
  resetCode,
  retryPayslip,
  reviewView,
  setCodeRole,
  verifyPayslip,
} from "@ledgerly/domain/payroll";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { codesOut, registerOut, reviewOut } from "./dto";

const { payroll, codes } = PAYROLL;

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

/** Every route of payroll. */
export function servePayroll(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveReview(app, guard);
  serveCodes(app, guard);
  return PAYROLL_ROUTES;
}
