// The fund templates (release N6, screens §3.2): a data file, so that adding one is not a change of
// the code. The file ships empty: with no template the form that creates a fund has no "Template"
// field at all. A template's name is data, never a message of the interface.
import { type FeeForm, newFeeForm, newSourceForm, parseScope, type SourceForm } from "./forms";
import { SOURCE_KINDS, type SourceKind } from "./sources";
import data from "./templates.json";

/** A source of a template: its kind, and the fields that differ from a new source's. */
export type TemplateSource = Partial<Omit<SourceForm, "id" | "kind" | "state" | "customDue">> & {
  kind: SourceKind;
};

/** A fee of a template. Its `scope` names a source by `#<index>` in the template's own `sources`. */
export type TemplateFee = Partial<Omit<FeeForm, "id">> & Pick<FeeForm, "label" | "basis">;

export interface FundTemplate {
  id: string;
  name: string;
  sources?: TemplateSource[];
  fees?: TemplateFee[];
}

export const FUND_TEMPLATES: readonly FundTemplate[] = data as readonly FundTemplate[];

/**
 * The rows steps 2 and 3 start from. The sources come in the order of the form — payslip, debit, by
 * hand — and one per kind, as the form holds them; a fee's scope follows its source to the new
 * place, and a fee of a source that is not there applies to everything.
 */
export function applyTemplate(template: FundTemplate): { sources: SourceForm[]; fees: FeeForm[] } {
  const given = template.sources ?? [];
  const sources: SourceForm[] = [];
  const placeOf = new Map<number, number>();
  for (const kind of SOURCE_KINDS) {
    const index = given.findIndex((row) => row.kind === kind);
    if (index === -1) continue;
    placeOf.set(index, sources.length);
    sources.push({ ...newSourceForm(kind), ...given[index], id: null, state: "active", customDue: false });
  }
  const fees = (template.fees ?? []).map((row): FeeForm => {
    const { key, component } = parseScope(row.scope ?? "");
    const place = key === null ? undefined : placeOf.get(Number(key.slice(1)));
    const scope = place === undefined ? "" : component === null ? `#${place}` : `#${place}:${component}`;
    return { ...newFeeForm(), ...row, id: null, scope };
  });
  return { sources, fees };
}
