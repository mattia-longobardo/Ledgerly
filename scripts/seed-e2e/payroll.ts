// scripts/seed-e2e/payroll.ts — the data of the payslips typed by hand (R5g, tests/e2e/payroll/).
import { createManualPayslip } from "@domain/modules/payroll";
import { today } from "@domain/shared/dates";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf } from "./common";

/** One ordinary payslip of last month, typed by hand, with invented amounts and no document. */
export async function seedPayrollHand(): Promise<void> {
  const ctx = await contextOf(USERS.payrollHand.email);
  const [year, month] = today(ctx.timeZone).split("-").map(Number);
  const last = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  await createManualPayslip(ctx, {
    kind: "ordinary",
    ...last,
    extraNumber: null,
    paidOn: null,
    gross: 250000n,
    taxes: 50000n,
    contributions: 23000n,
    net: 177000n,
    fields: {},
    documentId: null,
  });
}
