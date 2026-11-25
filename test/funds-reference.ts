// The two test funds of the single model (rewrite plan, 10-modularity.md §10.10 test B3; 11-standardization.md
// §11.2.4 test SN5): one fund with a recurring debit, one fed by the payslip, every date written out.
// `packages/domain/src/modules/funds/reference.itest.ts` holds their figures to `baselines/numbers/funds.json`;
// the parity tests of R3 read the same funds through the routes. Changing them changes that file.
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import type { Ctx } from "@domain/platform/context";
import { pensionCompetences } from "@domain/modules/funds/schema";
import { addContribution, recordValuation } from "@domain/modules/funds/service";
import { addDeposit, debitFund, payrollFund } from "./funds";

/** Seeds the two funds for `ctx`, with the clock already at 2031-10-15. */
export async function seedFundsReference(ctx: Ctx): Promise<{ debitId: string; payslipId: string }> {
  // ——— In: a fund with a debit of 251,00 € a month, 1,00 € of fee each, a capital to open ———
  const debit = await debitFund(ctx, {
    name: "Fondo Beta",
    provider: "Esempio Previdenza",
    startOn: "2030-11-01",
    monthlyCents: 25_100n,
    debitDay: 5,
    depositFeeCents: 100n,
    ter: "0.012",
    initialCents: 500_000n,
  });
  for (const on of [
    "2030-12-05",
    ...["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((month) => `2031-${month}-05`),
  ]) {
    await addDeposit(ctx, debit.id, {
      on,
      chargedCents: 25_100n,
      feeCents: on === "2031-10-05" ? null : 100n,
      note: null,
    });
  }
  for (const [on, cents] of [
    ["2030-12-31", 528_000n],
    ["2031-03-31", 611_500n],
    ["2031-06-30", 702_300n],
    ["2031-09-30", 771_900n],
  ] as const) {
    await recordValuation(ctx, debit.id, { on, cents });
  }

  // ——— In: a fund fed by the payslip, by quarter, due on the 20th of the month after ———
  const payslip = await payrollFund(ctx, {
    name: "Fondo Alfa",
    provider: "Esempio Previdenza",
    compartment: "Bilanciata",
    startOn: "2030-10-01",
  });
  const months = [
    ["2030-10-01", 2030, 4],
    ["2030-11-01", 2030, 4],
    ["2030-12-01", 2030, 4],
    ["2031-01-01", 2031, 1],
    ["2031-02-01", 2031, 1],
    ["2031-03-01", 2031, 1],
    ["2031-04-01", 2031, 2],
    ["2031-05-01", 2031, 2],
    ["2031-06-01", 2031, 2],
    ["2031-07-01", 2031, 3],
    ["2031-08-01", 2031, 3],
    ["2031-09-01", 2031, 3],
  ] as const;
  await getDb()
    .insert(pensionCompetences)
    .values(
      months.map(([payrollPeriod, year, quarter], index) =>
        userScoped(ctx).stamp({
          fundId: payslip.id,
          // A stable id per month, so the file does not depend on the run.
          payslipId: `00000000-0000-7000-8000-0000000000${String(index + 10)}`,
          payrollPeriod,
          kind: "ordinary",
          year,
          quarter,
          workerCents: 8_000n,
          employerCents: 6_000n,
          tfrCents: 21_000n,
          workerEnrollmentCents: index === 0 ? 516n : null,
          employerEnrollmentCents: index === 0 ? 516n : null,
        }),
      ),
    );
  // What reached the fund, written by hand as the fund states it: three transfers, the first with
  // the joining fee, the third 5,00 € short of what the payslips accrued. The third quarter of
  // 2031 is still on the way.
  await addContribution(ctx, payslip.id, {
    kind: "other",
    classification: "enrollment",
    on: "2031-01-20",
    amountCents: 1_032n,
    feeCents: 1_032n,
  });
  for (const [year, index, on, worker] of [
    [2030, 4, "2031-01-20", 24_000n],
    [2031, 1, "2031-04-20", 24_000n],
    [2031, 2, "2031-07-21", 23_500n],
  ] as const) {
    await addContribution(ctx, payslip.id, {
      kind: "payroll",
      on,
      workerCents: worker,
      employerCents: 18_000n,
      tfrCents: 63_000n,
      period: { year, index },
      feeCents: 300n,
    });
  }
  // A payment of her own, an exit, and a change of compartment that costs 10,00 €.
  await addContribution(ctx, payslip.id, {
    kind: "voluntary",
    on: "2031-05-10",
    amountCents: 50_000n,
    feeCents: 0n,
  });
  await addContribution(ctx, payslip.id, {
    kind: "other",
    classification: "withdrawal",
    on: "2031-08-04",
    amountCents: 30_000n,
    feeCents: 0n,
  });
  await addContribution(ctx, payslip.id, {
    kind: "other",
    classification: "switch",
    on: "2031-09-01",
    amountCents: 0n,
    feeCents: 1_000n,
  });
  for (const [on, cents] of [
    ["2031-01-31", 104_700n],
    ["2031-04-30", 212_300n],
    ["2031-06-30", 265_900n],
    ["2031-09-30", 341_800n],
  ] as const) {
    await recordValuation(ctx, payslip.id, { on, cents });
  }
  return { debitId: debit.id, payslipId: payslip.id };
}
