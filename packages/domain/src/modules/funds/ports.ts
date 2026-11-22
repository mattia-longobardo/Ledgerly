// The port of funds (audit FND-11; 10-modularity.md §10.3): what a fund's detail reads of the
// payslips — the codes behind each pension role and the document a payslip came from — declared here
// and realised by payroll. The application wires it once per process (`wireDomain` in `apps/api`):
// a port that is not wired fails loudly. This module never imports payroll.
import type { Ctx } from "../../platform/context";

/** The payslips, as a fund's detail reads them. */
interface PayslipDirectory {
  /** The code map: each body code with the role it has. */
  codeRoles(ctx: Pick<Ctx, "userId" | "addons">): Promise<{ code: string; role: string }[]>;
  /** Each payslip's id → the document its review page is served from. */
  payslipDocuments(ctx: Pick<Ctx, "userId" | "addons">): Promise<Map<string, string>>;
}

declare global {
  var ledgerlyPayslipDirectory: PayslipDirectory | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireFunds(ports: { payslips: PayslipDirectory }): void {
  globalThis.ledgerlyPayslipDirectory = ports.payslips;
}

export function payslipDirectory(): PayslipDirectory {
  const wired = globalThis.ledgerlyPayslipDirectory;
  if (!wired) throw new Error("funds: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}
