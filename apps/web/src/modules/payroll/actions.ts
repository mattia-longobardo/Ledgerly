// src/modules/payroll/actions.ts — the Payroll Server Actions (spec §4.2): validate → service →
// revalidate. Amounts and hours arrive as typed, in the person's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { ImportError, uploadDocuments } from "@ledgerly/domain/imports";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import { FIELDS, isFieldName } from "@ledgerly/domain/payroll";
import { fillWithLlm } from "@ledgerly/domain/payroll";
import {
  applyPayslip,
  decideField,
  deletePayslip,
  PayrollError,
  rejectPayslip,
  renamePayslip,
  reopenPayslip,
  resetCode,
  retryPayslip,
  PAYSLIP_DOCUMENT,
  setCodeRole,
  verifyPayslip,
} from "@ledgerly/domain/payroll";

export type ActionResult = { ok: true } | { ok: false; error: string };

interface UploadResult {
  ok: true;
  uploaded: { id: string; name: string; duplicate: boolean }[];
  refused: { name: string; error: string }[];
}

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof PayrollError || error instanceof ImportError) return { ok: false, error: error.code };
  if (error instanceof RangeError) return { ok: false, error: "invalid_value" };
  throw error;
}

function revalidate(documentId?: string): void {
  revalidatePath("/payroll");
  if (documentId) revalidatePath(`/payroll/${documentId}`);
}

/**
 * Steps 1–2 of spec §9.3 for each file, the use case of `POST /imports` too (PAY-2); the reading of
 * each new one goes to the worker right after.
 */
export async function uploadPayslipsAction(data: FormData): Promise<UploadResult | { ok: false; error: string }> {
  const ctx = await requireSession();
  const files = data.getAll("files").filter((entry): entry is File => entry instanceof File);
  try {
    const { uploaded, refused } = await uploadDocuments(ctx, PAYSLIP_DOCUMENT, files);
    revalidate();
    return {
      ok: true,
      uploaded: uploaded.map(({ document, duplicate }) => ({ id: document.id, name: document.fileName, duplicate })),
      refused,
    };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.code };
    throw error;
  }
}

/** A typed value in the service's canonical form: amounts and hours in the person's format. */
function canonical(ctx: Ctx, field: string, typed: string): string {
  if (!isFieldName(field)) throw new PayrollError("invalid_value");
  const unit = FIELDS[field].unit;
  if (unit === "eur" || unit === "hours") return centsToDecimal(parseAmount(typed, ctx.numberFormat));
  return typed.trim();
}

/** Confirms a value as read (`typed: null`) or corrects it. */
export async function decideFieldAction(documentId: string, field: string, typed: string | null): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await decideField(ctx, documentId, field, typed === null ? null : canonical(ctx, field, typed));
    revalidate(documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function verifyPayslipAction(documentId: string, acknowledgeFailures: boolean): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await verifyPayslip(ctx, documentId, { acknowledgeFailures });
    revalidate(documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function applyPayslipAction(documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await applyPayslip(ctx, documentId);
    revalidate(documentId);
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function rejectPayslipAction(documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await rejectPayslip(ctx, documentId);
    revalidate(documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function retryPayslipAction(documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await retryPayslip(ctx, documentId);
    revalidate(documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Deletes a payslip; an applied one leaves the register first. Says which of the two it did. */
export async function deletePayslipDocumentAction(
  documentId: string,
): Promise<{ ok: true; unapplied: boolean; restored: boolean } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const result = await deletePayslip(ctx, documentId);
    revalidate(documentId);
    if (result.unapplied) revalidatePath("/");
    return { ok: true, ...result };
  } catch (error) {
    return failed(error);
  }
}

/** Takes an applied payslip back to review; says whether the version it had replaced came back. */
export async function reopenPayslipAction(
  documentId: string,
): Promise<{ ok: true; restored: boolean } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { restored } = await reopenPayslip(ctx, documentId);
    revalidate(documentId);
    revalidatePath("/");
    return { ok: true, restored };
  } catch (error) {
    return failed(error);
  }
}

export async function renamePayslipAction(documentId: string, name: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await renamePayslip(ctx, documentId, name);
    revalidate(documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setCodeRoleAction(code: string, role: string, note: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setCodeRole(ctx, { code, role, note });
    revalidatePath("/payroll/settings");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function resetCodeAction(code: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await resetCode(ctx, code);
    revalidatePath("/payroll/settings");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** The OpenAI fallback for the fields still blank (spec D12): how many it filled. */
export async function fillWithLlmAction(
  documentId: string,
): Promise<{ ok: true; asked: number; filled: number } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { asked, filled } = await fillWithLlm(ctx, documentId);
    revalidate(documentId);
    return { ok: true, asked: asked.length, filled: filled.length };
  } catch (error) {
    return failed(error);
  }
}
