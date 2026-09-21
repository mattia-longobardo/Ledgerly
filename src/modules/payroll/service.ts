import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  claimForExtraction,
  decideEvidence,
  type Document,
  type EvidenceInput,
  failExtraction,
  getDocument,
  ImportError,
  listEvidence,
  readOriginal,
  requireDocument,
  transition,
  upsertEvidence,
  uploadDocument,
  writeEvidence,
} from "@/modules/imports/service";
import { dropCompetence, recordCompetence } from "@/modules/funds/pension/service";
import { readPdfText } from "@/modules/imports/pdf/text";
import { MIN_TEXT_CHARS } from "@/modules/imports/rules";
import type { Ctx } from "@/platform/context";
import { addMonths, isCivilDate } from "@/platform/dates";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { centsToDecimal, parseCents } from "@/platform/money";
import {
  effectiveValue,
  FIELD_NAMES,
  FIELDS,
  type FieldName,
  isDerived,
  isFieldName,
  LEAVE_COLUMNS,
  type LeaveKind,
  LEAVE_KINDS,
  leaveField,
  MONEY_FIELDS,
} from "./fields";
import { type Assembled, assemble } from "./parse/assemble";
import { hasBlockingFailure, type HistoryPoint, type Warning } from "./parse/checks";
import { moneyOf, type Values } from "./parse/derive";
import type { PreviousPayslip } from "./parse/leave";
import { PARSER_VERSION, parseReplyTeamsystem, type RawLine } from "./parse/reply-teamsystem";
import { fundLineIds, pensionCompetenceOf } from "./pension";
import {
  type CodeRole,
  CODE_ROLES,
  parsePeriodLabel,
  type PayslipIdentity,
  REPLY_TEAMSYSTEM,
  REPLY_TEAMSYSTEM_CODES,
  type TfrSource,
} from "./rules";
import {
  leaveBalanceSnapshots,
  payrollCodeMap,
  payrollLeaveEvents,
  payrollRawLines,
  payslips,
} from "./schema";

export type Payslip = typeof payslips.$inferSelect;
export type CodeMapEntry = typeof payrollCodeMap.$inferSelect;
type RawLineRow = typeof payrollRawLines.$inferSelect;

export type PayrollErrorCode =
  | "not_found"
  | "invalid_state"
  | "invalid_value"
  | "derived_field"
  | "unconfirmed_inferred"
  | "blocking_checks"
  | "no_identity"
  | "conflict"
  | "llm_not_configured"
  | "llm_failed";

export class PayrollError extends Error {
  constructor(readonly code: PayrollErrorCode) {
    super(code);
    this.name = "PayrollError";
  }
}

// ——— The code map (spec §7.8 "Mappa dei codici") ———

/** The code map of a profile, seeded with the Reply/TeamSystem codes the first time it is needed. */
export async function codeMapOf(
  ctx: Pick<Ctx, "userId">,
  profile = REPLY_TEAMSYSTEM,
): Promise<Map<string, CodeRole>> {
  let rows = await listCodeMap(ctx, profile);
  if (rows.length === 0 && profile === REPLY_TEAMSYSTEM) {
    await getDb()
      .insert(payrollCodeMap)
      .values(REPLY_TEAMSYSTEM_CODES.map((entry) => userScoped(ctx).stamp({ profile, ...entry })))
      .onConflictDoNothing();
    rows = await listCodeMap(ctx, profile);
  }
  return new Map(rows.map((row) => [row.code, row.role]));
}

export async function listCodeMap(ctx: Pick<Ctx, "userId">, profile = REPLY_TEAMSYSTEM): Promise<CodeMapEntry[]> {
  return getDb()
    .select()
    .from(payrollCodeMap)
    .where(and(userScoped(ctx).owns(payrollCodeMap), eq(payrollCodeMap.profile, profile)))
    .orderBy(sql`length(${payrollCodeMap.code})`, asc(payrollCodeMap.code));
}

/** Sets what a code means; a code the map lacked is added. Payslips read later use it. */
export async function setCodeRole(
  ctx: Pick<Ctx, "userId">,
  input: { code: string; role: string; note?: string | null },
  profile = REPLY_TEAMSYSTEM,
): Promise<void> {
  const code = input.code.trim();
  const note = input.note?.trim() || null;
  if (!/^\d{1,6}$/.test(code) || !(CODE_ROLES as readonly string[]).includes(input.role) || (note?.length ?? 0) > 200) {
    throw new PayrollError("invalid_value");
  }
  await codeMapOf(ctx, profile);
  await getDb()
    .insert(payrollCodeMap)
    .values(userScoped(ctx).stamp({ profile, code, role: input.role as CodeRole, note }))
    .onConflictDoUpdate({
      target: [payrollCodeMap.userId, payrollCodeMap.profile, payrollCodeMap.code],
      set: { role: input.role as CodeRole, note, updatedAt: new Date() },
    });
}

/** Puts a code back to what the profile says, or removes a code the profile does not have. */
export async function resetCode(ctx: Pick<Ctx, "userId">, code: string, profile = REPLY_TEAMSYSTEM): Promise<void> {
  const seeded = REPLY_TEAMSYSTEM_CODES.find((entry) => entry.code === code);
  const where = and(
    userScoped(ctx).owns(payrollCodeMap),
    eq(payrollCodeMap.profile, profile),
    eq(payrollCodeMap.code, code),
  );
  if (seeded && profile === REPLY_TEAMSYSTEM) {
    await getDb().update(payrollCodeMap).set({ role: seeded.role, note: null }).where(where);
  } else {
    await getDb().delete(payrollCodeMap).where(where);
  }
}

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

async function linesOf(ctx: Pick<Ctx, "userId">, documentId: string, executor: Tx | Db = getDb()) {
  return executor
    .select()
    .from(payrollRawLines)
    .where(and(eq(payrollRawLines.documentId, documentId), userScoped(ctx).owns(payrollRawLines)))
    .orderBy(asc(payrollRawLines.position));
}

/** Stored lines back as the parser's lines, with the role the code map gives them today. */
export function withRoles(rows: readonly RawLineRow[], codeMap: ReadonlyMap<string, CodeRole>): RawLine[] {
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

export interface Identity extends PayslipIdentity {
  employerKey: string;
  employeeKey: string;
}

export function identityOf(values: Values): Identity | null {
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

async function activeWithKey(ctx: Pick<Ctx, "userId">, identity: Identity, tx: Tx | Db): Promise<Payslip | null> {
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

// ——— Review (spec §7.8, §9.3 step 4) ———

/** A typed value in its canonical form, or an error: amounts and hours to two decimals. */
export function canonicalValue(field: FieldName, value: string): string {
  const unit = FIELDS[field].unit;
  const text = value.trim();
  if (unit === "eur" || unit === "hours") {
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) throw new PayrollError("invalid_value");
    return centsToDecimal(parseCents(text));
  }
  if (unit === "date") {
    if (!isCivilDate(text)) throw new PayrollError("invalid_value");
    return text;
  }
  if (text.length === 0 || text.length > 100) throw new PayrollError("invalid_value");
  return text;
}

const REVIEWABLE = ["needs_review", "verified"] as const;

/**
 * Confirms a value as read, or corrects it; the original stays beside the correction (owner's spec
 * L249). Derived values follow from the others and are never set by hand. A verified payslip that
 * changes goes back to review.
 */
export async function decideField(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  field: string,
  correctedValue: string | null,
): Promise<Recomputed> {
  if (!isFieldName(field)) throw new PayrollError("invalid_value");
  if (isDerived(field)) throw new PayrollError("derived_field");
  const document = await requireDocumentOf(ctx, documentId);
  if (!(REVIEWABLE as readonly string[]).includes(document.state)) throw new PayrollError("invalid_state");
  const value = correctedValue === null ? null : canonicalValue(field, correctedValue);
  return getDb().transaction(async (tx) => {
    const decided = await decideEvidence(ctx, documentId, field, value, tx);
    if (!decided) throw new PayrollError("not_found");
    // A correction equal to what was read is a confirmation.
    if (value !== null && decided.value === value) await decideEvidence(ctx, documentId, field, null, tx);
    const result = await recompute(ctx, documentId, tx);
    if (document.state === "verified") await transition(ctx, documentId, "needs_review", {}, tx);
    return result;
  });
}

async function requireDocumentOf(ctx: Pick<Ctx, "userId">, documentId: string): Promise<Document> {
  try {
    const document = await requireDocument(ctx, documentId);
    if (document.kind !== "payslip") throw new PayrollError("not_found");
    return document;
  } catch (error) {
    if (error instanceof ImportError) throw new PayrollError("not_found");
    throw error;
  }
}

/**
 * A person vouches for the payslip (spec §7.8): every value the LLM inferred must have been
 * confirmed or corrected first, and failed checks must be acknowledged — never waved through.
 */
export async function verifyPayslip(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  options: { acknowledgeFailures?: boolean } = {},
): Promise<void> {
  const document = await requireDocumentOf(ctx, documentId);
  if (document.state !== "needs_review") throw new PayrollError("invalid_state");
  await getDb().transaction(async (tx) => {
    const evidence = await listEvidence(ctx, documentId, tx);
    if (evidence.some((row) => row.origin === "inferred" && row.verification === "unverified")) {
      throw new PayrollError("unconfirmed_inferred");
    }
    const { payslip, assembled } = await recompute(ctx, documentId, tx);
    if (!payslip) throw new PayrollError("no_identity");
    if (hasBlockingFailure(assembled.checks) && !options.acknowledgeFailures) {
      throw new PayrollError("blocking_checks");
    }
    if (!(await transition(ctx, documentId, "verified", {}, tx))) throw new PayrollError("invalid_state");
  });
}

/**
 * Step 5 (spec §7.8 "Applicazione"), one transaction: the active payslip with the same logical key
 * is superseded — never summed —, this one becomes the active one, its leave snapshots and
 * events are written, and what it accrued goes to the pension fund. The payslip after it, if applied, has its leave read again, since its permits
 * are confirmed against this one.
 */
export async function applyPayslip(ctx: Pick<Ctx, "userId">, documentId: string, now: Date = new Date()): Promise<Payslip> {
  const document = await requireDocumentOf(ctx, documentId);
  if (document.state !== "verified") throw new PayrollError("invalid_state");
  try {
    return await getDb().transaction(async (tx) => {
      const { payslip, identity } = await recompute(ctx, documentId, tx);
      if (!payslip || !identity) throw new PayrollError("no_identity");
      const replaced = await activeWithKey(ctx, identity, tx);
      if (replaced && replaced.id !== payslip.id) {
        await tx
          .update(payslips)
          .set({ active: false, supersededBy: payslip.id })
          .where(and(eq(payslips.id, replaced.id), userScoped(ctx).owns(payslips)));
        await clearLeave(ctx, replaced.id, tx);
        await dropCompetence(ctx, replaced.id, tx);
        if (!(await transition(ctx, replaced.documentId, "superseded", {}, tx))) throw new PayrollError("conflict");
      }
      const [applied] = await tx
        .update(payslips)
        .set({ active: true, appliedAt: now, supersededBy: null })
        .where(and(eq(payslips.id, payslip.id), userScoped(ctx).owns(payslips)))
        .returning();
      await writeLeave(ctx, applied, tx);
      // The pension sink (spec §7.8): what this payslip accrued for the fund taking payroll.
      const competence = pensionCompetenceOf(
        applied,
        await fundLineIds(ctx, applied.documentId, await codeMapOf(ctx), tx),
      );
      if (competence) await recordCompetence(ctx, competence, tx);
      if (!(await transition(ctx, documentId, "applied", {}, tx))) throw new PayrollError("conflict");

      // The next month's payslip, if applied, confirms its permits against this one.
      if (identity.type === "ordinary" && identity.period) {
        const [next] = await tx
          .select()
          .from(payslips)
          .where(
            and(
              userScoped(ctx).owns(payslips),
              eq(payslips.active, true),
              eq(payslips.type, "ordinary"),
              eq(payslips.employerKey, identity.employerKey),
              eq(payslips.employeeKey, identity.employeeKey),
              eq(payslips.period, addMonths(identity.period, 1)),
            ),
          );
        if (next) {
          await recompute(ctx, next.documentId, tx);
          await writeLeave(ctx, next, tx);
        }
      }
      return applied;
    });
  } catch (error) {
    if (hasPgError(error, UNIQUE_VIOLATION, "payslips_active_key_uq")) throw new PayrollError("conflict");
    throw error;
  }
}

async function clearLeave(ctx: Pick<Ctx, "userId">, payslipId: string, tx: Tx): Promise<void> {
  await tx
    .delete(payrollLeaveEvents)
    .where(and(eq(payrollLeaveEvents.payslipId, payslipId), userScoped(ctx).owns(payrollLeaveEvents)));
  await tx
    .delete(leaveBalanceSnapshots)
    .where(and(eq(leaveBalanceSnapshots.payslipId, payslipId), userScoped(ctx).owns(leaveBalanceSnapshots)));
}

const UNIT_EVIDENCE =
  "Reply/TeamSystem profile: balances in hours (owner's spec L165); body lines 301/309 marked (hh).";

/**
 * An applied ordinary payslip's leave (spec §7.8): the balances as printed, snapshots never summed,
 * and the events of its FERIE/PERMESSI lines in the month they were used. A 13th writes none.
 */
async function writeLeave(ctx: Pick<Ctx, "userId">, payslip: Payslip, tx: Tx): Promise<void> {
  await clearLeave(ctx, payslip.id, tx);
  if (payslip.type !== "ordinary" || payslip.period === null) return;
  const { assembled } = await computeState(ctx, payslip.documentId, tx);
  const values = assembled.values;
  for (const kind of LEAVE_KINDS) {
    const [previousYear, accrued, used, remaining] = LEAVE_COLUMNS.map((column) => values[leaveField(kind, column)] ?? null);
    if ([previousYear, accrued, used, remaining].every((value) => value === null)) continue;
    await tx.insert(leaveBalanceSnapshots).values(
      userScoped(ctx).stamp({
        payslipId: payslip.id,
        kind,
        period: payslip.period,
        previousYear,
        accrued,
        used,
        remaining,
        unitEvidence: UNIT_EVIDENCE,
      }),
    );
  }
  const lines = await linesOf(ctx, payslip.documentId, tx);
  const idOf = new Map(lines.map((line) => [line.position, line.id]));
  for (const event of assembled.events) {
    await tx.insert(payrollLeaveEvents).values(
      userScoped(ctx).stamp({
        payslipId: payslip.id,
        kind: event.kind,
        hours: event.hours,
        payrollPeriod: payslip.period,
        usagePeriod: addMonths(payslip.period, -1),
        sourceLineIds: event.linePositions.flatMap((position) => idOf.get(position) ?? []),
      }),
    );
  }
}

/** Sets a document aside (spec §7.8 `rejected`); nothing was applied from it, so nothing moves. */
export async function rejectPayslip(ctx: Pick<Ctx, "userId">, documentId: string): Promise<void> {
  await requireDocumentOf(ctx, documentId);
  await getDb().transaction(async (tx) => {
    if (!(await transition(ctx, documentId, "rejected", {}, tx))) throw new PayrollError("invalid_state");
    await tx
      .delete(payslips)
      .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips), eq(payslips.active, false)));
  });
}

/** "Retry" (spec §7.8): reads the original again, keeping what a person decided on unchanged values. */
export async function retryPayslip(ctx: Pick<Ctx, "userId">, documentId: string): Promise<Document | null> {
  const document = await requireDocumentOf(ctx, documentId);
  if (["applied", "superseded", "extracting", "received", "scanning"].includes(document.state)) {
    throw new PayrollError("invalid_state");
  }
  return processPayslip(ctx, documentId);
}

/** A person's payslips, for the register (spec §7.8 D13) and the review. */
export async function payslipsOf(ctx: Pick<Ctx, "userId">, documentIds?: readonly string[]): Promise<Payslip[]> {
  return getDb()
    .select()
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        documentIds === undefined ? undefined : documentIds.length === 0 ? sql`false` : inArray(payslips.documentId, [...documentIds]),
      ),
    )
    .orderBy(desc(payslips.year), sql`${payslips.period} desc nulls first`, asc(payslips.id));
}

/* What time off reads from here (plan F7 §3.1) */

/**
 * A leave balance as one applied payslip printed it. `timeoff` reads these through this function
 * rather than the table: the dependency runs one way, and payroll does not know time off exists.
 */
export interface LeaveSnapshot {
  kind: LeaveKind;
  /** The payslip's own month. */
  period: string;
  previousYearHours: number | null;
  accruedHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
}

/** Leave taken, as an applied payslip accounted for it, in the month it was used. */
export interface LeaveEvent {
  kind: LeaveKind;
  hours: number;
  /** The payslip's own month. */
  payrollPeriod: string;
  /** The month the hours were used in: the payslip's month minus one (spec §7.8). */
  usagePeriod: string;
}

const hoursOf = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * Every leave snapshot an **applied** payslip of `year` printed, oldest first (spec §7.8).
 *
 * Only active payslips count: a superseded one and the rectification that replaced it would
 * otherwise both offer a snapshot for the same month, and the residual would pick whichever came
 * out of the database first. The order is deterministic so the caller can take the last one.
 */
export async function leaveSnapshotsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveSnapshot[]> {
  const rows = await getDb()
    .select({
      kind: leaveBalanceSnapshots.kind,
      period: leaveBalanceSnapshots.period,
      previousYear: leaveBalanceSnapshots.previousYear,
      accrued: leaveBalanceSnapshots.accrued,
      used: leaveBalanceSnapshots.used,
      remaining: leaveBalanceSnapshots.remaining,
    })
    .from(leaveBalanceSnapshots)
    .innerJoin(payslips, eq(payslips.id, leaveBalanceSnapshots.payslipId))
    .where(
      and(
        userScoped(ctx).owns(leaveBalanceSnapshots),
        eq(payslips.active, true),
        sql`extract(year from ${leaveBalanceSnapshots.period}) = ${year}`,
      ),
    )
    .orderBy(asc(leaveBalanceSnapshots.period), asc(leaveBalanceSnapshots.kind));

  return rows.map((row) => ({
    kind: row.kind,
    period: row.period,
    previousYearHours: hoursOf(row.previousYear),
    accruedHours: hoursOf(row.accrued),
    usedHours: hoursOf(row.used),
    remainingHours: hoursOf(row.remaining),
  }));
}

/**
 * Every leave event of `year`, by the month the hours were **used** in, oldest first — which is
 * the year the interface shows them under, not the year of the payslip that reported them. A
 * January payslip reports December, and December belongs to the year before.
 */
export async function leaveEventsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveEvent[]> {
  const rows = await getDb()
    .select({
      kind: payrollLeaveEvents.kind,
      hours: payrollLeaveEvents.hours,
      payrollPeriod: payrollLeaveEvents.payrollPeriod,
      usagePeriod: payrollLeaveEvents.usagePeriod,
    })
    .from(payrollLeaveEvents)
    .innerJoin(payslips, eq(payslips.id, payrollLeaveEvents.payslipId))
    .where(
      and(
        userScoped(ctx).owns(payrollLeaveEvents),
        eq(payslips.active, true),
        sql`extract(year from ${payrollLeaveEvents.usagePeriod}) = ${year}`,
      ),
    )
    .orderBy(asc(payrollLeaveEvents.usagePeriod), asc(payrollLeaveEvents.kind));

  return rows.map((row) => ({
    kind: row.kind,
    hours: Number(row.hours),
    payrollPeriod: row.payrollPeriod,
    usagePeriod: row.usagePeriod,
  }));
}
