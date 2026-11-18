import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { canonical, namesIn, project } from "../../../../../scripts/snapshot-format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { addDeposit, debitFund, payrollFund } from "../../../../../test/funds";
import { fundSummary } from "./detail";
import { fundHomeRow } from "./home-queries";
import { allPeriod, yearPeriod } from "./period";
import { pensionCompetences } from "./schema";
import { addContribution, recordValuation } from "./service";

// The reference file of the approved calculations for the two test funds of the single model
// (rewrite plan, 10-modularity.md §10.10 test B3; 11-standardization.md §11.2.4 test SN5): one fund
// with a recurring debit, one fed by the payslip. What goes in — payments, payslips, values — is
// written below; what comes out — paid in, fees, gain, Modified Dietz, XIRR, the periods, the
// projection — is held to `baselines/numbers/funds.json`, byte for byte. A refactor must leave the
// file as it is; a change that is meant rewrites it with
// `npm run test:integration -- src/modules/funds/reference.itest.ts -u`, in a commit that says why.

const NOW = new Date("2031-10-15T10:00:00Z");
const TODAY = "2031-10-15";
const BASELINE = join(process.cwd(), "baselines/numbers/funds.json");

let ctx: Ctx;
let debitId: string;
let payslipId: string;

beforeAll(async () => {
  await resetDatabase();
  ctx = await newContext();
  // The clock stops at the day the file is read on: only `Date` is faked, the pool's timers run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

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
  debitId = debit.id;
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
  payslipId = payslip.id;
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
          payslipType: "ordinary",
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
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await resetDatabase();
  await closeDatabase();
});

/** What the pages read of one fund: its flows and values in, its figures out. */
async function figuresOf(fundId: string) {
  const row = await fundHomeRow(ctx, fundId, NOW);
  const periods: Record<string, unknown> = {};
  for (const [key, period] of [
    ["all", allPeriod(TODAY)],
    ["2030", { ...yearPeriod(2030, TODAY), year: 2030 }],
    ["2031", { ...yearPeriod(2031, TODAY), year: 2031 }],
  ] as const) {
    const { summary, line } = fundSummary({ fund: row.home, period, todayOn: TODAY });
    periods[key] = {
      summary: { ...summary, lines: undefined },
      measure: line.measure,
      status: line.status === "measured",
    };
  }
  const { detail } = row;
  return {
    in: { flows: row.home.flows, points: row.home.points, accrued: row.home.accrued },
    out: {
      periods,
      onTheWayCents: row.onTheWayCents,
      onTheWayPeriods: row.onTheWayQuarters,
      debit: detail.debits.map((debit) => ({ amountCents: debit.source.amountCents, status: debit.status })),
      metrics: detail.metrics,
      bridge: detail.bridge,
      quarters: detail.quarters.map((quarter) => ({
        key: `${quarter.year}-${quarter.quarter}`,
        due: quarter.due,
        feesCents: quarter.feesCents,
        netCents: quarter.netCents,
        components: quarter.components.map((one) => ({
          key: one.component,
          accruedCents: one.accruedCents,
          creditedCents: one.creditedCents,
          differenceCents: one.differenceCents,
        })),
      })),
      forecast: detail.forecast,
      valuations: detail.valuations.map(({ on, valueCents, paidInCents }) => ({
        on,
        valueCents,
        paidInCents,
      })),
    },
  };
}

describe("the two test funds of the single model (B3, SN5)", () => {
  it("give the same figures as the reference file, twice in a row", async () => {
    const read = async () => {
      const figures = { "Fondo Alfa": await figuresOf(payslipId), "Fondo Beta": await figuresOf(debitId) };
      return canonical(project(figures, namesIn(figures)) ?? {});
    };
    const first = await read();
    expect(await read()).toBe(first);
    await expect(first).toMatchFileSnapshot(BASELINE);
  });

  it("measures an exit as money that left, not as a loss", async () => {
    const row = await fundHomeRow(ctx, payslipId, NOW);
    const { line } = fundSummary({
      fund: row.home,
      period: { ...yearPeriod(2031, TODAY), year: 2031 },
      todayOn: TODAY,
    });
    const exit = row.home.flows.find((flow) => flow.on === "2031-08-04");
    expect(exit?.chargedCents).toBe(-30_000n);
    // The gain is the last value less the first and less the net money that crossed the boundary:
    // the 300,00 € that left are added back, they are not a fall of the value.
    const { start, end, flowsCents, gainCents } = line.measure;
    expect(gainCents).toBe(end!.cents - start!.cents - flowsCents!);
    expect(line.measure.paidInCents).toBeGreaterThan(0n);
    const withoutExit = row.home.flows.filter((flow) => flow !== exit);
    const other = fundSummary({
      fund: { ...row.home, flows: withoutExit },
      period: { ...yearPeriod(2031, TODAY), year: 2031 },
      todayOn: TODAY,
    }).line.measure;
    // Written as a loss — no operation for the exit — the same values would read 300,00 € less gain.
    expect(gainCents! - other.gainCents!).toBe(30_000n);
    expect(line.measure.paidInCents).toBe(other.paidInCents);
  });
});
