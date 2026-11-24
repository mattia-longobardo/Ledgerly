// Payroll, the entry of the Payroll pages (rule M3): the register and its sections, one payslip's
// review, the code map, and the calls they write through.
export * from "./calls";
export * from "./manual-calls";
export { AddManualPayslip } from "./ui/add-manual";
export { AddPayslips } from "./ui/add-payslips";
export { EmployerSection } from "./ui/employer-card";
export { KindBadge } from "./ui/labels";
export { ManualDialog, monthName } from "./ui/manual-dialog";
export { ManualView } from "./ui/manual-view";
export { usePayrollFormat } from "./ui/format";
export {
  type Catalogue,
  type Employer,
  type Format,
  kindBadge,
  type ManualPayslip,
  moneyOf,
  type Register,
  type Review,
  registerGroups,
} from "./ui/present";
export { RegisterTable } from "./ui/register-table";
export { PayrollTabs, RegisterHeader, RegisterInbox, RegisterKpis } from "./ui/register-sections";
export { ReviewActions } from "./ui/review-actions";
export { ReviewBody } from "./ui/review-sections";
