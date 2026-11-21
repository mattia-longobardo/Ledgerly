// Payroll · the one serializer of the register, a payslip's review and the code map (audit API-2,
// PAY-8): the routes and the tools `get_payroll` and `get_payslip` answer through these.
import type { z } from "zod";
import type { PAYROLL } from "@ledgerly/api-contract";
import type { codeMapView, registerView, reviewView } from "@ledgerly/domain/payroll";
import { FIELDS, isFieldName } from "@ledgerly/domain/payroll";
import { effectiveValue, SUMMED_FIELDS } from "@ledgerly/domain/payroll/client";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Register = z.input<typeof PAYROLL.payroll.getPayroll.response>;
type Review = z.input<typeof PAYROLL.payroll.getPayslip.response>;
type RegisterData = Awaited<ReturnType<typeof registerView>>;
type ReviewData = NonNullable<Awaited<ReturnType<typeof reviewView>>>;
type Document = RegisterData["inbox"][number];

const money = (cents: Cents | null): string | null => (cents === null ? null : centsToDecimal(cents));
const amounts = (values: Record<string, Cents | null>) =>
  Object.fromEntries(Object.entries(values).map(([field, cents]) => [field, money(cents)]));

function documentOut(document: Document) {
  return {
    id: document.id,
    fileName: document.fileName,
    state: document.state,
    receivedAt: document.receivedAt.toISOString(),
    error: document.error,
    hasOriginal: document.storageKey !== null,
  };
}

/** The register of the Payroll page. */
export function registerOut(view: RegisterData): Register {
  const { ral } = view.kpis;
  return {
    years: view.years.map((year) => ({
      year: year.year,
      rows: year.rows.map(({ payslip, document, leaveLeft, openWarnings }) => ({
        id: document.id,
        payslipId: payslip.id,
        year: payslip.year,
        period: payslip.period,
        type: payslip.type,
        state: document.state,
        applied: payslip.active,
        fileName: document.fileName,
        hasOriginal: document.storageKey !== null,
        amounts: Object.fromEntries(SUMMED_FIELDS.map((field) => [field, money(payslip[field])])),
        leaveLeft: {
          vacation: leaveLeft.vacation ?? null,
          rol: leaveLeft.rol ?? null,
          permit: leaveLeft.permit ?? null,
        },
        openWarnings,
      })),
      totals: amounts(year.totals),
      averages: amounts(year.averages),
      hasApplied: year.rows.some((row) => row.payslip.active),
    })),
    inbox: view.inbox.map(documentOut),
    awaiting: view.awaiting,
    inFlight: view.inFlight,
    kpis: {
      net3: money(view.kpis.net3),
      net6: money(view.kpis.net6),
      net12: money(view.kpis.net12),
      taxRate: view.kpis.taxRate,
      ral: ral === null ? null : { amount: centsToDecimal(ral.cents), basis: ral.basis, year: ral.year },
    },
    applied: view.applied,
    span: view.span,
  };
}

/** The review's values, in the catalogue's order. */
function fieldsOut(evidence: ReviewData["evidence"]): Review["fields"] {
  const byField = new Map(evidence.map((row) => [row.field, row]));
  return Object.keys(FIELDS).flatMap((field) => {
      const row = byField.get(field);
      if (!row || !isFieldName(field)) return [];
      const spec: { group: Review["fields"][number]["group"]; unit: Review["fields"][number]["unit"]; derived?: boolean } =
        FIELDS[field];
      return [
        {
          field,
          group: spec.group,
          unit: spec.unit,
          derived: spec.derived === true,
          value: effectiveValue(row),
          read: row.verification === "corrected" ? row.value : null,
          origin: row.origin,
          verification: row.verification,
          confidence: Number(row.confidence),
          sourceLabel: row.sourceLabel,
          derivedFrom: (row.derivedFrom ?? []).filter((name) => isFieldName(name)),
          page: row.page,
          bbox: row.bbox && row.bbox.length === 4 ? row.bbox : null,
        },
      ];
    });
}

/** One payslip's review. */
export function reviewOut(view: ReviewData): Review {
  const { payslip } = view;
  return {
    document: documentOut(view.document),
    payslip:
      payslip === null
        ? null
        : {
            id: payslip.id,
            year: payslip.year,
            period: payslip.period,
            type: payslip.type,
            printedOn: payslip.printedOn,
            paidOn: payslip.paidOn,
            applied: payslip.active,
            appliedAt: payslip.appliedAt?.toISOString() ?? null,
          },
    periodLabel: view.assembled.values.periodLabel ?? null,
    fields: fieldsOut(view.evidence),
    checks: view.assembled.checks.map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity,
      expected: check.expected ?? null,
      actual: check.actual ?? null,
      reason: check.reason ?? null,
    })),
    warnings: view.warnings.map((warning) => ({
      code: warning.code,
      field: warning.field ?? null,
      detail: warning.detail ?? {},
    })),
    blocking: view.blocking,
    leaveEvents: view.leaveEvents,
    lines: view.lines.map((line) => ({
      position: line.position,
      code: line.code,
      description: line.description,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit,
      earnings: money(line.earningsCents),
      deductions: money(line.deductionsCents),
      statistical: money(line.statisticalCents),
      role: line.role,
    })),
    llmFill: view.llmFill,
  };
}

/** The code map of Payroll › Settings. */
export const codesOut = (codes: Awaited<ReturnType<typeof codeMapView>>) => ({ codes });
