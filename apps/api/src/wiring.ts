// The wiring of the domain's ports (10-modularity.md §10.3: «il collegamento è in apps/api e
// apps/worker»): a port is declared by the module that uses it and realised by the module above it,
// and only an application knows both. Every process calls it once, before any request, job or
// test: the web server (`instrumentation.ts`), the worker, the test projects and the scripts.
import { wireAccounts } from "@ledgerly/domain/accounts";
import { payrollSource, valuationAccountIds, wireFunds } from "@ledgerly/domain/funds";
import { wireInterests } from "@ledgerly/domain/interests";
import { managedAccountsOfInvestments, wireInvestments } from "@ledgerly/domain/investments";
import { ledgerPosting } from "@ledgerly/domain/platform/integrations/source";
import { leaveCalendar } from "@ledgerly/domain/platform/integrations/calendar";
import { payrollDirectory, payrollLeaveBalances, wirePayroll } from "@ledgerly/domain/payroll";
import { wireTimeoff } from "@ledgerly/domain/timeoff";
import { addonOn } from "@ledgerly/domain/platform/context";
import { movementsOfAccounts } from "@ledgerly/domain/transactions";

// Without Payroll (H52, PA12) time off and funds stay on, without what the payslips gave them: time off
// has no balances from the payslips, a fund's detail no codes or documents of a payslip.
const leaveBalances: NonNullable<Parameters<typeof wireTimeoff>[0]["balances"]> = {
  snapshotHistory: async (ctx) => (addonOn(ctx, "payroll") ? payrollLeaveBalances.snapshotHistory(ctx) : []),
  eventsOf: async (ctx, year) => (addonOn(ctx, "payroll") ? payrollLeaveBalances.eventsOf(ctx, year) : []),
};
const payslips: Parameters<typeof wireFunds>[0]["payslips"] = {
  codeRoles: async (ctx) => (addonOn(ctx, "payroll") ? payrollDirectory.codeRoles(ctx) : []),
  payslipDocuments: async (ctx) =>
    addonOn(ctx, "payroll") ? payrollDirectory.payslipDocuments(ctx) : new Map(),
};

export function wireDomain(): void {
  wireAccounts({ movements: movementsOfAccounts, managed: managedAccountsOfInvestments });
  wireInterests({ posting: ledgerPosting });
  wireTimeoff({ calendar: leaveCalendar, balances: leaveBalances });
  wirePayroll({ listeners: [payrollSource] });
  wireFunds({ payslips });
  wireInvestments({ funds: { accountIds: valuationAccountIds } });
}
