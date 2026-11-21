// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { FIELDS, isFieldName, llmFillable } from "./fields";
export { fillWithLlm } from "./llm";
export { payrollDirectory, payrollLeaveBalances } from "./adapters";
export { appliedPayslips } from "./applied";
export { wirePayroll } from "./events";
export { codeMapView, registerView, reviewView } from "./queries";
export { PayrollError, applyPayslip, codeMapOf, decideField, deletePayslip, processPayslip, rejectPayslip, renamePayslip, reopenPayslip, resetCode, retryPayslip, setCodeRole, uploadPayslip, verifyPayslip } from "./service";
