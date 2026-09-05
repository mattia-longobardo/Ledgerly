"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import { applyImport } from "@/modules/payroll/application/apply-import";
import { validateUpload } from "@/modules/payroll/application/create-import";
import {
  ConflictError,
  DuplicateImportError,
  InvalidInputError,
  NotFoundError,
  VersionMismatchError,
} from "@/modules/payroll/application/errors";
import { listImports } from "@/modules/payroll/application/list-imports";
import { rejectImport, verifyImport } from "@/modules/payroll/application/review-import";
import { uploadPayslip } from "@/modules/payroll/infrastructure/upload";
import { orderQueue, successorOf } from "@/modules/payroll/ui/queue";
import { runForPrincipal } from "@/modules/payroll/ui/run";
import type { ActionResult } from "./types";

const verifySchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the pay period as YYYY-MM-01."),
  isThirteenth: z.boolean(),
  values: z.record(z.enum(PAYSLIP_FIELDS), z.string().nullable()),
});

export type VerifyActionInput = z.input<typeof verifySchema>;

/** One place that turns a use-case error into the message the form shows. */
function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof DuplicateImportError) return { ok: false, error: "This payslip has already been uploaded." };
  if (err instanceof VersionMismatchError) return { ok: false, error: err.message };
  if (err instanceof ConflictError) return { ok: false, error: err.message };
  if (err instanceof InvalidInputError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That payslip is no longer there." };
  throw err;
}

function revalidate(): void {
  revalidatePath("/company");
  revalidatePath("/company/payroll");
  revalidatePath("/company/earnings");
}

export async function uploadPayslipAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a PDF payslip to upload." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload({ fileName: file.name, mime: file.type, bytes });
  if (!validation.ok) return { ok: false, error: validation.message };
  try {
    // Not `runForPrincipal`: `uploadPayslip` runs its own three short
    // transactions with the store write between them, and must not be nested
    // inside one.
    const { requirePrincipal } = await import("@/platform/auth/require-principal");
    const principal = await requirePrincipal();
    const created = await uploadPayslip(principal, { fileName: file.name, mime: file.type, bytes, uploadedVia: "ui" });
    revalidate();
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function verifyPayslipAction(input: VerifyActionInput): Promise<ActionResult<{ id: string; next: string | null }>> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    return await runForPrincipal(async (deps, principal) => {
      const updated = await verifyImport(deps)(principal, parsed.data.id, {
        version: parsed.data.version,
        month: parsed.data.month,
        isThirteenth: parsed.data.isThirteenth,
        values: parsed.data.values,
      });
      revalidate();
      // The queue as the server sees it *after* the write, so an import
      // reviewed in another tab is never offered again.
      const remaining = await listImports(deps)(principal, { statuses: ["needs_review", "needs_ocr"] });
      const next = successorOf(
        orderQueue(remaining.map((i) => ({ id: i.id, month: i.extraction?.month ?? "", isThirteenth: i.extraction?.isThirteenth ?? false }))),
        { id: updated.id, month: parsed.data.month, isThirteenth: parsed.data.isThirteenth },
      );
      return { ok: true as const, data: { id: updated.id, next } };
    });
  } catch (err) {
    return toActionError(err);
  }
}

export async function applyPayslipAction(input: { id: string }): Promise<ActionResult<{ recordId: string }>> {
  try {
    return await runForPrincipal(async (deps, principal) => {
      const applied = await applyImport(deps)(principal, input.id);
      revalidate();
      return { ok: true as const, data: { recordId: applied.record.id } };
    });
  } catch (err) {
    return toActionError(err);
  }
}

export async function rejectPayslipAction(input: { id: string; version: number }): Promise<ActionResult<{ next: string | null }>> {
  try {
    return await runForPrincipal(async (deps, principal) => {
      const rejected = await rejectImport(deps)(principal, input.id, input.version);
      revalidate();
      const remaining = await listImports(deps)(principal, { statuses: ["needs_review", "needs_ocr"] });
      const next = successorOf(
        orderQueue(remaining.map((i) => ({ id: i.id, month: i.extraction?.month ?? "", isThirteenth: i.extraction?.isThirteenth ?? false }))),
        { id: rejected.id, month: rejected.extraction?.month ?? "", isThirteenth: rejected.extraction?.isThirteenth ?? false },
      );
      return { ok: true as const, data: { next } };
    });
  } catch (err) {
    return toActionError(err);
  }
}
