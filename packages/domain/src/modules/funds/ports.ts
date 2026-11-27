// The port of funds (audit FND-11; 10-modularity.md §10.3): what a fund's detail reads of the
// payslips — the codes behind each pension role and the document a payslip came from — declared here
// and realised by payroll. The application wires it once per process (`wireDomain` in `apps/api`):
// a port that is not wired fails loudly. This module never imports payroll.
import type { Ctx } from "../../platform/context";
import type { Tx } from "../../platform/db/client";
import type { WantedLeg, WrittenLegs } from "../../shared/cash-legs";

/** The payslips, as a fund's detail reads them. */
interface PayslipDirectory {
  /** The code map: each body code with the role it has. */
  codeRoles(ctx: Pick<Ctx, "userId" | "addons">): Promise<{ code: string; role: string }[]>;
  /** Each payslip's id → the document its review page is served from. */
  payslipDocuments(ctx: Pick<Ctx, "userId" | "addons">): Promise<Map<string, string>>;
}

/**
 * The account's legs of the voluntary contributions (PERS-651), as funds writes them: declared here and realised by
 * transactions, so this module never imports it. `writeLegs` runs in the caller's transaction,
 * `settleLegs` after it.
 */
interface CashLegs {
  writeLegs(
    tx: Tx,
    ctx: Pick<Ctx, "userId" | "timeZone">,
    account: { id: string; currency: string },
    wanted: readonly WantedLeg[],
  ): Promise<WrittenLegs>;
  settleLegs(
    ctx: Pick<Ctx, "userId" | "timeZone">,
    written: Pick<WrittenLegs, "touched" | "choices" | "twinAccounts">,
  ): Promise<void>;
}

declare global {
  var ledgerlyPayslipDirectory: PayslipDirectory | undefined;
  var ledgerlyFundLegs: CashLegs | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireFunds(ports: { payslips: PayslipDirectory; legs: CashLegs }): void {
  globalThis.ledgerlyPayslipDirectory = ports.payslips;
  globalThis.ledgerlyFundLegs = ports.legs;
}

export function payslipDirectory(): PayslipDirectory {
  const wired = globalThis.ledgerlyPayslipDirectory;
  if (!wired) throw new Error("funds: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}

export function fundLegs(): CashLegs {
  const wired = globalThis.ledgerlyFundLegs;
  if (!wired) throw new Error("funds: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}
