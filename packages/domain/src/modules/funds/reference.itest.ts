import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../../platform/context";
import { canonical, namesIn, project } from "../../../../../scripts/snapshot-format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { seedFundsReference } from "../../../../../test/funds-reference";
import { fundSummary } from "./detail";
import { fundHomeRow } from "./home-queries";
import { allPeriod, yearPeriod } from "./period";

// The reference file of the approved calculations for the two test funds of the single model
// (rewrite plan, 10-modularity.md §10.10 test B3; 11-standardization.md §11.2.4 test SN5): one fund
// with a recurring debit, one fed by the payslip. What goes in — payments, payslips, values — is
// written in `test/funds-reference.ts`; what comes out — paid in, fees, gain, Modified Dietz, XIRR, the periods, the
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

  ({ debitId, payslipId } = await seedFundsReference(ctx));
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
