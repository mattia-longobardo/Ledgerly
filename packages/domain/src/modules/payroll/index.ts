// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { FIELDS, isFieldName, llmFillable } from "./fields";
export { fillWithLlm } from "./llm";
export { payrollDirectory, payrollLeaveBalances } from "./adapters";
export { appliedPayslips } from "./applied";
export { wirePayroll } from "./events";
export { codeMapView, payslipsAwaitingReview, registerAmount, registerView, reviewView } from "./queries";
export { PAYSLIP_DOCUMENT, PayrollError, applyPayslip, codeMapOf, decideField, deletePayslip, processPayslip, rejectPayslip, renamePayslip, reopenPayslip, resetCode, retryPayslip, setCodeRole, uploadPayslip, verifyPayslip } from "./service";
export { createManualPayslip, deleteManualPayslip, employerOf, manualPayslipView, saveEmployer, updateManualPayslip } from "./service";
export { COUNTRY_FIELDS, fieldCatalogue, kindOf } from "./rules";
