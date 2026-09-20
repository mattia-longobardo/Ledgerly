// src/modules/payroll/actions.ts — the Payroll Server Actions (spec §4.2): validate → service →
// revalidate. Amounts and hours arrive as typed, in the person's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { parseAmount } from "@/modules/accounts/rules";
import { deleteDocument, ImportError } from "@/modules/imports/service";
import { MAX_DOCUMENT_BYTES } from "@/modules/imports/rules";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { centsToDecimal } from "@/platform/money";
import { FIELDS, isFieldName } from "./fields";
import { fillWithLlm } from "./llm";
import {
  applyPayslip,
  decideField,
  PayrollError,
  processPayslip,
  rejectPayslip,
  resetCode,
  retryPayslip,
  setCodeRole,
  uploadPayslip,
  verifyPayslip,
} from "./service";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface UploadResult {
  ok: true;
  uploaded: { id: string; name: string; duplicate: boolean }[];
  refused: { name: string; error: string }[];
}

/** At most this many files in one go. */
const MAX_FILES = 24;

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof PayrollError || error instanceof ImportError) return { ok: false, error: error.code };
  if (error instanceof RangeError) return { ok: false, error: "invalid_value" };
  throw error;
}

function revalidate(documentId?: string): void {
  revalidatePath("/payroll");
  if (documentId) revalidatePath(`/payroll/${documentId}`);
}

/** Reads a document after the response: the upload answers at once (spec §7.8 "subito dopo"). */
function readLater(ctx: Ctx, documentId: string): void {
  after(async () => {
    try {
      await processPayslip(ctx, documentId);
    } catch {
      // Left `extracting`: the hourly sweep reads it again (spec §10.2).
    }
  });
}

/** Steps 1–2 of spec §9.3 for each file; the reading of each new one starts right after. */
export async function uploadPayslipsAction(data: FormData): Promise<UploadResult | { ok: false; error: string }> {
  const ctx = await requireSession();
  const files = data.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return { ok: false, error: "empty" };
  if (files.length > MAX_FILES) return { ok: false, error: "too_many" };
  const result: UploadResult = { ok: true, uploaded: [], refused: [] };
  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      result.refused.push({ name: file.name, error: "too_large" });
      continue;
    }
    try {
      const { document, duplicate } = await uploadPayslip(ctx, {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      result.uploaded.push({ id: document.id, name: document.fileName, duplicate });
      if (!duplicate) readLater(ctx, document.id);
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      result.refused.push({ name: file.name, error: error.code });
    }
  }
  revalidate();
  return result;
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

export async function deletePayslipDocumentAction(documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteDocument(ctx, documentId);
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
    revalidatePath("/settings/data");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function resetCodeAction(code: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await resetCode(ctx, code);
    revalidatePath("/settings/data");
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
