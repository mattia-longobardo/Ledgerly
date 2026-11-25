// The events of payroll (audit PAY-5, FND-11; 10-modularity.md §10.3, E2): what an applied payslip
// hands whoever listens, and its withdrawal. Payroll emits the payslip's amounts by role and its body
// lines with their roles; it never knows who listens, nor what a fund makes of them (quarter, fund,
// writing). The application wires the listeners once per process (`wireDomain` in `apps/api`).
import type { Ctx } from "../../platform/context";
import type { Tx } from "../../platform/db/client";
import type { Cents } from "../../shared/money";
import type { CodeRole, PayslipKind } from "./rules";

/** `PayslipApplied`: a payslip entered the register, with what it carries for a pension fund. */
export interface PayslipApplied {
  payslipId: string;
  year: number;
  /** The month paid (1st of the month); null for a 13th. */
  period: string | null;
  kind: PayslipKind;
  /** The employer's extra payment it is (1 is a 13th), for `extra` only. */
  extraNumber: number | null;
  printedOn: string | null;
  /** The worker's effective quota (7101 + 8054, signs kept). */
  workerCents: Cents | null;
  /** The employer's printed quota (9109) only. */
  employerCents: Cents | null;
  /** The TFR contribution line (8003) only. */
  tfrCents: Cents | null;
  workerEnrollmentCents: Cents | null;
  employerEnrollmentCents: Cents | null;
  workerAdjustmentCents: Cents | null;
  employerAdjustmentCents: Cents | null;
  /** Every body line, by its id, with the role the code map gives it. */
  lines: { id: string; role: CodeRole }[];
}

/**
 * A listener of payroll's events. It runs inside payroll's transaction (`tx`): applying, reopening
 * and deleting stay one atomic step, as they were before the event.
 */
interface PayslipListener {
  applied(ctx: Pick<Ctx, "userId">, event: PayslipApplied, transaction: Tx): Promise<void>;
  /** `PayslipWithdrawn`: the payslip left the register (superseded, reopened or deleted). */
  withdrawn(ctx: Pick<Ctx, "userId">, payslipId: string, transaction: Tx): Promise<void>;
}

// On `globalThis`, as the pool of the database: one process may load this file in more than one
// bundle (Next.js), and the wiring of one must be seen by the others.
declare global {
  var ledgerlyPayslipListeners: readonly PayslipListener[] | undefined;
}

/** Wires the listeners; the application calls it once per process, before any request or job. */
export function wirePayroll(ports: { listeners: readonly PayslipListener[] }): void {
  globalThis.ledgerlyPayslipListeners = ports.listeners;
}

function listeners(): readonly PayslipListener[] {
  const wired = globalThis.ledgerlyPayslipListeners;
  if (!wired) throw new Error("payroll: the listeners are not wired (wireDomain of @ledgerly/api)");
  return wired;
}

export async function payslipApplied(ctx: Pick<Ctx, "userId">, event: PayslipApplied, transaction: Tx): Promise<void> {
  for (const listener of listeners()) await listener.applied(ctx, event, transaction);
}

export async function payslipWithdrawn(ctx: Pick<Ctx, "userId">, payslipId: string, transaction: Tx): Promise<void> {
  for (const listener of listeners()) await listener.withdrawn(ctx, payslipId, transaction);
}
