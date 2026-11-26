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
// `ledgerly-dumps/`. `--diff` prints "uguale", or how many numbers differ and their names — never a
// value: the names may go in a comment, the file never leaves the server.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountsView } from "@domain/modules/accounts/queries";
import { budgetsView } from "@domain/modules/budgets/queries";
import { fundSummary } from "@domain/modules/funds/detail";
import { firstDataOn, homeSummary, valueToday } from "@domain/modules/funds/home";
import { fundsHomeRows } from "@domain/modules/funds/home-queries";
import { fundsExport, fundValues } from "@domain/modules/funds/overview";
import { interestsView, ruleDetail } from "@domain/modules/interests/queries";
import { periodOf } from "@domain/modules/investments/pnl";
import {
  investmentsExport,
  investmentsHome,
  investmentsPnl,
  investmentsPnlView,
} from "@domain/modules/investments/queries";
import { registerView } from "@domain/modules/payroll/queries";
import { pocketsView } from "@domain/modules/pockets/queries";
import { subscriptionsView } from "@domain/modules/subscriptions/queries";
import { timeOffView } from "@domain/modules/timeoff/queries";
import { leaveSettings } from "@domain/modules/timeoff/schema";
import { getDb } from "@domain/platform/db/client";
import { eq } from "drizzle-orm";
import { timeOffYear } from "../apps/api/src/timeoff/dto";
import { expensesView } from "@domain/modules/transactions/queries";
import type { Ctx } from "@domain/platform/context";
import { lastDayOfMonth, today } from "@domain/shared/dates";
import { monthlyFigures } from "../apps/web/src/platform/reports/monthly";
import { canonical, differences, project, namesIn, sha256, type Json } from "./snapshot-format";
import { wireDomain } from "../apps/api/src/wiring";

// The ports of the domain, as every process wires them (10-modularity.md §10.3).
wireDomain();

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

  // What the export's section `investment-services` prints (decisions D9, D10).
  const investmentsExported = await investmentsExport(ctx, now);
  const dietz = new Map(
    investmentsExported.pnl.portfolio.services.map((one) => [
      one.accountId,
      one.displayReturn?.dietz ?? null,
    ]),
  );
  const exportInvestments = investmentsExported.portfolio.services.map((one) => ({
    name: one.account.name,
    valueCents: one.valueCents,
    investedCents: one.performance.investedCents,
    gainCents: one.performance.gainCents,
    simpleReturn: one.performance.simpleReturn,
    xirr: one.xirr,
    reliableFrom: one.reliableFrom,
    modifiedDietz: dietz.get(one.account.id) ?? null,
    archived: one.account.state === "archived",
  }));

  // With the history: the valuations and what the statements left are numbers of a fund too.
  const fundRows = await fundsHomeRows(ctx, now, { history: true });
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
  // One read for every fund since release N6. The key keeps the name it had when only a fund fed by
  // the payslip had this detail, so that a snapshot of before the release compares with one of after.
  const fundDetails = fundRows.map((row) => ({
    name: row.fund.name,
    month: row.month,
    onTheWayCents: row.onTheWayCents,
    onTheWayQuarters: row.onTheWayQuarters,
    // Without `freshness`: it is the day a row was written, by the database's own clock, and not a
    // number of the product. With it the file of a test user would change every day.
    pension: { ...row.detail, freshness: undefined },
  }));

  // What the export's section `funds` prints (decision D8): the paid-in, the value, the gain.
  const exported = await fundsExport(ctx, now);
  const exportFunds = exported
    .filter((row) => row.fund.state === "active")
    .map((row) => ({
      name: row.fund.name,
      paidInCents: row.paidInCents,
      valueCents: row.valueCents,
      gainCents: row.gainCents,
      lastValuation: row.lastValuation,
    }));

  // A person who never reached time off has no figures to compare, and reading them would start it:
  // a write, which the read-only transaction refuses (since R5g the first read creates the types).
  const reached = await getDb()
    .select({ userId: leaveSettings.userId })
    .from(leaveSettings)
    .where(eq(leaveSettings.userId, ctx.userId))
    .limit(1);
  const timeOffNow = reached.length === 0 ? null : await timeOffView(ctx, thisYear);
  const timeOff: Record<string, unknown> = {};
  for (const year of timeOffNow?.years ?? []) {
    const view = year === thisYear && timeOffNow ? timeOffNow : await timeOffView(ctx, year);
    // Every figure by the name of its type: the ids of the types differ from one database to the other.
    const wire = timeOffYear(view, null);
    const names = new Map(view.types.map((type) => [type.id, type.name]));
    // Keyed by the type's name, as a fund is by its own: one entry per type in every list here.
    const named = <T extends { typeId: string | null }>(list: readonly T[]) =>
      Object.fromEntries(list.map(({ typeId, ...one }) => [(typeId && names.get(typeId)) ?? "-", one]));
    timeOff[String(year)] = {
      allowances: named(view.allowances),
      // The residual, the allowance and (release N5.1) what a month grants and the year's end, by type.
      balances: named(
        wire.balances.map(({ typeId, residual, allowanceMinutes, carriedMinutes, accrual }) => ({
          typeId,
          residual,
          allowanceMinutes,
          carriedMinutes,
          accrual,
        })),
      ),
      totals: { ...wire.totals, byType: named(wire.totals.byType) },
      overdrawn: named(wire.overdrawnByType),
      months: wire.months.map((month) => ({
        ...month,
        payrollByType: month.payrollByType === null ? null : named(month.payrollByType),
        recordedByType: named(month.recordedByType),
      })),
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
    // The conventions a rule states since R5g are settings, not numbers: the file keeps its shape.
    interests: {
      rules: interests.map((row) => ({
        ...row,
        rule: { ...row.rule, dayCount: undefined, periodAnchor: undefined, paymentWindowDays: undefined },
      })),
      details: interestDetails,
    },
    investments: {
      totals: investments.totals,
      // The account of a service is printed whole, but never its IBAN (rewrite plan N4, H45): the two
      // fields are left out, so the file is the same as before the release.
      services: investments.services.map((service) => ({
        ...service,
        account: withoutIban(service.account),
      })),
      byClass: investments.byClass,
      byService: investments.byService,
      // Read beside the home since R5b, which no longer reads the funds: the same rows as before.
      funds: (await fundValues(ctx, now)).map((row) => ({
        id: row.fund.id,
        name: row.fund.name,
        valueCents: row.valueCents,
        kind: "pension",
      })),
      periods: investmentPeriods,
      export: exportInvestments,
    },
    funds: {
      valueToday: valueToday(homes, todayOn),
      periods: fundPeriods,
      funds: fundDetails,
      export: exportFunds,
    },
    timeOff,
    payroll: {
      years: payroll.years.map(({ year, totals, averages, kpis }) => ({ year, totals, averages, kpis })),
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
/** An account as the file prints it: every field but the IBAN's two (H45). */
function withoutIban<T extends { iban: string | null; ibanFromSource: boolean }>(
  account: T,
): Omit<T, "iban" | "ibanFromSource"> {
  const copy: Partial<T> = { ...account };
  delete copy.iban;
  delete copy.ibanFromSource;
  return copy as Omit<T, "iban" | "ibanFromSource">;
}

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
 * Every real user of the database this process points at, inside one read-only transaction that is
 * never committed: a pool of one connection, opened on a single `repeatable read` picture so that
 * every number is of the same instant, and rolled back at the end.
 *
 * `read only`, as the plan asks: since release N6 no read service writes (the fund pages used to
 * write the public tariff on every read, and a read-only transaction refuses even an insert that
 * inserts nothing). The connection refuses `commit` as well, so nothing could stay in any case.
 */
async function write(): Promise<void> {
  const out = argument("--out");
  const label = argument("--label");
  if (!out || !label || !/^[a-z0-9-]+$/.test(label)) throw new Error("usage: --out <folder> --label <name>");
  const now = new Date(argument("--as-of") ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new Error("--as-of is not an instant");

  const { Pool } = await import("pg");
  const { readEnv } = await import("@domain/platform/env");
  const pool = new Pool({ connectionString: readEnv().DATABASE_URL, max: 1, idleTimeoutMillis: 0 });
  (globalThis as unknown as { ledgerlyPool?: unknown }).ledgerlyPool = pool;
  const client = await pool.connect();
  const send = client.query.bind(client) as (text: string) => Promise<unknown>;
  client.query = ((...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (/^\s*(commit|end)\b/i.test(text ?? "")) throw new Error("the numbers snapshot never commits");
    return (send as (...rest: unknown[]) => unknown)(...args);
  }) as typeof client.query;
  await send("begin transaction isolation level repeatable read read only");
  client.release();

  const { getPreferences } = await import("@domain/modules/users/service");
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
