// Payroll, the entry of the Payroll pages (rule M3): the register and its sections, one payslip's
// review, the code map, and the calls they write through.
export * from "./calls";
export { AddPayslips } from "./ui/add-payslips";
export { usePayrollFormat } from "./ui/format";
export { type Format, type Register, type Review, registerGroups } from "./ui/present";
export { RegisterTable } from "./ui/register-table";
export { PayrollTabs, RegisterHeader, RegisterInbox, RegisterKpis } from "./ui/register-sections";
export { ReviewActions } from "./ui/review-actions";
export { ReviewBody } from "./ui/review-sections";
