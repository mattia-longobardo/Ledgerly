import { and, eq, inArray } from "drizzle-orm";
import {
  type Document,
  type Evidence,
  getDocument,
  listDocuments,
  listEvidence,
} from "../imports/service";
import { AWAITING_REVIEW, IN_FLIGHT } from "../imports/rules";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { llmFallbackAvailable } from "../../platform/settings/service";
import { addMonths } from "../../shared/dates";
import type { Cents } from "../../shared/money";
import { isFieldName, type LeaveKind, llmFillable } from "./fields";
import { hasBlockingFailure } from "./parse/checks";
import {
  averageNet,
  averageTaxRate,
  groupByYear,
  isOrdinary,
  meanCents,
  ralEstimate,
  type RalEstimate,
  isSeededCode,
  SUMMED_FIELDS,
  type SummedField,
} from "./rules";
import { leaveBalanceSnapshots, payrollLeaveEvents } from "./schema";
import {
  codeMapOf,
  computeState,
  employerOf,
  listCodeMap,
  type Pairs,
  pairsOf,
  type Payslip,
  payslipsOf,
  type Recomputed,
} from "./service";

export interface RegisterRow {
  payslip: Payslip;
  /** Null for a payslip typed by hand without its PDF. */
  document: Document | null;
  /** The country's fields of the payslip, as pairs (R5g, E4). */
  fields: Pairs;
  /** Hours left as the payslip printed them (applied ordinary payslips only). */
  leaveLeft: Partial<Record<LeaveKind, string | null>>;
  /**
   * How many things this payslip still asks a person to look at (spec §7.8). Only while it waits:
   * applying a payslip **is** the decision, so a payslip already in the register is not nagged
   * about again — its warnings stay on its own page, where they are read in context.
   */
  openWarnings: number;
}

export interface YearSummary {
  year: number;
  rows: RegisterRow[];
  /** Sums over the applied payslips of the year, 13th and 14th included (spec §7.8). */
  totals: Record<SummedField, Cents | null>;
  /** Means over its applied ordinary payslips, 13th and 14th left out. */
  averages: Record<SummedField, Cents | null>;
}



interface RegisterView {
  years: YearSummary[];
  /** Documents with no payslip to show yet: being read, waiting for OCR, failed, unreadable. */
  inbox: Document[];
  awaiting: number;
  inFlight: boolean;
  kpis: {
    net3: Cents | null;
    net6: Cents | null;
    net12: Cents | null;
    taxRate: number | null;
    ral: RalEstimate | null;
  };
  applied: number;
  span: { from: string; to: string } | null;
}

/**
 * A column of the register for one payslip: a field of the country from its pair — or from the old
 * column, on a row the image before R5g wrote without pairs —, a base field (never a pair) from its row.
 */
function amountOf(row: RegisterRow, field: SummedField): Cents | null {
  return row.fields[field] ?? row.payslip[field];
}

function sumOf(rows: readonly RegisterRow[], field: SummedField): Cents | null {
  const known = rows.map((row) => amountOf(row, field)).filter((value): value is Cents => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0n);
}

/**
 * The Payroll register (spec §7.8 "Registro", D13): every payslip that is applied or waiting for a
 * decision, grouped by year with the year's totals and monthly means over the applied ones; the
 * KPIs over applied ordinary payslips only. Superseded and rejected documents are not in it.
 */
export async function registerView(ctx: Pick<Ctx, "userId">): Promise<RegisterView> {
  const [documents, payslips, employer] = await Promise.all([
    listDocuments(ctx, ["payslip"]),
    payslipsOf(ctx),
    employerOf(ctx),
  ]);
  const documentOf = new Map(documents.map((document) => [document.id, document]));
  const shown = payslips.filter((payslip) => {
    if (payslip.documentId === null) return payslip.source === "manual";
    const document = documentOf.get(payslip.documentId);
    return document !== undefined && !["superseded", "rejected"].includes(document.state);
  });
  const active = shown.filter((payslip) => payslip.active);
  const pairs = await pairsOf(
    ctx,
    shown.map((payslip) => payslip.id),
  );
  const snapshots =
    active.length === 0
      ? []
      : await getDb()
          .select({
            payslipId: leaveBalanceSnapshots.payslipId,
            kind: leaveBalanceSnapshots.kind,
            remaining: leaveBalanceSnapshots.remaining,
          })
          .from(leaveBalanceSnapshots)
          .where(
            and(
              userScoped(ctx).owns(leaveBalanceSnapshots),
              inArray(
                leaveBalanceSnapshots.payslipId,
                active.map((payslip) => payslip.id),
              ),
            ),
          )
          .orderBy(leaveBalanceSnapshots.payslipId, leaveBalanceSnapshots.kind);
  const leaveOf = new Map<string, Partial<Record<LeaveKind, string | null>>>();
  for (const snapshot of snapshots) {
    leaveOf.set(snapshot.payslipId, { ...leaveOf.get(snapshot.payslipId), [snapshot.kind]: snapshot.remaining });
  }
  const rows: RegisterRow[] = shown.map((payslip) => ({
    payslip,
    document: payslip.documentId === null ? null : documentOf.get(payslip.documentId)!,
    fields: pairs.get(payslip.id) ?? {},
    leaveLeft: leaveOf.get(payslip.id) ?? {},
    openWarnings: payslip.active ? 0 : payslip.warnings.length,
  }));

  const years = groupByYear(
    rows.map((row) => ({ ...row.payslip, row })),
    employer,
  ).map((group) => {
    const ofYear = group.payslips.map((payslip) => payslip.row);
    const applied = ofYear.filter((row) => row.payslip.active);
    const ordinary = applied.filter((row) => isOrdinary(row.payslip));
    const totals = {} as Record<SummedField, Cents | null>;
    const averages = {} as Record<SummedField, Cents | null>;
    for (const field of SUMMED_FIELDS) {
      totals[field] = sumOf(applied, field);
      averages[field] = meanCents(ordinary.map((row) => amountOf(row, field)));
    }
    return { year: group.year, rows: ofYear, totals, averages };
  });

  const withPayslip = new Set(payslips.flatMap((payslip) => payslip.documentId ?? []));
  const inbox = documents.filter(
    (document) => !withPayslip.has(document.id) && !["rejected", "superseded", "applied"].includes(document.state),
  );
  const periods = active.flatMap((payslip) => (payslip.period ? [payslip.period] : [])).toSorted();
  return {
    years,
    inbox,
    awaiting: documents.filter((document) => AWAITING_REVIEW.includes(document.state)).length,
    inFlight: documents.some((document) => IN_FLIGHT.includes(document.state)),
    kpis: {
      net3: averageNet(active, 3),
      net6: averageNet(active, 6),
      net12: averageNet(active, 12),
      taxRate: averageTaxRate(active),
      ral: ralEstimate(active, employer),
    },
    applied: active.length,
    span: periods.length === 0 ? null : { from: periods[0], to: periods.at(-1)! },
  };
}

interface ReviewView extends Recomputed {
  document: Document;
  evidence: Evidence[];
  blocking: boolean;
  /** The leave taken, by the month it was used in: the events stored once applied, foreseen before. */
  leaveEvents: { kind: LeaveKind; hours: string; usagePeriod: string }[];
  /** «Fill with AI» can run: blank fields it may fill, a payslip to review, the fallback configured. */
  llmFill: boolean;
  /** The country's fields of the payslip, as pairs. */
  pairs: Pairs;
}

async function pairsOfOne(ctx: Pick<Ctx, "userId">, payslip: Payslip | null): Promise<Pairs> {
  return payslip === null ? {} : ((await pairsOf(ctx, [payslip.id])).get(payslip.id) ?? {});
}

/** One payslip's review (spec §7.8 "Review payslip"): what was read, from where, and what it implies. */
export async function reviewView(ctx: Pick<Ctx, "userId">, documentId: string): Promise<ReviewView | null> {
  const document = await getDocument(ctx, documentId);
  if (!document || document.kind !== "payslip") return null;
  const [evidence, state] = await Promise.all([listEvidence(ctx, documentId), computeState(ctx, documentId)]);
  const events =
    state.payslip?.active === true
      ? await getDb()
          .select({ kind: payrollLeaveEvents.kind, hours: payrollLeaveEvents.hours, usagePeriod: payrollLeaveEvents.usagePeriod })
          .from(payrollLeaveEvents)
          .where(and(userScoped(ctx).owns(payrollLeaveEvents), eq(payrollLeaveEvents.payslipId, state.payslip.id)))
          .orderBy(payrollLeaveEvents.usagePeriod, payrollLeaveEvents.kind)
      : [];
  const pairs = await pairsOfOne(ctx, state.payslip);
  const period = state.identity?.period ?? null;
  const blanks = evidence.some(
    (row) => isFieldName(row.field) && llmFillable(row.field) && row.value === null && row.origin === "printed",
  );
  return {
    ...state,
    document,
    evidence,
    blocking: hasBlockingFailure(state.assembled.checks),
    leaveEvents:
      state.payslip?.active === true
        ? events
        : period
          ? state.assembled.events.map((event) => ({ kind: event.kind, hours: event.hours, usagePeriod: addMonths(period, -1) }))
          : [],
    llmFill: blanks && document.state === "needs_review" && (await llmFallbackAvailable()),
    pairs,
  };
}

/** The code map as Payroll › Settings shows it; `seeded`: the reading profile has the code. */
export async function codeMapView(ctx: Pick<Ctx, "userId">) {
  await codeMapOf(ctx);
  return (await listCodeMap(ctx)).map((entry) => ({
    code: entry.code,
    role: entry.role,
    note: entry.note,
    seeded: isSeededCode(entry.code),
  }));
}

/** How many payslips wait for the person's review (rewrite plan R5e, «Da fare»). */
export async function payslipsAwaitingReview(ctx: Pick<Ctx, "userId">): Promise<number> {
  const documents = await listDocuments(ctx, ["payslip"]);
  return documents.filter((document) => AWAITING_REVIEW.includes(document.state)).length;
}
