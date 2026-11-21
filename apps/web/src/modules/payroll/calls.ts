// The calls of the Payroll screens to `/api/v1` (rewrite plan R3): each keeps the name and the answer
// of the Server Action it replaces, so the screens read one shape. A refusal keeps its words: the
// reason of the route (`invalid_state`, `blocking_checks`…) or its code. A number typed in the
// person's format is read here and goes on the wire in canonical form ("1234.56"). The upload stays
// `uploadPayslipsAction` until `POST /imports` takes the web's session. The code map has its own.
import { payroll } from "@ledgerly/api-contract/payroll";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate, remember } from "@ledgerly/ui/data";
import { decimalOf, refusal, writing, type WriteResult } from "@/platform/writes";
import type { FieldView } from "./ui/present";

type Failure = { ok: false; error: string };

/** What a write to a payslip made stale: the register and the payslips' reviews. */
export function payrollChanged(): void {
  invalidate(payroll.getPayroll, payroll.getPayslip);
}

async function answering<T extends object>(work: () => Promise<T>): Promise<({ ok: true } & T) | Failure> {
  try {
    const answer = await work();
    payrollChanged();
    return { ok: true, ...answer };
  } catch (error) {
    return refusal(error);
  }
}

const byId = (documentId: string) => ({ params: { id: documentId } });

/** A typed value in the route's canonical form; null when it is not a number the person can mean. */
async function canonical(unit: FieldView["unit"], typed: string): Promise<string | null> {
  if (unit !== "eur" && unit !== "hours") return typed.trim();
  try {
    return await decimalOf(typed);
  } catch {
    return null;
  }
}

/**
 * Confirms a value as read (`typed: null`) or corrects it. The route answers the whole review —
 * derived values, checks and warnings change with every decision —, and the screen shows that one.
 */
export async function decideFieldAction(
  documentId: string,
  field: Pick<FieldView, "field" | "unit">,
  typed: string | null,
): Promise<WriteResult> {
  const value = typed === null ? null : await canonical(field.unit, typed);
  if (typed !== null && value === null) return { ok: false, error: "invalid_value" };
  try {
    const review = await call(payroll.decidePayslipField, {
      params: { id: documentId, field: field.field },
      body: { value },
    });
    remember(payroll.getPayslip, byId(documentId), review);
    invalidate(payroll.getPayroll);
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}

export function verifyPayslipAction(documentId: string, acknowledgeFailures: boolean): Promise<WriteResult> {
  return writing(() => call(payroll.verifyPayslip, { ...byId(documentId), body: { acknowledgeFailures } }), payrollChanged);
}

export function applyPayslipAction(documentId: string): Promise<WriteResult> {
  return writing(() => call(payroll.applyPayslip, byId(documentId)), payrollChanged);
}

export function rejectPayslipAction(documentId: string): Promise<WriteResult> {
  return writing(() => call(payroll.rejectPayslip, byId(documentId)), payrollChanged);
}

export function retryPayslipAction(documentId: string): Promise<WriteResult> {
  return writing(() => call(payroll.retryPayslip, byId(documentId)), payrollChanged);
}

export async function renamePayslipAction(documentId: string, name: string): Promise<WriteResult> {
  // A name the route's schema refuses is refused here, with the use case's words.
  const body = payroll.renamePayslip.body.safeParse({ name });
  if (!body.success) return { ok: false, error: "invalid_name" };
  return writing(() => call(payroll.renamePayslip, { ...byId(documentId), body: body.data }), payrollChanged);
}

/** Deletes a payslip; an applied one leaves the register first. Says which of the two it did. */
export function deletePayslipDocumentAction(documentId: string) {
  return answering(() => call(payroll.deletePayslip, byId(documentId)));
}

/** Takes an applied payslip back to review; says whether the version it had replaced came back. */
export function reopenPayslipAction(documentId: string) {
  return answering(() => call(payroll.reopenPayslip, byId(documentId)));
}

/**
 * The OpenAI fallback for the fields still blank (spec D12): how many it filled. Web session only. A
 * fallback not configured or failed is `unavailable` (503) with its reason: words for the person, as
 * the Server Action answered, not a failure of the server.
 */
export async function fillWithLlmAction(documentId: string) {
  try {
    return await answering(() => call(payroll.fillPayslipWithLlm, byId(documentId)));
  } catch (error) {
    if (error instanceof ApiError && error.code === "unavailable" && error.reason)
      return { ok: false as const, error: error.reason };
    throw error;
  }
}
