// src/modules/funds/pension/actions.ts — the pension fund's Server Actions (spec §4.2): validate →
// service → revalidate. Amounts arrive as typed, in the person's own number format.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { MAX_DOCUMENT_BYTES, sniffFormat } from "@/modules/imports/rules";
import { deleteDocument, ImportError } from "@/modules/imports/service";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { centsToDecimal } from "@/platform/money";
import { FundError } from "../service";
import {
  applyOperations,
  applyPosition,
  decidePositionField,
  processCometaDocument,
  uploadCometaDocument,
} from "./imports";
import { OperationsParseError } from "../parse/cometa-operations";
import {
  addContributionRule,
  addVoluntaryContribution,
  clearDecision,
  decideDifference,
  deleteContributionRule,
  deleteManualOperation,
  saveTolerance,
  setReceivesPayroll,
} from "./service";
import type { Component, Decision } from "./rules";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface UploadResult {
  ok: true;
  uploaded: { id: string; name: string; duplicate: boolean }[];
  refused: { name: string; error: string }[];
}

const MAX_FILES = 8;

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof FundError || error instanceof ImportError) return { ok: false, error: error.code };
  if (error instanceof OperationsParseError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError || error instanceof RangeError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(fundId: string, documentId?: string): void {
  revalidatePath("/funds");
  revalidatePath(`/funds/${fundId}`);
  if (documentId) revalidatePath(`/funds/${fundId}/documents/${documentId}`);
  revalidatePath("/");
  revalidatePath("/accounts");
}

/** Reads a document after the response, as the payslips do (spec §7.8). */
function readLater(ctx: Ctx, documentId: string): void {
  after(async () => {
    try {
      await processCometaDocument(ctx, documentId);
    } catch {
      // Left `extracting`: the hourly sweep reads it again (spec §10.2).
    }
  });
}

/**
 * "Import statement" (design): the Cometa files, whose kind comes from their content (spec §9.3) —
 * a PDF is a position summary, an HTML table or an XLSX is an operations export. Each is read
 * right after the upload.
 */
export async function uploadCometaDocumentsAction(
  fundId: string,
  data: FormData,
): Promise<UploadResult | { ok: false; error: string }> {
  const ctx = await requireSession();
  const files = data.getAll("files").filter((one): one is File => one instanceof File);
  if (files.length === 0) return { ok: false, error: "empty" };
  if (files.length > MAX_FILES) return { ok: false, error: "too_many" };
  const uploaded: UploadResult["uploaded"] = [];
  const refused: UploadResult["refused"] = [];
  for (const file of files) {
    try {
      if (file.size > MAX_DOCUMENT_BYTES) throw new ImportError("too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = sniffFormat(bytes);
      if (format === null) throw new ImportError("unsupported_format");
      const kind = format === "pdf" ? "cometa_position" : "cometa_operations";
      const result = await uploadCometaDocument(ctx, kind, { name: file.name, bytes });
      uploaded.push({ id: result.document.id, name: file.name, duplicate: result.duplicate });
      if (!result.duplicate) readLater(ctx, result.document.id);
    } catch (error) {
      const outcome = failed(error);
      refused.push({ name: file.name, error: outcome.error });
    }
  }
  revalidate(fundId);
  return { ok: true, uploaded, refused };
}

/** "Apply": the export's operations, or the statement, become the fund's (spec §9.3 step 5). */
export async function applyCometaDocumentAction(
  fundId: string,
  documentId: string,
  kind: "cometa_operations" | "cometa_position",
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    if (kind === "cometa_operations") await applyOperations(ctx, fundId, documentId);
    else await applyPosition(ctx, fundId, documentId);
    revalidate(fundId, documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Confirms or corrects one value read from a statement (spec §9.3 step 4). */
export async function decidePositionFieldAction(
  fundId: string,
  documentId: string,
  field: string,
  value: string | null,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    let corrected = value;
    if (corrected !== null && field !== "valuationDate") {
      corrected = centsToDecimal(parseAmount(corrected, ctx.numberFormat));
    }
    await decidePositionField(ctx, documentId, field, corrected);
    revalidate(fundId, documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** A document nothing was applied from can go (spec §9.3). */
export async function deleteCometaDocumentAction(fundId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteDocument(ctx, documentId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** "Retry": reads the original again, keeping the decisions on values that did not change. */
export async function retryCometaDocumentAction(fundId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await processCometaDocument(ctx, documentId);
    revalidate(fundId, documentId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface DecisionFormInput {
  year: number;
  quarter: number;
  component: string;
  note: string;
  differenceCents: string;
  accruedCents: string | null;
  creditedCents: string | null;
  competenceIds: string[];
  operationIds: string[];
}

const decimal = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

/** The reviewer accepts a difference, with the note that explains it (GC §11.9). */
export async function decideDifferenceAction(
  fundId: string,
  input: DecisionFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const cents = (value: string | null) =>
      value === null ? null : BigInt(decimal.parse(value).replace(".", ""));
    await decideDifference(ctx, fundId, {
      year: z.number().int().min(1990).max(2200).parse(input.year),
      quarter: input.quarter,
      component: input.component as Component,
      decision: "accepted_difference" as Decision,
      note: input.note,
      differenceCents: cents(input.differenceCents)!,
      accruedCents: cents(input.accruedCents),
      creditedCents: cents(input.creditedCents),
      competenceIds: input.competenceIds,
      operationIds: input.operationIds,
    });
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function clearDecisionAction(
  fundId: string,
  year: number,
  quarter: number,
  component: string,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await clearDecision(ctx, fundId, year, quarter, component as Component);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface VoluntaryFormInput {
  on: string;
  amount: string;
  fee: string;
  note: string;
  transactionId: string;
}

/** "Add contribution" (design): a payment made straight to the fund (GC §3.1). */
export async function addVoluntaryAction(fundId: string, input: VoluntaryFormInput): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await addVoluntaryContribution(ctx, fundId, {
      on: input.on,
      amountCents: parseAmount(input.amount, ctx.numberFormat),
      feesCents: input.fee.trim() === "" ? 0n : parseAmount(input.fee, ctx.numberFormat),
      note: input.note,
      transactionId: input.transactionId || null,
    });
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteOperationAction(fundId: string, operationId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteManualOperation(ctx, operationId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Settings › Employer transfers: the display tolerance, never the deadline itself (GC §11). */
export async function saveToleranceAction(fundId: string, days: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await saveTolerance(ctx, fundId, Number(days));
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export interface ContributionRuleFormInput {
  validFrom: string;
  validTo: string;
  ccnl: string;
  base: string;
  workerPct: string;
  employerPct: string;
  tfrPct: string;
  source: string;
  verifiedOn: string;
}

/** A contribution rule as documented (GC §3.2): recorded and shown, never applied to a payslip. */
export async function saveContributionRuleAction(
  fundId: string,
  input: ContributionRuleFormInput,
): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await addContributionRule(ctx, fundId, input);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteContributionRuleAction(fundId: string, ruleId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await deleteContributionRule(ctx, ruleId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Makes this the pension fund the payslips' competences go to (plan F6 §3.6.2). */
export async function setReceivesPayrollAction(fundId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await setReceivesPayroll(ctx, fundId);
    revalidate(fundId);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
