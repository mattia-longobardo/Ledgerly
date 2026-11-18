// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export { FIELDS, FIELD_GROUPS, FIELD_NAMES, effectiveValue, isDerived } from "./fields";
export type { FieldGroup, FieldName } from "./fields";
export type { RegisterRow, YearSummary } from "./queries";
export { CODE_ROLES, SUMMED_FIELDS } from "./rules";
export type { PayslipType, SummedField } from "./rules";
