// scripts/numbers-snapshot.ts — the "numbers snapshot" of the rewrite plan
// (docs/design/rewrite-plan/06-data.md §6.4, point 2; release N0).
//
// Reads, for one user, a fixed list of numbers through the same read services the pages call — net
// worth and its buckets over 24 months, the balance of every account at each month's end, income,
// spending and net per month, spending by category, budgets, subscriptions, pockets, accrued
// interest, value, paid-in, gain and return of every investment service and every fund per year,
// leave residuals, payslip totals — and writes them as one sorted JSON file with its `sha256`.
// Taken before and after a refactor step or a deploy: a number that differs stops the release.
//
// What it keeps of a view is decided by one rule and not field by field (`project`): every number,
// every amount in cents, every `null` and flag, and every civil date; names only as the labels of
// the rows they belong to. Identifiers, timestamps and free text are left out, so the file of a test
// user is the same on every run and can live in the repository as a reference.
//
//   node … scripts/numbers-snapshot.ts --out <folder> --label before [--as-of <ISO instant>]
//   node … scripts/numbers-snapshot.ts --diff <a.json> <b.json>
//
// On the deployed database (`scripts/numbers-on-homelab.sh`) it reads every real user inside one
// transaction that is rolled back and writes `numbers-<label>.json` (mode 600) in the release's folder of
// `Ledgerly-dumps/`. `--diff` prints "uguale", or how many numbers differ and their names — never a
// value: the names may go in a comment, the file never leaves the server.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountsView } from "../src/modules/accounts/queries";
import { budgetsView } from "../src/modules/budgets/queries";
import { fundSummary } from "../src/modules/funds/detail";
import { firstDataOn, homeSummary, valueToday } from "../src/modules/funds/home";
import { fundsHomeRows } from "../src/modules/funds/home-queries";
import { fundDetail } from "../src/modules/funds/queries";
import { interestsView, ruleDetail } from "../src/modules/interests/queries";
import { periodOf } from "../src/modules/investments/pnl";
import { investmentsHome, investmentsPnl, investmentsPnlView } from "../src/modules/investments/queries";
import { registerView } from "../src/modules/payroll/queries";
import { pocketsView } from "../src/modules/pockets/queries";
import { subscriptionsView } from "../src/modules/subscriptions/queries";
import { timeOffView } from "../src/modules/timeoff/queries";
import { expensesView } from "../src/modules/transactions/queries";
import type { Ctx } from "../src/platform/context";
import { lastDayOfMonth, today } from "../src/platform/dates";
import { monthlyFigures } from "../src/platform/reports/monthly";
import { canonical, differences, project, namesIn, sha256, type Json } from "./snapshot-format";

type SnapshotCtx = Pick<Ctx, "userId" | "timeZone" | "displayCurrency">;

/** The views behind the numbers, as the pages read them, at the instant `now`. */
async function views(ctx: SnapshotCtx, now: Date): Promise<Record<string, unknown>> {
  const todayOn = today(ctx.timeZone, now);
  const thisYear = Number(todayOn.slice(0, 4));
  const accounts = await accountsView(ctx, { now, includeArchived: true });

  const months: Record<string, unknown> = {};
  for (const month of accounts.months) {
    // `limit: 1`: the list is not a number; the summary and the breakdown do not depend on it.
    const expenses = await expensesView(ctx, { from: month, to: lastDayOfMonth(month), limit: 1 });
    const budgets = await budgetsView(ctx, month);
    months[month] = {
      summary: expenses.summary,
      breakdown: expenses.breakdown,
      budgets: { rows: budgets.rows, totals: budgets.totals, unbudgetedCents: budgets.unbudgetedCents },
    };
  }

  const subscriptions = await subscriptionsView(ctx, now);
  const pockets = await pocketsView(ctx, now);
  const interests = await interestsView(ctx, now);
  const interestDetails: unknown[] = [];
  for (const row of interests) {
    const detail = await ruleDetail(ctx, row.rule.id, now);
    interestDetails.push({
      name: row.accountName,
      pendingCents: detail.pendingCents,
      settlements: detail.settlements,
    });
  }

  const investments = await investmentsHome(ctx, now);
  const firstInvestmentOn = (await investmentsPnlView(ctx, { period: "all" }, now)).firstOn;
  const investmentPeriods: Record<string, unknown> = {};
  for (const period of periodsFrom(firstInvestmentOn, thisYear)) {
    const pnl = await investmentsPnl(ctx, { period }, now);
    investmentPeriods[period] = pnl.portfolio;
  }

  const fundRows = await fundsHomeRows(ctx, now);
  const homes = fundRows.map((row) => row.home);
  const firstFundOn = firstDataOn(homes);
  const fundPeriods: Record<string, unknown> = {};
  for (const key of periodsFrom(firstFundOn, thisYear)) {
    const period = periodOf({ period: key }, todayOn);
    const home = homeSummary({ funds: homes, period, todayOn, firstOn: firstFundOn });
    fundPeriods[key] = {
      home: withoutLines(home),
      funds: fundRows.map((row) => {
        const one = fundSummary({ fund: row.home, period, todayOn });
        return { name: row.fund.name, summary: withoutLines(one.summary), line: one.line };
      }),
    };
  }
  const fundDetails: unknown[] = [];
  for (const row of fundRows) {
    // The detail query is the PAC's (`funds/[id]/page.tsx`); a pension fund's numbers are `pension`.
    const detail = row.pension === null ? await fundDetail(ctx, row.fund.id, 12, now) : null;
    fundDetails.push({
      name: row.fund.name,
      month: row.month,
      onTheWayCents: row.onTheWayCents,
      onTheWayQuarters: row.onTheWayQuarters,
      pension: row.pension,
      detail: detail && {
        metrics: detail.metrics,
        stats: detail.stats,
        periods: detail.periods,
        valueSeries: detail.valueSeries,
        paidSeries: detail.paidSeries,
        forecast: detail.forecast,
      },
    });
  }

  const timeOffNow = await timeOffView(ctx, thisYear);
  const timeOff: Record<string, unknown> = {};
  for (const year of timeOffNow.years) {
    const view = year === thisYear ? timeOffNow : await timeOffView(ctx, year);
    timeOff[String(year)] = {
      allowance: view.allowance,
      vacation: view.vacation,
      rol: view.rol,
      totals: view.totals,
      overdrawn: view.overdrawn,
      totalAllowanceMinutes: view.totalAllowanceMinutes,
      months: view.months,
    };
  }

  const payroll = await registerView(ctx);

  return {
    accounts: {
      months: accounts.months,
      netWorth: accounts.netWorth,
      netWorthEstimated: accounts.netWorthEstimated,
      total: accounts.total,
      totalPartial: accounts.totalPartial,
      previousTotal: accounts.previousTotal,
      buckets: accounts.buckets,
      rows: accounts.rows.map((row) => ({
        name: row.account.name,
        balance: row.balance,
        previous: row.previous,
        series: row.series,
        held: row.held,
        estimated: row.estimated,
        display: row.display,
      })),
    },
    summary: await monthlyFigures(ctx, accounts.months.at(-1)!, now),
    months,
    subscriptions: { ...subscriptions, accounts: undefined, alerts: undefined },
    pockets: { ...pockets, accounts: undefined, archived: undefined },
    interests: { rules: interests, details: interestDetails },
    investments: {
      totals: investments.totals,
      services: investments.services,
      byClass: investments.byClass,
      byService: investments.byService,
      funds: investments.funds,
      periods: investmentPeriods,
    },
    funds: { valueToday: valueToday(homes, todayOn), periods: fundPeriods, funds: fundDetails },
    timeOff,
    payroll: {
      years: payroll.years.map(({ year, totals, averages }) => ({ year, totals, averages })),
      kpis: payroll.kpis,
    },
  };
}

/** `lines` repeats, fund by fund, what the snapshot already reads through `fundSummary`. */
const withoutLines = <T extends { lines: unknown }>(summary: T) => ({ ...summary, lines: undefined });

/** "All" and every calendar year from the first day with data to the year running. */
function periodsFrom(firstOn: string | null, thisYear: number): string[] {
  const first = firstOn ? Number(firstOn.slice(0, 4)) : thisYear;
  return ["all", ...Array.from({ length: thisYear - first + 1 }, (_, index) => String(first + index))];
}

/** One user's numbers at `now`, ready for `canonical`. */
export async function numbersSnapshot(ctx: SnapshotCtx, now: Date): Promise<Json> {
  const read = await views(ctx, now);
  return project(read, namesIn(read)) ?? {};
}

// ——— The command ————————————————————————————————————————————————————————————————————————————

function argument(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function diff(): void {
  const [a, b] = process.argv.slice(process.argv.indexOf("--diff") + 1);
  const changed = differences(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8")));
  if (changed.length === 0) {
    console.log("uguale");
    return;
  }
  console.log(`${changed.length} differenze:`);
  for (const name of changed) console.log(`  ${name}`);
  process.exit(1);
}

/**
 * Every real user of the database this process points at, inside one transaction that is never
 * committed: a pool of one connection, opened on a single `repeatable read` picture so that every
 * number is of the same instant, and rolled back at the end.
 *
 * Not `read only`, though the plan asks for it: one read path writes. The pension figures call
 * `seedTariffs` (`src/modules/funds/pension/service.ts`), an `insert … on conflict do nothing` of
 * the public tariff, and a read-only transaction refuses even an insert that inserts nothing. The
 * guarantee is kept another way: the connection refuses `commit`, so nothing a read service does
 * on the way can stay.
 */
async function write(): Promise<void> {
  const out = argument("--out");
  const label = argument("--label");
  if (!out || !label || !/^[a-z0-9-]+$/.test(label)) throw new Error("usage: --out <folder> --label <name>");
  const now = new Date(argument("--as-of") ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new Error("--as-of is not an instant");

  const { Pool } = await import("pg");
  const { readEnv } = await import("../src/platform/env");
  const pool = new Pool({ connectionString: readEnv().DATABASE_URL, max: 1, idleTimeoutMillis: 0 });
  (globalThis as unknown as { ledgerlyPool?: unknown }).ledgerlyPool = pool;
  const client = await pool.connect();
  const send = client.query.bind(client) as (text: string) => Promise<unknown>;
  client.query = ((...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (/^\s*(commit|end)\b/i.test(text ?? "")) throw new Error("the numbers snapshot never commits");
    return (send as (...rest: unknown[]) => unknown)(...args);
  }) as typeof client.query;
  await send("begin transaction isolation level repeatable read");
  client.release();

  const { getPreferences } = await import("../src/modules/users/service");
  const people = await pool.query<{ id: string }>(
    "select id from users where email not like '%@example.test' order by id",
  );
  const users: Record<string, Json> = {};
  for (const { id } of people.rows) {
    const preferences = await getPreferences({ userId: id });
    users[id] = await numbersSnapshot(
      { userId: id, timeZone: preferences.timeZone, displayCurrency: preferences.displayCurrency },
      now,
    );
  }
  await pool.query("rollback");
  await pool.end();

  const text = canonical({ asOf: now.toISOString(), users });
  const file = join(out, `numbers-${label}.json`);
  writeFileSync(file, text, { mode: 0o600 });
  writeFileSync(`${file}.sha256`, `${sha256(text)}  numbers-${label}.json\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  chmodSync(`${file}.sha256`, 0o600);
  console.log(
    `numbers-${label}.json: ${people.rows.length} users, as of ${now.toISOString()}, sha256 ${sha256(text)}`,
  );
}

if (process.argv[1]?.endsWith("numbers-snapshot.ts")) {
  await (process.argv.includes("--diff") ? Promise.resolve(diff()) : write());
  process.exit(0);
}
