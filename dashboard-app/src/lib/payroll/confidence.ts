/**
 * Cross-validation of the two extraction passes, plus the cross-field sanity
 * checks that demote confidence (PLAN §4).
 *
 *   high   = rules and LLM agree (money within ±0,01)
 *   medium = only one source produced a value
 *   low    = the two disagree, or both are null
 *
 * Demotions on top of that: OCR-only column association, a grid the engine
 * refused to associate, and any failing sanity check.
 */

import type { Confidence, FieldExtraction, PayslipField, SanityCheck } from "@/lib/contracts";
import { PAYSLIP_FIELDS } from "@/lib/contracts";
import { GRID_DEPENDENT_FIELDS, type AuxField } from "@/lib/payroll/anchors";
import type { RulesResult } from "@/lib/payroll/rules";
import type { TextSource } from "@/lib/payroll/text";

/** Money agreement tolerance, in euro. Hours use the same absolute epsilon. */
export const MONEY_TOLERANCE = 0.01;
/** `netto ≈ competenze − ritenute` slack, in euro. */
export const BALANCE_TOLERANCE = 1;
/** Trailing-median band for the net-pay plausibility check. */
export const MEDIAN_BAND = 0.4;
/** Most hours a single month can plausibly accrue (ferie + rol are ~13 h/month). */
export const MAX_MONTHLY_ACCRUAL_HOURS = 24;
/** Minimum history points before the median check is meaningful. */
export const MIN_MEDIAN_HISTORY = 3;
export const MEDIAN_WINDOW = 6;

export interface PayslipHistoryEntry {
  readonly month: string;
  readonly isThirteenth?: boolean;
  readonly net?: number | null;
  readonly gross?: number | null;
  readonly taxes?: number | null;
  readonly ferieBalance?: number | null;
  readonly rolBalance?: number | null;
  readonly permessiBalance?: number | null;
  readonly ferieTakenHours?: number | null;
}

const NUM2 = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function eur(n: number): string {
  return `€${NUM2.format(n)}`;
}

function hours(n: number): string {
  return `${NUM2.format(n)} h`;
}

export function demote(confidence: Confidence): Confidence {
  return confidence === "high" ? "medium" : "low";
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) return null;
  return (lo + hi) / 2;
}

export function combineField(
  rules: number | null,
  llm: number | null,
  tolerance = MONEY_TOLERANCE,
): FieldExtraction<number | null> {
  if (rules !== null && llm !== null) {
    const agree = Math.abs(rules - llm) <= tolerance;
    return {
      // The deterministic pass wins the tie-break: the UI shows both candidates.
      value: rules,
      confidence: agree ? "high" : "low",
      rules,
      llm,
      ...(agree ? {} : { note: `rules ${NUM2.format(rules)} vs LLM ${NUM2.format(llm)}` }),
    };
  }
  if (rules !== null) return { value: rules, confidence: "medium", rules, llm: null };
  if (llm !== null) return { value: llm, confidence: "medium", rules: null, llm };
  return { value: null, confidence: "low", rules: null, llm: null };
}

function withNote(
  field: FieldExtraction<number | null>,
  note: string,
): FieldExtraction<number | null> {
  return { ...field, note: field.note ? `${field.note}; ${note}` : note };
}

export interface CrossValidateInput {
  readonly rules: RulesResult;
  readonly llmFields: Partial<Record<PayslipField, number | null>>;
  readonly textSource: TextSource;
  readonly isThirteenth: boolean;
  readonly month: string | null;
  readonly history: readonly PayslipHistoryEntry[];
}

export interface CrossValidateResult {
  readonly fields: Partial<Record<PayslipField, FieldExtraction<number | null>>>;
  readonly checks: readonly SanityCheck[];
}

function priorEntry(
  history: readonly PayslipHistoryEntry[],
  month: string | null,
): PayslipHistoryEntry | null {
  const ordinary = history
    .filter((h) => !h.isThirteenth)
    .filter((h) => (month ? h.month < month : true))
    .sort((a, b) => a.month.localeCompare(b.month));
  return ordinary[ordinary.length - 1] ?? null;
}

function checkNettoBalance(
  aux: Partial<Record<AuxField, number | null>>,
  net: number | null,
): SanityCheck | null {
  const competenze = aux.totaleCompetenze ?? null;
  const ritenute = aux.totaleRitenute ?? null;
  if (competenze === null || ritenute === null || net === null) return null;
  const off = competenze - ritenute - net;
  const passed = Math.abs(off) <= BALANCE_TOLERANCE;
  return {
    id: "netto_vs_competenze",
    label: "netto = competenze − ritenute",
    passed,
    detail: passed
      ? `netto + ritenute = competenze (${eur(competenze)})`
      : `netto + ritenute ≠ competenze, off by ${eur(Math.abs(off))}`,
  };
}

function checkResidualContinuity(
  fields: Partial<Record<PayslipField, FieldExtraction<number | null>>>,
  prior: PayslipHistoryEntry | null,
): { check: SanityCheck; affected: PayslipField[] } | null {
  if (!prior) return null;
  const pairs: ReadonlyArray<[PayslipField, number | null | undefined, string]> = [
    ["ferieBalance", prior.ferieBalance, "ferie"],
    ["rolBalance", prior.rolBalance, "ROL"],
  ];
  const problems: string[] = [];
  const affected: PayslipField[] = [];
  let comparable = false;

  for (const [field, priorValue, label] of pairs) {
    const current = fields[field]?.value ?? null;
    if (current === null || priorValue === null || priorValue === undefined) continue;
    comparable = true;
    const taken = field === "ferieBalance" ? (fields.ferieTakenHours?.value ?? null) : null;
    if (current > priorValue + MAX_MONTHLY_ACCRUAL_HOURS) {
      problems.push(
        `${label} residual ${hours(current)} vs ${hours(priorValue)} last month — more than ${hours(MAX_MONTHLY_ACCRUAL_HOURS)} of accrual`,
      );
      affected.push(field);
    } else if (taken !== null && current < priorValue - taken - 0.5) {
      problems.push(
        `${label} residual ${hours(current)} vs ${hours(priorValue)} last month, but only ${hours(taken)} were used`,
      );
      affected.push(field);
    }
  }
  if (!comparable) return null;
  return {
    check: {
      id: "residual_continuity",
      label: "ferie/ROL residuals continue from last month",
      passed: problems.length === 0,
      detail:
        problems.length === 0
          ? `residuals line up with ${prior.month}`
          : problems.join("; "),
    },
    affected,
  };
}

function checkNetAgainstMedian(
  net: number | null,
  history: readonly PayslipHistoryEntry[],
  month: string | null,
  isThirteenth: boolean,
): SanityCheck | null {
  // A tredicesima is ~2x an ordinary month by design — the band would always fail.
  if (isThirteenth || net === null) return null;
  const nets = history
    .filter((h) => !h.isThirteenth && (month ? h.month < month : true))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-MEDIAN_WINDOW)
    .map((h) => h.net ?? null)
    .filter((v): v is number => v !== null);
  if (nets.length < MIN_MEDIAN_HISTORY) return null;
  const med = median(nets);
  if (med === null || med === 0) return null;
  const drift = (net - med) / med;
  const passed = Math.abs(drift) <= MEDIAN_BAND;
  return {
    id: "net_vs_median",
    label: `net within ±${NUM0.format(MEDIAN_BAND * 100)} % of the ${nets.length}-month median`,
    passed,
    detail: passed
      ? `net ${eur(net)} vs median ${eur(med)}`
      : `net ${eur(net)} is ${NUM0.format(Math.abs(drift) * 100)} % ${drift > 0 ? "above" : "below"} the ${nets.length}-month median ${eur(med)}`,
  };
}

/**
 * Combines both passes, applies the source/grid demotions, then runs the
 * cross-field checks and demotes whatever they implicate.
 */
export function crossValidate(input: CrossValidateInput): CrossValidateResult {
  const fields: Partial<Record<PayslipField, FieldExtraction<number | null>>> = {};

  for (const field of PAYSLIP_FIELDS) {
    const rulesValue = input.rules.fields[field] ?? null;
    const llmValue = input.llmFields[field] ?? null;
    let extraction = combineField(rulesValue, llmValue);

    const provenance = input.rules.provenance[field];
    if (provenance?.degraded && rulesValue === null) {
      extraction = withNote(
        { ...extraction, confidence: demote(extraction.confidence) },
        provenance.note ?? "rules pass refused to associate a column",
      );
    }
    if (input.textSource === "ocr" && GRID_DEPENDENT_FIELDS.includes(field)) {
      extraction = withNote(
        { ...extraction, confidence: demote(extraction.confidence) },
        "column association from OCR text only",
      );
    }
    fields[field] = extraction;
  }

  const checks: SanityCheck[] = [];
  const demoted = new Set<PayslipField>();

  const balance = checkNettoBalance(input.rules.aux, fields.net?.value ?? null);
  if (balance) {
    checks.push(balance);
    if (!balance.passed) for (const f of ["net", "gross", "taxes"] as const) demoted.add(f);
  }

  const continuity = checkResidualContinuity(fields, priorEntry(input.history, input.month));
  if (continuity) {
    checks.push(continuity.check);
    if (!continuity.check.passed) for (const f of continuity.affected) demoted.add(f);
  }

  const medianCheck = checkNetAgainstMedian(
    fields.net?.value ?? null,
    input.history,
    input.month,
    input.isThirteenth,
  );
  if (medianCheck) {
    checks.push(medianCheck);
    if (!medianCheck.passed) demoted.add("net");
  }

  for (const field of demoted) {
    const current = fields[field];
    if (!current) continue;
    fields[field] = { ...current, confidence: demote(current.confidence) };
  }

  return { fields, checks };
}
