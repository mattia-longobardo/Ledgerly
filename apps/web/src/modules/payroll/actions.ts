// src/modules/payroll/actions.ts — the upload of payslips, the one Server Action of Payroll left
// (spec §4.2). M10, a necessary one: `POST /imports` takes one file per call with the scope
// `imports`, which the web's session gets with the deploy of R2 imports; until then the upload of
// several files stays here. Every other write of Payroll is a call to `/api/v1` (`calls.ts`).
"use server";

import { revalidatePath } from "next/cache";
import { ImportError, uploadDocuments } from "@ledgerly/domain/imports";
import { PAYSLIP_DOCUMENT } from "@ledgerly/domain/payroll";
import { requireSession } from "@/platform/auth/session";

interface UploadResult {
  ok: true;
  uploaded: { id: string; name: string; duplicate: boolean }[];
  refused: { name: string; error: string }[];
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
    revalidatePath("/payroll");
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
