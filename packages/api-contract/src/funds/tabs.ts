// The tabs of a fund that follow the Overview (rewrite plan R2, R3 funds): Valuations, Contributions
// and Settings, and what the form that creates a fund starts from. The vocabularies and the rows the
// home and the Overview share are in `shared.ts`.
import { z } from "zod";
import { civilDate, id, money } from "../primitives";
import {
  ACCRUAL_PERIODS,
  COMPONENTS,
  debitOut,
  FEE_BASES,
  FEE_PERIODS,
  fundRef,
  INTERVAL_UNITS,
  OPERATION_ORIGINS,
  operationRow,
  PAYROLL_COMPONENTS,
  periodOut,
  QUARTER_STATUSES,
  SOURCE_KINDS,
  SOURCE_STATES,
  valuationLine,
  valuationRow,
} from "./shared";

/** A fund's Valuations tab: the lines of the period, the best and worst stretch, the recorded values. */
export const fundValuations = z.object({
  fundId: id(),
  period: periodOut,
  /** The period ends before the fund's first data. */
  beforeFirst: z.boolean(),
  /** `valuationId`: the recorded value of that day, the one «Edit» opens; null for a value read elsewhere. */
  lines: z.array(valuationLine.extend({ valuationId: id().nullable() })),
  best: valuationLine.nullable(),
  worst: valuationLine.nullable(),
  /** Newest first. */
  recorded: z.array(valuationRow),
  /** How many values the fund has in any period, and the newest of them. */
  valuesEver: z.number().int(),
  lastValue: z.object({ on: civilDate(), value: money() }).nullable(),
  /** The newest value is inside the period's dates but closes the period before (decision 3 of §9). */
  lastValueClosesPrevious: z.boolean(),
  /** Money of the period after its last value. */
  notInValue: money(),
  /** The positions a statement stated before release N6, read only, in the period. */
  statements: z.array(
    z.object({
      id: id(),
      on: civilDate(),
      value: money(),
      worker: money().nullable(),
      employer: money().nullable(),
      tfr: money().nullable(),
      inflows: money().nullable(),
      outflows: money().nullable(),
      reportedGain: money().nullable(),
    }),
  ),
});

/** One component of a period against the payslips (GC §9-§11). */
const componentStatus = z.object({
  component: z.enum(COMPONENTS),
  accrued: money().nullable(),
  credited: money().nullable(),
  difference: money().nullable(),
  status: z.enum(QUARTER_STATUSES),
  decision: z.object({ note: z.string(), difference: money() }).nullable(),
});

/** One period of the payslip source: accrued against credited, with its deadline. */
const quarterStatus = z.object({
  year: z.number().int(),
  /** A quarter, or a month for a source that accrues by month. */
  index: z.number().int(),
  due: civilDate().nullable(),
  toleranceUntil: civilDate().nullable(),
  status: z.enum(QUARTER_STATUSES),
  reason: z.enum(["missing_payslip", "stale_export"]).nullable(),
  components: z.array(componentStatus),
  /** The months with no payslip, each as its first day (`2031-05-01`). */
  missingMonths: z.array(civilDate()),
  /** The day of the period's last credit; null before any. */
  lastCreditedOn: civilDate().nullable(),
  fees: money(),
  net: money(),
  /** The payslips whose competences make the period, for the link to their review. */
  payslips: z.array(z.object({ payslipId: id(), documentId: id().nullable() })),
});

/** A fund's Contributions tab: the register, the periods of the payslip source and the accrued months. */
export const fundContributions = z.object({
  fundId: id(),
  fund: fundRef,
  period: periodOut,
  /** The period ends before the fund's first data. */
  beforeFirst: z.boolean(),
  /** `gross`: what the operation moved, an exit negative; `origin`: the badge of the line. */
  operations: z.array(operationRow.extend({ gross: money(), origin: z.enum(OPERATION_ORIGINS) })),
  /** The register's total row: the payslip's parts without the voluntary payments; the fees as a cost. */
  totals: z.object({
    worker: money(),
    employer: money(),
    tfr: money(),
    voluntary: money(),
    other: money(),
    fees: money(),
    net: money(),
  }),
  operationsEver: z.number().int(),
  /** A source other than «by hand» feeds the fund. */
  fedBySources: z.boolean(),
  /** The payslips of the period, one per competence, in the payslip source's order. */
  payslips: z.array(
    z.object({
      competenceId: id(),
      payslipId: id(),
      documentId: id().nullable(),
      /** The month of a monthly payslip; null for a thirteenth or another extra payslip. */
      month: civilDate().nullable(),
      payslipType: z.string(),
      year: z.number().int(),
      index: z.number().int(),
      worker: money().nullable(),
      employer: money().nullable(),
      tfr: money().nullable(),
      total: money(),
      /** The state of the period it belongs to; null with no period. */
      status: z.enum(QUARTER_STATUSES).nullable(),
      reason: z.enum(["missing_payslip", "stale_export"]).nullable(),
    }),
  ),
  payslipTotals: z.object({ worker: money(), employer: money(), tfr: money(), total: money() }),
  /** Every recurring debit, active or paused. */
  debits: z.array(debitOut),
  /** What «Record contribution» opens with; null for an archived fund. Periods newest first. */
  setup: z
    .object({
      defaultKind: z.enum(["voluntary", "payroll"]),
      defaultFees: z.object({ voluntary: money(), payroll: money() }),
      periods: z.array(z.object({ year: z.number().int(), index: z.number().int() })),
      pendingPeriod: z.object({ year: z.number().int(), index: z.number().int() }).nullable(),
    })
    .nullable(),
  /** Null for a fund with no payslip source. */
  payroll: z
    .object({
      accrualPeriod: z.enum(ACCRUAL_PERIODS),
      components: z.array(z.enum(PAYROLL_COMPONENTS)),
      /** The source has due dates: the periods and «on the way» are drawn. */
      hasCalendar: z.boolean(),
      /** Days after a deadline before a missing credit is worth saying. */
      toleranceDays: z.number().int(),
      periods: z.array(quarterStatus),
      onTheWay: money(),
    })
    .nullable(),
  accrued: z.array(z.object({ on: civilDate(), amount: money(), dueOn: civilDate().nullable() })),
  /** The active recurring debit's state, when the fund has one. */
  debit: z
    .object({
      sourceId: id(),
      /** The running period's debit: found (on its day), awaited, or missing (by a day). */
      status: z.enum(["found", "awaited", "missing", "none"]),
      on: civilDate().nullable(),
      amount: money().nullable(),
      accountName: z.string().nullable(),
    })
    .nullable(),
});

/** A source of contributions, as its form edits it. */
export const sourceRow = z.object({
  id: id(),
  kind: z.enum(SOURCE_KINDS),
  state: z.enum(SOURCE_STATES),
  components: z.array(z.enum(PAYROLL_COMPONENTS)).nullable(),
  accrualPeriod: z.enum(ACCRUAL_PERIODS).nullable(),
  employer: z.string().nullable(),
  due: z.object({ day: z.number().int(), offsetMonths: z.number().int() }).nullable(),
  /** The explicit due dates a source keeps (`keepDueEntries`): opaque, handed back as they came. */
  dueEntries: z.unknown(),
  toleranceDays: z.number().int().nullable(),
  amount: money().nullable(),
  frequency: z.object({ count: z.number().int(), unit: z.enum(INTERVAL_UNITS) }).nullable(),
  debitDay: z.number().int().nullable(),
  accountId: id().nullable(),
  accountName: z.string().nullable(),
  payeeMatch: z.string().nullable(),
  validFrom: civilDate().nullable(),
  validTo: civilDate().nullable(),
  note: z.string().nullable(),
  /** How many contributions it has: one with contributions is paused, never removed. */
  contributions: z.number().int(),
});

/** A fee, as its form edits it. */
export const feeRow = z.object({
  id: id(),
  label: z.string(),
  basis: z.enum(FEE_BASES),
  amount: money().nullable(),
  /** A percentage ("0.45" is 0,45 %). */
  rate: z.string().nullable(),
  period: z.enum(FEE_PERIODS).nullable(),
  sourceId: id().nullable(),
  component: z.enum(PAYROLL_COMPONENTS).nullable(),
  validFrom: civilDate().nullable(),
  validTo: civilDate().nullable(),
  note: z.string().nullable(),
});

/** A fund's Settings tab: the fund, its sources and fees, the codes of the payslip, what is taken. */
export const fundSettings = z.object({
  fund: fundRef,
  sources: z.array(
    sourceRow.extend({
      /** The next due dates of a payslip source, oldest first. */
      nextDue: z.array(civilDate()),
      /** The explicit due dates, typed (`dueEntries` hands them back as they are stored). */
      dueDates: z.array(
        z.object({
          period: z.number().int(),
          month: z.number().int(),
          day: z.number().int(),
          nextYear: z.boolean(),
        }),
      ),
    }),
  ),
  /** The page's order: in force first, by basis and by name; then the expired ones (`expired`). */
  fees: z.array(feeRow.extend({ expired: z.boolean() })),
  /** The payslip source the periods are counted by; null with none. */
  payrollSourceId: id().nullable(),
  /** What the fees on the assets cost in a year, on the last value: `none` with no such fee today. */
  assetsEstimate: z.object({
    state: z.enum(["none", "needs_value", "estimated"]),
    amount: money().nullable(),
    /** A fraction a year. */
    rate: z.number().nullable(),
    value: money().nullable(),
    on: civilDate().nullable(),
  }),
  /** The payslip codes behind each component, for Settings to show them. */
  codes: z.record(z.string(), z.array(z.string())),
  /** The components another fund's payslip source already takes, with that fund's name. */
  taken: z.array(z.object({ component: z.enum(PAYROLL_COMPONENTS), fund: z.string() })),
});

/** A source of a template: its kind, and the fields of the form that differ from a new source's. */
const templateSource = z.object({
  kind: z.enum(SOURCE_KINDS),
  state: z.enum(SOURCE_STATES).optional(),
  components: z.array(z.enum(PAYROLL_COMPONENTS)).optional(),
  accrualPeriod: z.enum(ACCRUAL_PERIODS).optional(),
  employer: z.string().optional(),
  hasDue: z.boolean().optional(),
  dueDay: z.string().optional(),
  dueOffsetMonths: z.string().optional(),
  toleranceDays: z.string().optional(),
  note: z.string().optional(),
  amount: z.string().optional(),
  frequencyCount: z.string().optional(),
  frequencyUnit: z.enum(INTERVAL_UNITS).optional(),
  debitDay: z.string().optional(),
  accountId: z.string().optional(),
  payeeMatch: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});

/** A fee of a template, as the form takes it; `scope` names a source by `#<index>` in `sources`. */
const templateFee = z.object({
  label: z.string(),
  basis: z.enum(FEE_BASES),
  mode: z.enum(["amount", "rate"]).optional(),
  /** An amount or a percentage, written with a dot. */
  value: z.string().optional(),
  period: z.enum(FEE_PERIODS).optional(),
  scope: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  note: z.string().optional(),
});

/** What the form that creates a fund starts from: the templates, and the components other funds take. */
export const fundSetup = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sources: z.array(templateSource).optional(),
      fees: z.array(templateFee).optional(),
    }),
  ),
  taken: z.array(z.object({ component: z.enum(PAYROLL_COMPONENTS), fund: z.string() })),
});

/** The movements a contribution or a recurring debit can be tied to: the last 60 out, newest first. */
export const movementCandidates = z.object({
  movements: z.array(z.object({ id: id(), on: civilDate(), payee: z.string().nullable(), amount: money() })),
});
