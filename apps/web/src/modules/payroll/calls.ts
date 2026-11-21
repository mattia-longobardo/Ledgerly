// The calls of the Payroll screens to `/api/v1` (rewrite plan R3): each keeps the name and the answer
// of the Server Action it replaces, so the screens read one shape. A refusal keeps its words: the
// reason of the route (`invalid_state`, `blocking_checks`…) or its code. A number typed in the
// person's format is read here and goes on the wire in canonical form ("1234.56"). The upload is
// `POST /imports`, one file per call. The code map has its own.
import { imports } from "@ledgerly/api-contract/imports";
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

/** At most this many files in one upload, the use case's `MAX_FILES`: one call carries one file. */
// shortcut: the number is written twice (here and in the domain); read it from the contract when it has it.
const MAX_FILES = 24;

/** Where one file of an upload is: on its way, received (new or already there), refused. */
export type FileProgress = "sending" | "uploaded" | "duplicate" | "refused";

interface Uploaded {
  ok: true;
  uploaded: { id: string; name: string; duplicate: boolean }[];
  refused: { name: string; error: string }[];
}

/** The use case's code of a refused file. */
function refusedAs(error: unknown, file: File): string {
  const { error: code } = refusal(error);
  // shortcut: the route answers `invalid` for a file with no bytes and for one the storage refused,
  // without the use case's code; read its `reason` when the route sends one.
  if (code === "invalid") return file.size === 0 ? "empty" : "storage_failed";
  return code;
}

/**
 * Uploads payslips one by one to `POST /imports` (audit PAY-2, UI-FND-6) and answers as the Server
 * Action did: the documents received, the files refused with their code. No file, or more than
 * `MAX_FILES`, refuses the whole upload. `onFile` follows each file; a failure of the server throws.
 */
export async function uploadPayslips(
  files: readonly File[],
  onFile: (index: number, progress: FileProgress) => void = () => {},
): Promise<Uploaded | Failure> {
  if (files.length === 0) return { ok: false, error: "empty" };
  if (files.length > MAX_FILES) return { ok: false, error: "too_many" };
  const result: Uploaded = { ok: true, uploaded: [], refused: [] };
  for (const [index, file] of files.entries()) {
    onFile(index, "sending");
    try {
      const document = await call(imports.uploadDocument, { body: { kind: "payslip", file } });
      result.uploaded.push({ id: document.id, name: document.fileName, duplicate: document.duplicate });
      onFile(index, document.duplicate ? "duplicate" : "uploaded");
    } catch (error) {
      result.refused.push({ name: file.name, error: refusedAs(error, file) });
      onFile(index, "refused");
    }
  }
  return result;
}
