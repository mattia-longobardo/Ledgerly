import { PAYSLIP_FIELDS, type PayslipExtraction, type PayslipField } from "@/lib/contracts";
import type { NewPayrollComponent, PayrollMappingRule } from "../application/ports";
import { classifyComponent } from "./mapping";

/**
 * The Italian text each parser field corresponds to on the employer's payslip.
 * This is *data*, per spec §2.9: it is what the document says, not UI chrome,
 * and it is what a reviewer compares against the page they are looking at.
 */
const LABELS: Record<PayslipField, string> = {
  gross: "Totale competenze",
  net: "Netto del mese",
  taxes: "Totale trattenute",
  fundContribEmployee: "Contributo Cometa dipendente",
  fundContribEmployer: "Contributo Cometa azienda",
  ferieBalance: "Ferie residue",
  rolBalance: "ROL residue",
  permessiBalance: "Permessi residui",
  ferieTakenHours: "Ferie godute",
  rolTakenHours: "ROL godute",
};

/** Fields the payslip states in hours rather than euro. */
const HOUR_FIELDS = new Set<PayslipField>([
  "ferieBalance", "rolBalance", "permessiBalance", "ferieTakenHours", "rolTakenHours",
]);

/**
 * The single, named place where the existing parser's `number` crosses into
 * this module's decimal strings (see the money global constraint).
 *
 * `PayslipExtraction.fields[f].value` is `number | null` — that type predates
 * this phase and is not being changed, because widening it would touch every
 * test under `src/lib/payroll/`. `toFixed` is exact for the magnitudes a
 * payslip carries (well under 2^53 cents), and nothing downstream ever converts
 * back: the string is what reaches Postgres.
 */
function toDecimal(value: number, scale: number): string {
  return value.toFixed(scale);
}

/**
 * One component per field the parser actually read, in `PAYSLIP_FIELDS` order
 * so `sort_order` is stable across re-applies and two reviewers see the same
 * list in the same order.
 *
 * A field whose `value` is null is **skipped entirely** rather than written as
 * `0.00` — the "never invent financial data" rule at its sharpest: a zero
 * component would flow straight into `grossOf`, into Earnings and into the
 * fund bridge as a real, wrong figure.
 */
export function componentsFromExtraction(
  extraction: PayslipExtraction,
  rules: readonly PayrollMappingRule[],
): NewPayrollComponent[] {
  const out: NewPayrollComponent[] = [];
  for (const field of PAYSLIP_FIELDS) {
    const extracted = extraction.fields[field];
    if (!extracted || extracted.value === null) continue;
    const labelRaw = LABELS[field];
    const { kind, target } = classifyComponent(rules, field, labelRaw);
    const isHours = HOUR_FIELDS.has(field);
    out.push({
      // `recordId` is filled by the repository's `replaceForRecord`, which owns
      // the record this batch belongs to; the domain does not know it.
      recordId: "",
      code: field,
      labelRaw,
      kind,
      amount: isHours ? null : toDecimal(extracted.value, 2),
      quantity: isHours ? toDecimal(extracted.value, 6) : null,
      unit: isHours ? "hours" : "eur",
      currency: "EUR",
      confidence: extracted.confidence,
      // Which pass produced the accepted value. `rules` when the deterministic
      // pass had it (the common case and the one that survives a layout
      // change); `llm` only when the LLM was the sole source.
      source: extracted.rules !== null ? "rules" : "llm",
      mappedTo: target,
      sortOrder: out.length,
    });
  }
  return out;
}

function amountOf(components: readonly NewPayrollComponent[], code: PayslipField): string | null {
  return components.find((c) => c.code === code)?.amount ?? null;
}

/** The record's headline gross, straight off the components — never recomputed by summing. */
export function grossOf(components: readonly NewPayrollComponent[]): string | null {
  return amountOf(components, "gross");
}

/** The record's headline net. Null when absent, so the record stores null and the UI renders "—". */
export function netOf(components: readonly NewPayrollComponent[]): string | null {
  return amountOf(components, "net");
}
