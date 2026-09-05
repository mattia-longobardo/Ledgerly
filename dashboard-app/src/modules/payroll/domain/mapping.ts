import type { MappingTarget, PayrollComponentKind, PayrollMappingRule } from "../application/ports";

type RuleShape = Omit<PayrollMappingRule, "id" | "userId">;

/**
 * The global catalogue (spec §5.8), keyed on the *parser's* own field codes
 * (`PAYSLIP_FIELDS` in `src/lib/contracts.ts`) rather than on payslip label
 * text, because the codes are stable and the Italian labels are not.
 *
 * Ruling R4-10: every target listed here is recorded on the component, but only
 * `fund_contribution` has a consumer in Phase 4. `timeoff_balance` and
 * `timeoff_used` wait for Phase 7's `timeoff_balances` table; the rows exist
 * from day one so that phase needs no backfill.
 *
 * `permessiBalance` deliberately has no rule: the parser can read it, but the
 * Work page's own comment already records that permessi are excluded from the
 * headline, and inventing a `timeoff_code` for it here would put a number in
 * Phase 7's balances that nobody has agreed on.
 */
export const DEFAULT_MAPPING_RULES: readonly RuleShape[] = [
  { matchCode: "gross", matchLabel: null, componentKind: "earning", target: { kind: "earnings" }, priority: 100 },
  { matchCode: "net", matchLabel: null, componentKind: "earning", target: { kind: "earnings" }, priority: 100 },
  { matchCode: "taxes", matchLabel: null, componentKind: "tax", target: { kind: "earnings" }, priority: 100 },
  {
    matchCode: "fundContribEmployee", matchLabel: null, componentKind: "employee_contribution",
    target: { kind: "fund_contribution", fundSlug: "cometa", part: "employee" }, priority: 100,
  },
  {
    matchCode: "fundContribEmployer", matchLabel: null, componentKind: "employer_contribution",
    target: { kind: "fund_contribution", fundSlug: "cometa", part: "employer" }, priority: 100,
  },
  {
    matchCode: "ferieBalance", matchLabel: null, componentKind: "leave_balance",
    target: { kind: "timeoff_balance", timeoffCode: "vacation" }, priority: 100,
  },
  {
    matchCode: "rolBalance", matchLabel: null, componentKind: "leave_balance",
    target: { kind: "timeoff_balance", timeoffCode: "permits" }, priority: 100,
  },
  {
    matchCode: "ferieTakenHours", matchLabel: null, componentKind: "leave_used",
    target: { kind: "timeoff_used", timeoffCode: "vacation" }, priority: 100,
  },
  {
    matchCode: "rolTakenHours", matchLabel: null, componentKind: "leave_used",
    target: { kind: "timeoff_used", timeoffCode: "permits" }, priority: 100,
  },
];

function matches(rule: PayrollMappingRule, code: string, labelRaw: string): boolean {
  if (rule.matchCode !== null && rule.matchCode === code) return true;
  if (rule.matchLabel === null) return false;
  try {
    return new RegExp(rule.matchLabel, "i").test(labelRaw);
  } catch {
    // A user-authored regex is untrusted input. A bad one must skip its own
    // rule, never take down the classification of every component on the
    // payslip — which is what an uncaught SyntaxError here would do.
    return false;
  }
}

/**
 * Resolves one component against the rule set. Rules are considered in
 * `priority asc, id asc` order — the same order `PayrollMappingRulesRepository.
 * listFor` returns them in, so the caller never has to sort. The fallback is
 * deliberately inert (`info` / `none`): a component nobody has a rule for is
 * still recorded and still shown, it simply feeds nothing.
 */
export function classifyComponent(
  rules: readonly PayrollMappingRule[],
  code: string,
  labelRaw: string,
): { kind: PayrollComponentKind; target: MappingTarget } {
  const sorted = [...rules].sort((a, b) => (a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority));
  for (const rule of sorted) {
    if (matches(rule, code, labelRaw)) return { kind: rule.componentKind, target: rule.target };
  }
  return { kind: "info", target: { kind: "none" } };
}
