// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { FIELDS, FIELD_GROUPS, FIELD_NAMES, effectiveValue, isDerived, isFieldName, llmFillable } from "./fields";
export type { FieldGroup, FieldName } from "./fields";
export { fillWithLlm } from "./llm";
export { appliedCompetences } from "./pension";
export { codeMapView, registerView, reviewView } from "./queries";
export type { RegisterRow, YearSummary } from "./queries";
export { CODE_ROLES, REPLY_TEAMSYSTEM_CODES, SUMMED_FIELDS } from "./rules";
export type { PayslipType, SummedField } from "./rules";
export { PayrollError, applyPayslip, codeMapOf, decideField, deletePayslip, processPayslip, rejectPayslip, renamePayslip, reopenPayslip, resetCode, retryPayslip, setCodeRole, uploadPayslip, verifyPayslip } from "./service";
