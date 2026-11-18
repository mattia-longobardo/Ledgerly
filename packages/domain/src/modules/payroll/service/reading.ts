import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { claimForExtraction, type Document, type EvidenceInput, failExtraction, getDocument, listEvidence, readOriginal, transition, upsertEvidence, uploadDocument, writeEvidence } from "../../imports/service";
import { readPdfText } from "../../imports/pdf/text";
import { MIN_TEXT_CHARS } from "../../imports/rules";
import type { Ctx } from "../../../platform/context";
import { addMonths, isCivilDate } from "../../../shared/dates";
import { type Db, getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { effectiveValue, FIELD_NAMES, FIELDS, isDerived, isFieldName, MONEY_FIELDS } from "../fields";
import { type Assembled, assemble } from "../parse/assemble";
import { type HistoryPoint, type Warning } from "../parse/checks";
import { moneyOf, type Values } from "../parse/derive";
import type { PreviousPayslip } from "../parse/leave";
import { PARSER_VERSION, parseReplyTeamsystem, type RawLine } from "../parse/reply-teamsystem";
import { type CodeRole, parsePeriodLabel, type PayslipIdentity, type TfrSource } from "../rules";
import { payrollRawLines, payslips } from "../schema";
import { PayrollError, codeMapOf, type Payslip, type RawLineRow } from "./codes";

// ——— Reading (spec §7.8, §9.3 step 3) ———

/** Steps 1–2 for a payslip; the caller starts the reading right after (`processPayslip`). */
export async function uploadPayslip(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  file: { name: string; bytes: Uint8Array },
): Promise<{ document: Document; duplicate: boolean }> {
  return uploadDocument(ctx, { kind: "payslip", fileName: file.name, bytes: file.bytes });
}

/**
 * Reads a payslip: claims it, reads its original (outside any transaction), parses it and writes
 * the raw lines, the evidence and the payslip in one short transaction. A PDF with too little text
 * waits for OCR (spec D11); anything unexpected fails the document with a code, never with its text.
 */
export async function processPayslip(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  options: { stuckBefore?: Date } = {},
): Promise<Document | null> {
  const claimed = await claimForExtraction(ctx, documentId, options);
  if (!claimed || claimed.kind !== "payslip") return null;
  try {
    const original = await readOriginal(ctx, documentId);
    if (!original) {
      await failExtraction(ctx, documentId, "original_missing");
      return getDocument(ctx, documentId);
    }
    let pages;
    try {
      pages = await readPdfText(original.bytes);
    } catch {
      await failExtraction(ctx, documentId, "unreadable_pdf");
      return getDocument(ctx, documentId);
    }
    const textChars = pages.reduce(
      (sum, page) => sum + page.items.reduce((count, item) => count + item.text.trim().length, 0),
      0,
    );
    if (textChars < MIN_TEXT_CHARS) {
      return transition(ctx, documentId, "needs_ocr", { parserVersion: PARSER_VERSION, extractedAt: new Date() });
    }
    const codeMap = await codeMapOf(ctx);
    const parsed = parseReplyTeamsystem(pages, codeMap);
    return await getDb().transaction(async (tx) => {
      await tx
        .delete(payrollRawLines)
        .where(and(eq(payrollRawLines.documentId, documentId), userScoped(ctx).owns(payrollRawLines)));
      if (parsed.lines.length > 0) {
        await tx.insert(payrollRawLines).values(
          parsed.lines.map((line) =>
            userScoped(ctx).stamp({
              documentId,
              position: line.position,
              code: line.code,
              description: line.description,
              quantity: line.quantity,
              quantityUnit: line.quantityUnit,
              rate: line.rate,
              earningsCents: line.earningsCents,
              deductionsCents: line.deductionsCents,
              statisticalCents: line.statisticalCents,
              page: line.page,
              bbox: line.bbox,
              rawText: line.rawText,
            }),
          ),
        );
      }
      await writeEvidence(ctx, documentId, parsed.fields, tx);
      await recompute(ctx, documentId, tx);
      const done = await transition(
        ctx,
        documentId,
        "needs_review",
        { parserVersion: PARSER_VERSION, extractedAt: new Date(), error: null },
        tx,
      );
      if (!done) throw new PayrollError("conflict");
      return done;
    });
  } catch (error) {
    await failExtraction(ctx, documentId, error instanceof PayrollError ? error.code : "extraction_failed");
    return getDocument(ctx, documentId);
  }
}

// ——— The fields as they stand ———

async function valuesOf(ctx: Pick<Ctx, "userId">, documentId: string, tx: Tx | Db): Promise<Values> {
  const rows = await listEvidence(ctx, documentId, tx);
  const values: Values = {};
  for (const row of rows) if (isFieldName(row.field)) values[row.field] = effectiveValue(row);
  return values;
}

export async function linesOf(ctx: Pick<Ctx, "userId">, documentId: string, executor: Tx | Db = getDb()) {
  return executor
    .select()
    .from(payrollRawLines)
    .where(and(eq(payrollRawLines.documentId, documentId), userScoped(ctx).owns(payrollRawLines)))
    .orderBy(asc(payrollRawLines.position));
}

/** Stored lines back as the parser's lines, with the role the code map gives them today. */
function withRoles(rows: readonly RawLineRow[], codeMap: ReadonlyMap<string, CodeRole>): RawLine[] {
  return rows.map((row) => ({
    position: row.position,
    code: row.code,
    description: row.description,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    rate: row.rate,
    earningsCents: row.earningsCents,
    deductionsCents: row.deductionsCents,
    statisticalCents: row.statisticalCents,
    page: row.page,
    bbox: row.bbox as [number, number, number, number],
    rawText: row.rawText,
    role: codeMap.get(row.code) ?? "other",
  }));
}

interface Identity extends PayslipIdentity {
  employerKey: string;
  employeeKey: string;
}

function identityOf(values: Values): Identity | null {
  const period = values.periodLabel ? parsePeriodLabel(values.periodLabel) : null;
  if (!period || !values.employerKey || !values.employeeKey) return null;
  return { ...period, employerKey: values.employerKey, employeeKey: values.employeeKey };
}

/**
 * The payslip before this one — same employer and employee, the month before — as it stands: the
 * applied one if there is, else the latest one still being reviewed. It confirms permits as ROL.
 */
async function previousOf(
  ctx: Pick<Ctx, "userId">,
  identity: Identity,
  documentId: string,
  tx: Tx | Db,
): Promise<PreviousPayslip | null> {
  if (identity.type !== "ordinary" || identity.period === null) return null;
  const period = addMonths(identity.period, -1);
  const [row] = await tx
    .select({ documentId: payslips.documentId })
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        eq(payslips.employerKey, identity.employerKey),
        eq(payslips.employeeKey, identity.employeeKey),
        eq(payslips.type, "ordinary"),
        eq(payslips.period, period),
        sql`${payslips.supersededBy} is null`,
        ne(payslips.documentId, documentId),
      ),
    )
    .orderBy(desc(payslips.active), desc(payslips.updatedAt))
    .limit(1);
  if (!row) return null;
  const document = await getDocument(ctx, row.documentId);
  if (!document || document.state === "rejected") return null;
  return { period, values: await valuesOf(ctx, row.documentId, tx) };
}

/** The applied ordinary payslips of the same employee: the plausibility baseline. */
async function historyOf(ctx: Pick<Ctx, "userId">, identity: Identity, tx: Tx | Db): Promise<HistoryPoint[]> {
  const rows = await tx
    .select({ period: payslips.period, netPay: payslips.netPay, gross: payslips.gross })
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        eq(payslips.active, true),
        eq(payslips.type, "ordinary"),
        eq(payslips.employerKey, identity.employerKey),
        eq(payslips.employeeKey, identity.employeeKey),
      ),
    )
    .orderBy(desc(payslips.period));
  return rows.flatMap((row) => (row.period ? [{ period: row.period, netPay: row.netPay, gross: row.gross }] : []));
}

export interface Recomputed {
  identity: Identity | null;
  assembled: Assembled;
  warnings: Warning[];
  lines: RawLine[];
  payslip: Payslip | null;
}

/**
 * Brings everything computed from the fields up to date (owner's spec L254 layers 2–3): derived
 * evidence, checks, warnings and the payslip row, which exists as soon as the identity is known.
 * Run after a reading and after every decision on a field.
 */
export async function recompute(ctx: Pick<Ctx, "userId">, documentId: string, tx: Tx): Promise<Recomputed> {
  const state = await computeState(ctx, documentId, tx);
  const { identity, assembled, warnings } = state;
  const derivedRows: EvidenceInput[] = FIELD_NAMES.filter(isDerived).map((field) => ({
    field,
    value: assembled.values[field] ?? null,
    unit: FIELDS[field].unit,
    sourceLabel: null,
    page: null,
    bbox: null,
    origin: "derived",
    confidence: 1,
    rawText: null,
    derivedFrom: assembled.derived.from[field] ?? null,
  }));
  await upsertEvidence(ctx, documentId, derivedRows, tx);

  const current = state.payslip;
  if (!identity) {
    if (current && !current.active) {
      await tx.delete(payslips).where(and(eq(payslips.id, current.id), userScoped(ctx).owns(payslips)));
    }
    return { ...state, payslip: current?.active ? current : null };
  }
  const amounts = Object.fromEntries(MONEY_FIELDS.map((field) => [field, moneyOf(assembled.values, field)]));
  const row = {
    employerKey: identity.employerKey,
    employeeKey: identity.employeeKey,
    year: identity.year,
    period: identity.period,
    type: identity.type,
    printedOn: state.values.printedOn && isCivilDate(state.values.printedOn) ? state.values.printedOn : null,
    checks: assembled.checks,
    warnings,
    tfrSource: (assembled.values.tfrSource ?? null) as TfrSource | null,
    ...amounts,
  };
  const [payslip] = current
    ? await tx
        .update(payslips)
        .set(row)
        .where(and(eq(payslips.id, current.id), userScoped(ctx).owns(payslips)))
        .returning()
    : await tx
        .insert(payslips)
        .values(userScoped(ctx).stamp({ documentId, ...row }))
        .returning();
  return { ...state, payslip };
}

/**
 * Everything the fields as they stand imply — identity, derived values, checks, leave, warnings —
 * read without writing anything: what the review shows, and what `recompute` stores.
 */
export async function computeState(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  executor: Tx | Db = getDb(),
): Promise<Recomputed & { values: Values }> {
  const values = await valuesOf(ctx, documentId, executor);
  const codeMap = await codeMapOf(ctx);
  const lines = withRoles(await linesOf(ctx, documentId, executor), codeMap);
  const identity = identityOf(values);
  const assembled = assemble({
    type: identity?.type ?? "ordinary",
    period: identity?.period ?? null,
    values,
    lines,
    previous: identity ? await previousOf(ctx, identity, documentId, executor) : null,
    history: identity ? await historyOf(ctx, identity, executor) : [],
  });
  const warnings: Warning[] = [...assembled.warnings];
  for (const line of lines) {
    if (line.role === "other") warnings.push({ code: "unknown_code", detail: { code: line.code } });
  }
  if (!identity) warnings.push({ code: values.netPay || values.periodLabel ? "missing_identity" : "unknown_layout" });
  else {
    const active = await activeWithKey(ctx, identity, executor);
    if (active && active.documentId !== documentId) {
      warnings.push({ code: "rectification", detail: { documentId: active.documentId } });
    }
  }
  const [payslip] = await executor
    .select()
    .from(payslips)
    .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips)));
  return { identity, assembled, warnings, lines, payslip: payslip ?? null, values };
}

export async function activeWithKey(ctx: Pick<Ctx, "userId">, identity: Identity, tx: Tx | Db): Promise<Payslip | null> {
  const [row] = await tx
    .select()
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        eq(payslips.active, true),
        eq(payslips.employerKey, identity.employerKey),
        eq(payslips.employeeKey, identity.employeeKey),
        eq(payslips.year, identity.year),
        eq(payslips.type, identity.type),
        identity.period === null ? sql`${payslips.period} is null` : eq(payslips.period, identity.period),
      ),
    );
  return row ?? null;
}
