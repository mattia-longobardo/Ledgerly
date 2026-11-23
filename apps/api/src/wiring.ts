// The wiring of the domain's ports (10-modularity.md §10.3: «il collegamento è in apps/api e
// apps/worker»): a port is declared by the module that uses it and realised by the module above it,
// and only an application knows both. Every process calls it once, before any request, job or
// test: the web server (`instrumentation.ts`), the worker, the test projects and the scripts.
import { wireAccounts } from "@ledgerly/domain/accounts";
import { payrollSource, valuationAccountIds, wireFunds } from "@ledgerly/domain/funds";
import { managedAccountsOfInvestments, wireInvestments } from "@ledgerly/domain/investments";
import {
  closesUpTo,
  FALLBACK_MIC,
  instrumentById,
  isStale,
  lastCloses,
  listingsOf,
  marketKey,
} from "@ledgerly/domain/instruments";
import { wireSource } from "@ledgerly/domain/platform/integrations/source";
import { leaveCalendar, wireCalendar } from "@ledgerly/domain/platform/integrations/calendar";
import { payrollDirectory, payrollLeaveBalances, wirePayroll } from "@ledgerly/domain/payroll";
import { wireTimeoff } from "@ledgerly/domain/timeoff";
import { wireAuth } from "@ledgerly/domain/platform/auth";
import { startOnboarding } from "@ledgerly/domain/users";
import { addonOn } from "@ledgerly/domain/platform/context";
import { movementsOfAccounts } from "@ledgerly/domain/transactions";
import { openCalendar, openSource } from "@ledgerly/plugin-host";

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
  wireAuth({ userCreated: startOnboarding });
  wireAccounts({ movements: movementsOfAccounts, managed: managedAccountsOfInvestments });
  wireSource({ open: openSource });
  wireCalendar({ open: openCalendar });
  wireTimeoff({ calendar: leaveCalendar, balances: leaveBalances });
  wirePayroll({ listeners: [payrollSource] });
  wireFunds({ payslips });
  wireInvestments({
    funds: { accountIds: valuationAccountIds },
    prices: {
      fallbackMic: FALLBACK_MIC,
      instrumentById,
      listingsOf,
      marketKey,
      closesUpTo,
      lastCloses,
      isStale,
    },
  });
}
