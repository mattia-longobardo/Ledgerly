// What payroll realises for the ports of other modules (audit FND-11, PAY-6; 10-modularity.md
// §10.3): the payslips a fund's detail reads, and the leave balances time off reads. Payroll does not
// import those modules: the application wires these adapters to their ports (`wireDomain`).
import type { Ctx } from "../../platform/context";
import { PAYSLIP_PROFILES } from "./rules";
import { listCodeMap } from "./service/codes";
import { leaveEventsOf, leaveSnapshotHistory } from "./service/leave";
import { payslipsOf } from "./service/review";

/** The adapter of `PayslipDirectory` (funds): the code map's roles and each payslip's document. */
export const payrollDirectory = {
  async codeRoles(ctx: Pick<Ctx, "userId">) {
    return (await listCodeMap(ctx)).map((entry) => ({ code: entry.code, role: entry.role }));
  },
  async payslipDocuments(ctx: Pick<Ctx, "userId">) {
    return new Map((await payslipsOf(ctx)).flatMap((payslip) => (payslip.documentId ? [[payslip.id, payslip.documentId]] : [])));
  },
};

/**
 * The balance a use of leave counts against, when it is not its own (F5): as the profiles say
 * (`countsAgainst` of a balance).
 */
const COUNTS_AGAINST: ReadonlyMap<string, string> = new Map(
  PAYSLIP_PROFILES.flatMap((profile) => profile.balances).flatMap((balance) =>
    balance.countsAgainst ? [[balance.kind, balance.countsAgainst]] : [],
  ),
);

/** The adapter of `LeaveBalanceSource` (time off): the balances and the leave the payslips printed. */
export const payrollLeaveBalances = {
  snapshotHistory: leaveSnapshotHistory,
  async eventsOf(ctx: Pick<Ctx, "userId">, year: number) {
    return (await leaveEventsOf(ctx, year)).map((event) => ({
      ...event,
      balance: COUNTS_AGAINST.get(event.kind) ?? event.kind,
    }));
  },
};
