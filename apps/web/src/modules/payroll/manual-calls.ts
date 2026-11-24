// The calls of a payslip typed by hand and of the employer (rewrite plan R5g, ST-21, E6). Amounts typed
// in the person's format are read here and go on the wire as decimals; the route checks the rest.
import { imports } from "@ledgerly/api-contract/imports";
import { employer, manual, payroll } from "@ledgerly/api-contract/payroll";
import { call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { decimalOf, refusal, writing, type WriteResult } from "@/platform/writes";
import { payrollChanged } from "./calls";

/** The dialog's values, as typed. `fields`: the catalogue's optional fields; an empty one is left out. */
export interface ManualInput {
  kind: string;
  year: string;
  month: string;
  extraNumber: string;
  paidOn: string;
  gross: string;
  taxes: string;
  contributions: string;
  net: string;
  fields: Record<string, string>;
}

// The vocabularies of the routes, read from their schemas: the contract's entry does not export the lists.
const manualShape = manual.createManualPayslip.body.shape;
export const PAYSLIP_KINDS = manualShape.kind.options;
export const PAY_FREQUENCIES = employer.setPayrollEmployer.body.shape.payFrequency.options;
/** The most extra payments a payslip or an employer names (the contract's `MAX_EXTRA_PAYMENTS`). */
export const MAX_EXTRA_PAYMENTS = manualShape.extraNumber.unwrap().maxValue ?? 1;

const wholeOrNull = (typed: string) => (typed.trim() === "" ? null : Number(typed));

/** The route's body, or null when an amount is not a number the person can mean. */
export async function manualBodyOf(input: ManualInput, documentId: string | null) {
  try {
    const fields: Record<string, string> = {};
    for (const [key, typed] of Object.entries(input.fields)) {
      if (typed.trim() !== "") fields[key] = await decimalOf(typed);
    }
    return {
      kind: input.kind,
      year: Number(input.year),
      // The route refuses a month or a number the kind does not take: only the kind's own are sent.
      month: input.kind === "extra" ? null : wholeOrNull(input.month),
      extraNumber: input.kind === "extra" ? wholeOrNull(input.extraNumber) : null,
      paidOn: input.paidOn.trim() || null,
      gross: await decimalOf(input.gross),
      taxes: await decimalOf(input.taxes),
      contributions: await decimalOf(input.contributions),
      net: await decimalOf(input.net),
      fields,
      ...(documentId ? { documentId } : {}),
    };
  } catch {
    return null;
  }
}

/** The states of a document still being read. */
const READING = new Set(["received", "scanning", "extracting"]);
const WAIT_MS = 1000;
const MAX_WAITS = 60;

/**
 * Uploads a payslip's PDF and waits until it is read: a manual payslip takes a document only then
 * (`invalid_state` before). Answers its id; a refused file answers its code.
 */
async function readDocument(file: File): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let id: string;
  try {
    id = (await call(imports.uploadDocument, { body: { kind: "payslip", file } })).id;
  } catch (error) {
    return refusal(error);
  }
  for (let wait = 0; wait < MAX_WAITS; wait++) {
    const review = await call(payroll.getPayslip, { params: { id } });
    if (!READING.has(review.document.state)) return { ok: true, id };
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  return { ok: false, error: "invalid_state" };
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/** Creates (`id` null) or changes a payslip typed by hand, with its PDF when one is given. */
export async function saveManualPayslipAction(
  id: string | null,
  input: ManualInput,
  file: File | null,
): Promise<SaveResult> {
  let documentId: string | null = null;
  if (file) {
    const read = await readDocument(file);
    if (!read.ok) return read;
    documentId = read.id;
  }
  const body = await manualBodyOf(input, documentId);
  if (!body) return { ok: false, error: "invalid_value" };
  const parsed = manual.createManualPayslip.body.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_value" };
  try {
    const saved = id
      ? await call(manual.updateManualPayslip, { params: { id }, body: parsed.data })
      : await call(manual.createManualPayslip, { body: parsed.data });
    invalidate(manual.getManualPayslip);
    payrollChanged();
    return { ok: true, id: saved.id };
  } catch (error) {
    // A document uploaded here waits in the inbox when the payslip is refused.
    if (documentId) payrollChanged();
    return refusal(error);
  }
}

export function deleteManualPayslipAction(id: string): Promise<WriteResult> {
  // Its own page is left at once: reading it again would only answer 404.
  return writing(() => call(manual.deleteManualPayslip, { params: { id } }), payrollChanged);
}

/** Saves how the employer pays; the yearly gross of the register reads it. */
export function saveEmployerAction(payFrequency: string, extraMonths: number[]): Promise<WriteResult> {
  const body = employer.setPayrollEmployer.body.safeParse({ payFrequency, extraMonths });
  if (!body.success) return Promise.resolve({ ok: false, error: "invalid_value" });
  return writing(
    () => call(employer.setPayrollEmployer, { body: body.data }),
    () => {
      invalidate(employer.getPayrollEmployer);
      payrollChanged();
    },
  );
}
