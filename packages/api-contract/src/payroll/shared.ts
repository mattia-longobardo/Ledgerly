// What the descriptors of payroll share (rewrite plan R2, 05-refactor.md §5.5 «payroll»; audit
// PAY-6, PAY-8): the vocabularies of the wire, the register and one payslip's review. No route is
// declared here. Amounts are decimal strings, as everywhere on the wire; a payslip prints its leave
// in **hours**, so hours are decimal strings too ("12.50"), never minutes: they are what was read.
import { z } from "zod";
import { civilDate, id, instant, money, monthStart } from "../primitives";
import { PAYROLL_LEAVE_KINDS } from "../timeoff/shared";

// The vocabularies are the domain's (`@ledgerly/domain/payroll`, `imports`): the contract imports zod
// only (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const PAYSLIP_KINDS = ["ordinary", "extra", "bonus", "settlement"] as const;
/** `read`: from a document, through the review; `manual`: typed by hand, applied at once. */
export const PAYSLIP_SOURCES = ["read", "manual"] as const;
export const PAY_FREQUENCIES = ["monthly", "semimonthly", "biweekly", "weekly"] as const;
/** The most extra payments an employer has: one a month. */
export const MAX_EXTRA_PAYMENTS = 12;
export const DOCUMENT_STATES = [
  "received",
  "scanning",
  "extracting",
  "needs_review",
  "needs_ocr",
  "verified",
  "applied",
  "superseded",
  "rejected",
  "failed",
] as const;
export const CODE_ROLES = [
  "ordinary_earnings",
  "thirteenth_earnings",
  "holiday_pay",
  "absence",
  "paid_leave",
  "vacation_offset",
  "vacation_event",
  "permit_offset",
  "permit_event",
  "separate_payment",
  "refund_730",
  "regional_installment",
  "municipal_installment",
  "substitute_tax",
  "substitute_tax_base",
  "employee_fund",
  "employee_fund_adjustment",
  "employee_fund_enrollment",
  "employer_fund",
  "employer_fund_adjustment",
  "employer_fund_enrollment",
  "tfr_contribution",
  "tfr_exemption",
  "welfare_cash",
  "welfare_in_kind",
  "compensated_credit",
  "statistical",
  "other",
] as const;
export const LINE_UNITS = ["hours", "days", "months"] as const;
export const FIELD_GROUPS = ["identity", "compensation", "taxes", "contributions", "tfr", "net", "leave"] as const;
export const FIELD_UNITS = ["eur", "hours", "text", "date"] as const;
export const EVIDENCE_ORIGINS = ["printed", "derived", "inferred"] as const;
export const VERIFICATION_STATES = ["unverified", "confirmed", "corrected"] as const;
/** The register's amount columns: summed per year, averaged per ordinary month. */
export const SUMMED_FIELDS = [
  "gross",
  "taxesTotal",
  "employeeSocial",
  "netPay",
  "irpefGross",
  "taxDeductions",
  "regionalInstallment",
  "substituteTax",
  "refund730",
  "welfareCash",
  "employeeFundEffective",
  "employerFundEffective",
  "tfrSelected",
] as const;
export const CHECK_IDS = [
  "irpef",
  "net",
  "body_deductions",
  "total_deductions",
  "substitute_tax",
  "leave_vacation",
  "leave_rol",
  "leave_permit",
  "plausibility_net",
  "plausibility_gross",
] as const;
export const CHECK_STATUSES = ["passed", "failed", "skipped"] as const;
export const CHECK_SEVERITIES = ["error", "warning"] as const;
export const WARNING_CODES = [
  "unknown_code",
  "tfr_both_differ",
  "tfr_partial_month",
  "employer_fund_adjustment_only",
  "permit_unclassified",
  "extra_month_leave",
  "rectification",
  "missing_identity",
  "unknown_layout",
] as const;
/** Where the theoretical yearly gross comes from: the «Retribuzione di fatto», or the gross without it. */
export const THEORETICAL_BASES = ["contractual", "gross"] as const;
/**
 * The kinds of leave a payslip prints (PAY-6): one vocabulary, the one `GET /timeoff/{year}` already
 * speaks for a payslip's month. A `permit` is counted as ROL by time off.
 */
export const LEAVE_KINDS = PAYROLL_LEAVE_KINDS;
/** The longest note of a code. */
export const MAX_CODE_NOTE = 200;
/** A body code: up to six digits. */
export const CODE_PATTERN = /^\d{1,6}$/;

/**
 * A refusal of payroll's use cases (`PayrollError`): `not_found`; `invalid` (`reason`
 * `invalid_value`, `derived_field`, `invalid_name`); `conflict` (`reason` `invalid_state`,
 * `unconfirmed_inferred`, `blocking_checks`, `no_identity`, `month_applied`, `conflict`).
 */
export const PAYROLL_ERRORS = ["invalid", "conflict", "not_found"] as const;

export const DOCUMENT_ID = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
export const PAYSLIP_ID = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";

export const byPayslip = z.object({ id: id() });
export const byCode = z.object({ code: z.string().regex(CODE_PATTERN) });

/** Hours as printed: a decimal string with two decimals ("12.50"). */
const hours = () => z.string().regex(/^-?\d+\.\d{2}$/);
const amounts = () => z.object(Object.fromEntries(SUMMED_FIELDS.map((field) => [field, money().nullable()])));

/** A payslip's document: its file and where it stands. `hasOriginal`: the PDF is still kept. */
const payslipDocument = z.object({
  id: id(),
  fileName: z.string(),
  state: z.enum(DOCUMENT_STATES),
  receivedAt: instant(),
  /** Why the reading failed, as a code; null otherwise. */
  error: z.string().nullable(),
  hasOriginal: z.boolean(),
});

/** The country's fields of a payslip, as pairs: the key of the catalogue (`GET /payroll/fields`) and its amount. */
export const payslipFieldValues = () => z.record(z.string(), money());

/** What a payslip is: its kind, and the number of its extra payment (1: the first, a 13th). */
const kindOfPayslip = {
  kind: z.enum(PAYSLIP_KINDS),
  extraNumber: z.number().int().min(1).nullable(),
};

/**
 * One row of the register: a payslip applied or waiting for a decision. `id` is its document's —
 * the payslip's own (`payslipId`) for one typed by hand without a document.
 */
const registerRow = z.object({
  id: id(),
  payslipId: id(),
  year: z.number().int(),
  /** The month paid; null for an extra payment and for the months a payslip does not name. */
  period: monthStart().nullable(),
  ...kindOfPayslip,
  source: z.enum(PAYSLIP_SOURCES),
  /** Its document; null for a payslip typed by hand without one. */
  documentId: id().nullable(),
  /** The country's fields it has, as pairs. */
  fields: payslipFieldValues(),
  state: z.enum(DOCUMENT_STATES),
  applied: z.boolean(),
  fileName: z.string(),
  hasOriginal: z.boolean(),
  amounts: amounts(),
  /** The leave left as the payslip printed it (applied ordinary payslips only). */
  leaveLeft: z.object({ vacation: hours().nullable(), rol: hours().nullable(), permit: hours().nullable() }),
  /** What a person still has to look at: 0 once applied, since applying is the decision. */
  openWarnings: z.number().int(),
});

/** The register (PAY-8): what the Payroll page shows, and `get_payroll`. */
export const payrollRegister = z.object({
  years: z.array(
    z.object({
      year: z.number().int(),
      rows: z.array(registerRow),
      /** Sums over the applied payslips of the year, 13th and 14th included. */
      totals: amounts(),
      /** Means over its applied ordinary payslips. */
      averages: amounts(),
      hasApplied: z.boolean(),
      /** The year's KPIs: the gross earned is `totals.gross`, the mean monthly net `averages.netPay`. */
      kpis: z.object({
        /** The mean net of the year's last three ordinary payslips. */
        net3: money().nullable(),
        /** Taxes over gross across the year's ordinary payslips, a fraction (0.31 is 31 %). */
        taxRate: z.number().nullable(),
        /**
         * The theoretical yearly gross: the «Retribuzione di fatto» of the year's latest ordinary
         * payslip (`from`) × `months` (12 and the employer's extra payments), its gross without it
         * (`basis` `gross`). Null when the year has no ordinary payslip.
         */
        theoretical: z
          .object({ amount: money(), basis: z.enum(THEORETICAL_BASES), from: monthStart(), months: z.number().int() })
          .nullable(),
      }),
    }),
  ),
  /** Documents with no payslip to show yet: being read, waiting for OCR, failed, unreadable. */
  inbox: z.array(payslipDocument),
  awaiting: z.number().int(),
  /** A document is being read: ask again in a while. */
  inFlight: z.boolean(),
  applied: z.number().int(),
  span: z.object({ from: monthStart(), to: monthStart() }).nullable(),
});

/** One value of the review, in the catalogue's order; `value` is the correction when there is one. */
const reviewField = z.object({
  field: z.string(),
  group: z.enum(FIELD_GROUPS),
  unit: z.enum(FIELD_UNITS),
  derived: z.boolean(),
  /** The value as it stands, in canonical form: amounts and hours "1234.56", dates `YYYY-MM-DD`. */
  value: z.string().nullable(),
  /** What was read, when a person corrected it; null otherwise. */
  read: z.string().nullable(),
  origin: z.enum(EVIDENCE_ORIGINS),
  verification: z.enum(VERIFICATION_STATES),
  confidence: z.number(),
  sourceLabel: z.string().nullable(),
  derivedFrom: z.array(z.string()),
  page: z.number().int().nullable(),
  /** Where on the page, `[x0, y0, x1, y1]` in PDF points. */
  bbox: z.array(z.number()).length(4).nullable(),
});

/** One payslip's review (PAY-8): what was read, from where, and what it implies. */
export const payslipReview = z.object({
  document: payslipDocument,
  /** Null until the identity of the payslip is read. */
  payslip: z
    .object({
      id: id(),
      year: z.number().int(),
      period: monthStart().nullable(),
      ...kindOfPayslip,
      source: z.enum(PAYSLIP_SOURCES),
      /** The country's fields, as pairs. */
      fields: payslipFieldValues(),
      printedOn: civilDate().nullable(),
      paidOn: civilDate().nullable(),
      applied: z.boolean(),
      appliedAt: instant().nullable(),
    })
    .nullable(),
  /** The heading: the period as the payslip prints it. */
  periodLabel: z.string().nullable(),
  fields: z.array(reviewField),
  checks: z.array(
    z.object({
      id: z.enum(CHECK_IDS),
      status: z.enum(CHECK_STATUSES),
      severity: z.enum(CHECK_SEVERITIES),
      expected: z.string().nullable(),
      actual: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.enum(WARNING_CODES),
      field: z.string().nullable(),
      /** `code`, `hours`, `monthField`, `contributionLine`, `documentId`, by warning. */
      detail: z.record(z.string(), z.string()),
    }),
  ),
  /** A failed check of severity `error`: verifying asks to acknowledge it. */
  blocking: z.boolean(),
  /** The leave taken, by the month it was used in: stored once applied, foreseen before. */
  leaveEvents: z.array(z.object({ kind: z.enum(LEAVE_KINDS), hours: hours(), usagePeriod: monthStart() })),
  lines: z.array(
    z.object({
      position: z.number().int(),
      code: z.string(),
      description: z.string(),
      quantity: z.string().nullable(),
      quantityUnit: z.enum(LINE_UNITS).nullable(),
      earnings: money().nullable(),
      deductions: money().nullable(),
      statistical: money().nullable(),
      role: z.enum(CODE_ROLES),
    }),
  ),
  /** «Fill with AI» can run: blank fields it may fill, a payslip to review, the fallback configured. */
  llmFill: z.boolean(),
});

const EMPTY_AMOUNTS = Object.fromEntries(SUMMED_FIELDS.map((field) => [field, null]));

export const REGISTER_EXAMPLE = {
  years: [
    {
      year: 2026,
      rows: [
        {
          id: DOCUMENT_ID,
          payslipId: PAYSLIP_ID,
          year: 2026,
          period: "2026-03-01",
          kind: "ordinary",
          extraNumber: null,
          source: "read",
          documentId: DOCUMENT_ID,
          fields: { irpefGross: "520.00" },
          state: "applied",
          applied: true,
          fileName: "payslip-2026-03.pdf",
          hasOriginal: true,
          amounts: { ...EMPTY_AMOUNTS, gross: "3000.00", netPay: "2100.00" },
          leaveLeft: { vacation: "120.00", rol: "40.00", permit: null },
          openWarnings: 0,
        },
      ],
      totals: { ...EMPTY_AMOUNTS, gross: "3000.00", netPay: "2100.00" },
      averages: { ...EMPTY_AMOUNTS, gross: "3000.00", netPay: "2100.00" },
      hasApplied: true,
      kpis: {
        net3: "2100.00",
        taxRate: 0.21,
        theoretical: { amount: "39000.00", basis: "contractual", from: "2026-03-01", months: 13 },
      },
    },
  ],
  inbox: [],
  awaiting: 0,
  inFlight: false,
  applied: 1,
  span: { from: "2026-03-01", to: "2026-03-01" },
};

export const REVIEW_EXAMPLE = {
  document: {
    id: DOCUMENT_ID,
    fileName: "payslip-2026-03.pdf",
    state: "needs_review",
    receivedAt: "2026-04-02T08:00:00.000Z",
    error: null,
    hasOriginal: true,
  },
  payslip: {
    id: PAYSLIP_ID,
    year: 2026,
    period: "2026-03-01",
    kind: "ordinary",
    extraNumber: null,
    source: "read",
    fields: { irpefGross: "520.00" },
    printedOn: "2026-03-27",
    paidOn: null,
    applied: false,
    appliedAt: null,
  },
  periodLabel: "MARZO 2026",
  fields: [
    {
      field: "netPay",
      group: "net",
      unit: "eur",
      derived: false,
      value: "2100.00",
      read: null,
      origin: "printed",
      verification: "unverified",
      confidence: 0.95,
      sourceLabel: "NETTO DEL MESE",
      derivedFrom: [],
      page: 1,
      bbox: [400, 700, 480, 712],
    },
  ],
  checks: [{ id: "net", status: "passed", severity: "error", expected: null, actual: null, reason: null }],
  warnings: [],
  blocking: false,
  leaveEvents: [{ kind: "vacation", hours: "8.00", usagePeriod: "2026-02-01" }],
  lines: [
    {
      position: 1,
      code: "1000",
      description: "RETRIBUZIONE",
      quantity: null,
      quantityUnit: null,
      earnings: "3000.00",
      deductions: null,
      statistical: null,
      role: "ordinary_earnings",
    },
  ],
  llmFill: false,
};
