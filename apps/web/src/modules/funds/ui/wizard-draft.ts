// What "Add pension fund" holds while it is typed (screens §3), and the checks of its first step.
import { parseAmount } from "@ledgerly/format/format";
import { type CivilDate, isCivilDate } from "@ledgerly/domain/shared/dates";
import type { NumberFormat } from "@ledgerly/format/format";
import {
  applyTemplate,
  type FeeForm,
  type FundForm,
  type FundTemplate,
  newSourceForm,
  parseScope,
  type SourceForm,
  type SourceKind,
  type WizardForm,
} from "@ledgerly/domain/funds/client";
import { cleanSource, freeComponents, type TakenComponents } from "./source-text";

export const WIZARD_STEPS = ["fund", "sources", "fees", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export type FundField = "name" | "startOn" | "value" | "valueOn";

/** The message of a field of step 1, by its key under `funds.wizard.errors`. */
type FundProblem = "name" | "memberSince" | "future" | "value" | "valueOn" | "valueBeforeStart";

/** What the four steps hold. A fee names a source by its kind here: its place is only known at the end. */
export interface Draft {
  fund: FundForm;
  value: string;
  valueOn: string;
  currency: string;
  templateId: string;
  on: Record<SourceKind, boolean>;
  payroll: SourceForm;
  debit: SourceForm;
  fees: FeeForm[];
}

/** The rows of a template as the draft keeps them: `#<index>` becomes the kind of that source. */
export function templateRows(template: FundTemplate | undefined, taken: TakenComponents, decimal: string) {
  const { sources, fees } = template ? applyTemplate(template, decimal) : { sources: [], fees: [] };
  const free = freeComponents(taken);
  const payroll = sources.find((source) => source.kind === "payroll");
  return {
    on: {
      payroll: payroll !== undefined,
      bank_debit: sources.some((source) => source.kind === "bank_debit"),
      manual: sources.some((source) => source.kind === "manual"),
    },
    payroll: payroll
      ? { ...payroll, components: payroll.components.filter((component) => free.includes(component)) }
      : { ...newSourceForm("payroll"), components: free },
    debit: sources.find((source) => source.kind === "bank_debit") ?? newSourceForm("bank_debit"),
    fees: fees.map((fee) => {
      const { key, component } = parseScope(fee.scope);
      const kind = key === null ? undefined : sources[Number(key.slice(1))]?.kind;
      return { ...fee, scope: kind === undefined ? "" : component === null ? kind : `${kind}:${component}` };
    }),
  };
}

/** The value of step 1 and its date, when a value is written. */
function valueProblems(draft: Draft, todayOn: CivilDate, format: NumberFormat) {
  const problems: Partial<Record<FundField, FundProblem>> = {};
  try {
    if (parseAmount(draft.value, format) < 0n) problems.value = "value";
  } catch {
    problems.value = "value";
  }
  if (!isCivilDate(draft.valueOn)) problems.valueOn = "valueOn";
  else if (draft.valueOn > todayOn) problems.valueOn = "future";
  else if (draft.fund.startOn !== "" && draft.valueOn < draft.fund.startOn) {
    problems.valueOn = "valueBeforeStart";
  }
  return problems;
}

/** What is wrong in step 1, by field. */
export function fundProblems(
  draft: Draft,
  todayOn: CivilDate,
  format: NumberFormat,
): Partial<Record<FundField, FundProblem>> {
  const problems: Partial<Record<FundField, FundProblem>> = {};
  if (draft.fund.name.trim() === "") problems.name = "name";
  // A date half typed ("0002-03-01", the year's first digit) is no date yet.
  if (!isCivilDate(draft.fund.startOn)) problems.startOn = "memberSince";
  else if (draft.fund.startOn > todayOn) problems.startOn = "future";
  return draft.value.trim() === "" ? problems : { ...problems, ...valueProblems(draft, todayOn, format) };
}

/** The form as the action takes it: the sources switched on, a fee's source as `#<index>`. */
export function wizardFormOf(draft: Draft, sourceOn: (kind: SourceKind) => boolean): WizardForm {
  const sources = [
    sourceOn("payroll") ? cleanSource(draft.payroll) : null,
    sourceOn("bank_debit") ? cleanSource(draft.debit) : null,
    sourceOn("manual") ? newSourceForm("manual") : null,
  ].filter((source) => source !== null);
  return {
    fund: draft.fund,
    value: draft.value,
    valueOn: draft.valueOn,
    currency: draft.currency,
    sources,
    fees: draft.fees.map((fee) => {
      const { key, component } = parseScope(fee.scope);
      const index = sources.findIndex((source) => source.kind === key);
      const scope = index === -1 ? "" : component === null ? `#${index}` : `#${index}:${component}`;
      return { ...fee, scope };
    }),
  };
}
