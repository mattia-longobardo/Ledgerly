import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  type Document,
  type Evidence,
  getDocument,
  listDocuments,
  listEvidence,
} from "@/modules/imports/service";
import { AWAITING_REVIEW, IN_FLIGHT } from "@/modules/imports/rules";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import type { LeaveKind } from "./fields";
import { hasBlockingFailure } from "./parse/checks";
import {
  averageNet,
  averageTaxRate,
  groupByYear,
  isExtraMonth,
  meanCents,
  ralEstimate,
  type RalEstimate,
  SUMMED_FIELDS,
  type SummedField,
} from "./rules";
import { leaveBalanceSnapshots, payrollLeaveEvents } from "./schema";
import { codeMapOf, computeState, listCodeMap, type Payslip, payslipsOf, type Recomputed } from "./service";

export interface RegisterRow {
  payslip: Payslip;
  document: Document;
  /** Hours left as the payslip printed them (applied ordinary payslips only). */
  leaveLeft: Partial<Record<LeaveKind, string | null>>;
}

export interface YearSummary {
  year: number;
  rows: RegisterRow[];
  /** Sums over the applied payslips of the year, 13th and 14th included (spec §7.8). */
  totals: Record<SummedField, Cents | null>;
  /** Means over its applied ordinary payslips, 13th and 14th left out. */
  averages: Record<SummedField, Cents | null>;
}



export interface RegisterView {
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

function sumOf(rows: readonly RegisterRow[], field: SummedField): Cents | null {
  const known = rows.map((row) => row.payslip[field]).filter((value): value is Cents => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0n);
}

/**
 * The Payroll register (spec §7.8 "Registro", D13): every payslip that is applied or waiting for a
 * decision, grouped by year with the year's totals and monthly means over the applied ones; the
 * KPIs over applied ordinary payslips only. Superseded and rejected documents are not in it.
 */
export async function registerView(ctx: Pick<Ctx, "userId">): Promise<RegisterView> {
  const [documents, payslips] = await Promise.all([listDocuments(ctx, ["payslip"]), payslipsOf(ctx)]);
  const documentOf = new Map(documents.map((document) => [document.id, document]));
  const shown = payslips.filter((payslip) => {
    const document = documentOf.get(payslip.documentId);
    return document !== undefined && !["superseded", "rejected"].includes(document.state);
  });
  const active = shown.filter((payslip) => payslip.active);
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
    document: documentOf.get(payslip.documentId)!,
    leaveLeft: leaveOf.get(payslip.id) ?? {},
  }));

  const years = groupByYear(rows.map((row) => ({ ...row.payslip, row }))).map((group) => {
    const ofYear = group.payslips.map((payslip) => payslip.row);
    const applied = ofYear.filter((row) => row.payslip.active);
    const ordinary = applied.filter((row) => !isExtraMonth(row.payslip.type));
    const totals = {} as Record<SummedField, Cents | null>;
    const averages = {} as Record<SummedField, Cents | null>;
    for (const field of SUMMED_FIELDS) {
      totals[field] = sumOf(applied, field);
      averages[field] = meanCents(ordinary.map((row) => row.payslip[field]));
    }
    return { year: group.year, rows: ofYear, totals, averages };
  });

  const withPayslip = new Set(payslips.map((payslip) => payslip.documentId));
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
      ral: ralEstimate(active),
    },
    applied: active.length,
    span: periods.length === 0 ? null : { from: periods[0], to: periods.at(-1)! },
  };
}

export interface ReviewView extends Recomputed {
  document: Document;
  evidence: Evidence[];
  blocking: boolean;
  /** The leave events stored when it was applied; before that, `assembled.events` says what they will be. */
  appliedEvents: { kind: LeaveKind; hours: string; usagePeriod: string }[];
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
  return {
    ...state,
    document,
    evidence,
    blocking: hasBlockingFailure(state.assembled.checks),
    appliedEvents: events,
  };
}

/** The code map as Settings › Data shows it. */
export async function codeMapView(ctx: Pick<Ctx, "userId">) {
  await codeMapOf(ctx);
  return listCodeMap(ctx);
}
