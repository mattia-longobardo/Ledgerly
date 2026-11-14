// scripts/perf-probe.ts — `npm run perf`. Builds a deliberately heavy user in `ledgerly_test`
// (twelve accounts, sixty thousand movements over three years, fourteen thousand balance entries,
// and something in every other section) and times the widest views and every route of `/api/v1`
// against it, so "it is fast enough" is a number and not a feeling. Ends with the query plans of
// the two statements that carry the most rows.
//
// The numbers are held to `baselines/performance.json` (rewrite plan, 10-modularity.md §10.9; gate
// G9): a view or a route may not send more queries than its baseline, and its median time may not
// be more than 10% worse. `npm run perf -- --write` records a new baseline — after a measured
// improvement, or with a decision that accepts a cost; never to make a slower step pass.
//
// It never touches `ledgerly`: the guard below refuses any database whose name does not end in
// `_test`, and `scripts/perf-on-test.sh` builds the URL for that database and checks it again.
// The user it makes is removed at the end, and every row it owns goes with it.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { accountsView, listBalanceEntries } from "../src/modules/accounts/queries";
import { accounts, balanceEntries } from "../src/modules/accounts/schema";
import { budgetsView } from "../src/modules/budgets/queries";
import { setLimit } from "../src/modules/budgets/service";
import { fundHomeRow, fundsHomeRows } from "../src/modules/funds/home-queries";
import { fundDetail } from "../src/modules/funds/queries";
import { addDeposit, createFund, recordValuation } from "../src/modules/funds/service";
import { rulesOnAccount } from "../src/modules/interests/queries";
import { createRule } from "../src/modules/interests/service";
import {
  investmentsHome,
  investmentsPnlView,
  serviceDetail,
  servicePnlView,
} from "../src/modules/investments/queries";
import { updateServiceValue } from "../src/modules/investments/service";
import { pocketsOnAccount, pocketsTotal, pocketsView } from "../src/modules/pockets/queries";
import { addToPocket, createPocket } from "../src/modules/pockets/service";
import { subscriptionsOnAccount, subscriptionsView, suggestions } from "../src/modules/subscriptions/queries";
import { createSubscription } from "../src/modules/subscriptions/service";
import { timeOffView } from "../src/modules/timeoff/queries";
import { saveAllowance, saveLeaveDay } from "../src/modules/timeoff/service";
import { expensesView } from "../src/modules/transactions/queries";
import { categories, transactions } from "../src/modules/transactions/schema";
import { api } from "../src/platform/api/app";
import { resetRateLimits } from "../src/platform/api/rate-limit";
import { createApiClientWith, deleteApiClient } from "../src/platform/auth/api-clients";
import { getAuth } from "../src/platform/auth/auth";
import { authAccounts, users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { addDays, addMonths, monthKey, today } from "../src/platform/dates";
import { getDb, getPool } from "../src/platform/db/client";
import * as tables from "../src/platform/db/tables";
import { readEnv } from "../src/platform/env";
import { accountMovement, manualService } from "../test/investments";

const BASELINE = "baselines/performance.json";
/** A median this many ms over its baseline is noise, whatever the percentage says. */
const NOISE_MS = 3;
const WORSE = 1.1;

// The application's own `getDb()`, with a logger that counts: set before the first call, which is
// what `getDb()` then hands to every module. No product code knows it is being counted.
let queries = 0;
(globalThis as unknown as { ledgerlyDb?: unknown }).ledgerlyDb = drizzle(getPool(), {
  schema: tables,
  logger: { logQuery: () => void (queries += 1) },
});

const ACCOUNTS = 12;
const MOVEMENTS = 60_000;
const ENTRIES_PER_ACCOUNT = 1_200;

const [{ current_database: database }] = (
  await getDb().execute<{ current_database: string }>(sql`select current_database()`)
).rows;
if (!database.endsWith("_test")) throw new Error(`Refusing to run against "${database}"`);

// A person who can sign in, not a bare row: the routes are measured with a real access token.
const auth = await getAuth();
const email = `perf-${randomUUID()}@example.test`;
const password = randomUUID();
const { user } = await auth.api.createUser({ body: { email, password, name: "Perf" } });
const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
// Its only door is SSO from here on, so no TOTP is owed (as in `api.itest.ts`).
await getDb()
  .delete(authAccounts)
  .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential")));
const session = new Headers({
  cookie: signedIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; "),
});
const ctx: Ctx = {
  userId: user.id,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
};

const categoryRows = await getDb()
  .insert(categories)
  .values(
    Array.from({ length: 24 }, (_, index) => ({
      userId: user.id,
      name: `Categoria ${index}`,
      kind: "expense" as const,
    })),
  )
  .returning({ id: categories.id });

const accountRows = await getDb()
  .insert(accounts)
  .values(
    Array.from({ length: ACCOUNTS }, (_, index) => ({
      userId: user.id,
      name: `Conto ${index}`,
      type: "checking" as const,
      currency: "EUR",
      origin: "manual" as const,
    })),
  )
  .returning({ id: accounts.id });

const day = (back: number) => new Date(Date.now() - back * 86_400_000);
const civil = (back: number) => day(back).toISOString().slice(0, 10);

console.log(`seeding ${MOVEMENTS} movements over ${ACCOUNTS} accounts…`);
for (let start = 0; start < MOVEMENTS; start += 2_000) {
  await getDb()
    .insert(transactions)
    .values(
      Array.from({ length: Math.min(2_000, MOVEMENTS - start) }, (_, offset) => {
        const index = start + offset;
        return {
          userId: user.id,
          accountId: accountRows[index % ACCOUNTS].id,
          categoryId: categoryRows[index % categoryRows.length].id,
          occurredAt: day(index % 1_095),
          amountCents: BigInt(-((index % 9_000) + 100)),
          currency: "EUR",
          type: "expense" as const,
          state: "cleared" as const,
          payee: `Esercente ${index % 500}`,
          origin: "manual" as const,
        };
      }),
    );
}

for (const account of accountRows) {
  for (let start = 0; start < ENTRIES_PER_ACCOUNT; start += 600) {
    await getDb()
      .insert(balanceEntries)
      .values(
        Array.from({ length: Math.min(600, ENTRIES_PER_ACCOUNT - start) }, (_, offset) => ({
          userId: user.id,
          accountId: account.id,
          on: civil(start + offset),
          balanceCents: BigInt((start + offset) * 37 + 100_000),
          source: "manual" as const,
        })),
      )
      .onConflictDoNothing();
  }
}

// ——— Something in every other section, so no view is timed on an empty state ——————————————————————

const todayOn = today(ctx.timeZone);
const thisMonth = monthKey(todayOn);
const thisYear = Number(todayOn.slice(0, 4));
const [first, second] = accountRows;

for (const [index, category] of categoryRows.slice(0, 8).entries()) {
  await setLimit(ctx, {
    categoryId: category.id,
    accountId: null,
    month: thisMonth,
    cents: 20_000n + BigInt(index),
  });
}
for (const index of [0, 1, 2, 3]) {
  const pocket = await createPocket(ctx, {
    name: `Salvadanaio ${index}`,
    color: null,
    backingAccountId: accountRows[index].id,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth: addMonths(thisMonth, -6),
  });
  await addToPocket(ctx, pocket.id, { cents: 50_000n, on: addDays(todayOn, -40) });
}
for (const index of [0, 1, 2, 3, 4, 5]) {
  await createSubscription(ctx, {
    name: `Abbonamento ${index}`,
    categoryId: null,
    utility: 5,
    priceCents: 1_299n,
    cycle: index % 2 === 0 ? "monthly" : "yearly",
    nextChargeOn: addDays(todayOn, 5 + index),
    paymentAccountId: first.id,
    payeeMatch: `Esercente ${index}`,
    tolerance: "0.05",
  });
}
await createRule(ctx, {
  accountId: second.id,
  taxRate: "0.26",
  dayBasis: "365",
  settlement: "monthly",
  validFrom: `${thisYear}-01-01`,
  validTo: null,
  payeeMatch: "interessi",
  tiers: [{ upToCents: null, annualRate: "0.0365" }],
});
const brokers: string[] = [];
for (const index of [0, 1, 2]) {
  const { accountId } = await manualService(ctx, {
    name: `Broker ${index}`,
    category: "broker",
    currency: "EUR",
  });
  await accountMovement(ctx, accountId, todayOn, 1_000_000n);
  await updateServiceValue(ctx, accountId, { on: todayOn, cents: 1_045_000n + BigInt(index) });
  brokers.push(accountId);
}
const funds: string[] = [];
for (const index of [0, 1]) {
  const fund = await createFund(ctx, {
    name: `Fondo ${index}`,
    provider: "Fideuram",
    isin: `LU098765432${index}`,
    compartment: "Bilanciato",
    debitAccountId: null,
    debitDay: 5,
    ter: "0.012",
    startOn: addDays(todayOn, -720),
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
    valuationAccountId: null,
    initialCents: 500_000n,
  });
  for (let back = 23; back >= 1; back -= 1) {
    await addDeposit(ctx, fund.id, {
      on: addDays(todayOn, -back * 30),
      chargedCents: 25_100n,
      feeCents: 100n,
      note: null,
    });
  }
  for (let back = 7; back >= 1; back -= 1) {
    await recordValuation(ctx, fund.id, {
      on: addDays(todayOn, -back * 90),
      cents: BigInt(1_100_000 - back * 70_000),
    });
  }
  funds.push(fund.id);
}
await saveAllowance(ctx, thisYear, { vacationDays: 26, rolDays: 4 });
// Days of this year only; a day that is not a working day is refused, and that is fine here.
for (const day of ["01-08", "02-12", "03-19", "04-23", "05-14"]) {
  await saveLeaveDay(ctx, { from: `${thisYear}-${day}`, kind: "vacation", fraction: 1 }).catch(() => {});
}

await getDb().execute(sql`analyze`);

// ——— Measuring ————————————————————————————————————————————————————————————————————————————————

type Measure = { medianMs: number; p95Ms: number; queries: number };
const measured: { views: Record<string, Measure>; routes: Record<string, Measure> } = {
  views: {},
  routes: {},
};

/** `runs` timed runs after one warm run; the queries are those of one run, which is exact. */
async function timed(runs: number, run: () => Promise<unknown>): Promise<Measure> {
  await run(); // warm
  queries = 0;
  await run();
  const count = queries;
  const times: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const at = performance.now();
    await run();
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  const pick = (share: number) => times[Math.min(times.length - 1, Math.ceil(times.length * share) - 1)];
  return {
    medianMs: Math.round(pick(0.5) * 10) / 10,
    p95Ms: Math.round(pick(0.95) * 10) / 10,
    queries: count,
  };
}

const month = civil(15).slice(0, 7);
const now = new Date();
const views: [string, () => Promise<unknown>][] = [
  ["expensesView (mese corrente)", () => expensesView(ctx, { from: `${month}-01`, to: `${month}-28` })],
  ["expensesView (tre anni)", () => expensesView(ctx, { from: civil(1_095), to: civil(0) })],
  ["accountsView (24 mesi)", () => accountsView(ctx, {})],
  // Each page below is the reads of its `page.tsx`, in its order.
  [
    "Overview",
    async () => [
      await accountsView(ctx, { now }),
      await pocketsTotal(ctx),
      await budgetsView(ctx, thisMonth),
    ],
  ],
  [
    "Account (dettaglio)",
    async () => [
      await accountsView(ctx, { now, includeArchived: true }),
      await Promise.all([
        pocketsOnAccount(ctx, first.id),
        subscriptionsOnAccount(ctx, first.id),
        rulesOnAccount(ctx, first.id),
      ]),
      await listBalanceEntries(ctx, first.id),
    ],
  ],
  ["Investments (home)", async () => [await investmentsHome(ctx), await investmentsPnlView(ctx, {})]],
  [
    "Investments (servizio)",
    async () => [await serviceDetail(ctx, brokers[0]), await servicePnlView(ctx, brokers[0], {})],
  ],
  ["Funds (home)", () => fundsHomeRows(ctx)],
  ["Funds (fondo)", async () => [await fundHomeRow(ctx, funds[0]), await fundDetail(ctx, funds[0], 12)]],
  ["Pockets", () => pocketsView(ctx)],
  ["Budgets", () => budgetsView(ctx, thisMonth)],
  ["Subscriptions", async () => [await subscriptionsView(ctx), await suggestions(ctx)]],
  ["Time Off (anno)", () => timeOffView(ctx, thisYear)],
];
for (const [name, run] of views) measured.views[name] = await timed(5, run);

// The routes, with an access token of the person as a client gets one (client_credentials).
const origin = new URL(readEnv().BETTER_AUTH_URL).origin;
const minted = await createApiClientWith(auth, session, {
  name: "perf",
  scopes: ["read", "write", "imports", "investments:read"],
});
const tokenResponse = await auth.handler(
  new Request(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${minted.clientId}:${minted.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", resource: minted.resource }).toString(),
  }),
);
if (tokenResponse.status !== 200) throw new Error(`no access token: ${tokenResponse.status}`);
const token = ((await tokenResponse.json()) as { access_token: string }).access_token;

async function call(method: string, path: string, body?: unknown): Promise<void> {
  const response = await api.fetch(
    new Request(`${origin}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  await response.arrayBuffer();
  if (response.status >= 400) throw new Error(`${method} ${path}: ${response.status}`);
}
// `POST /imports` is not here: it needs a document, the bucket and Next's `after()`.
const routes: [string, () => Promise<void>][] = [
  ["GET /accounts", () => call("GET", "/accounts")],
  ["GET /accounts/:id/balances", () => call("GET", `/accounts/${first.id}/balances`)],
  [
    "POST /accounts/:id/balances",
    () => call("POST", `/accounts/${first.id}/balances`, { on: todayOn, balance: "1234.56" }),
  ],
  ["GET /transactions", () => call("GET", `/transactions?from=${civil(30)}&to=${civil(0)}`)],
  ["GET /summary", () => call("GET", "/summary")],
  ["GET /investments", () => call("GET", "/investments")],
  ["GET /investments/:accountId/holdings", () => call("GET", `/investments/${brokers[0]}/holdings`)],
];
for (const [name, run] of routes) {
  resetRateLimits();
  measured.routes[name] = await timed(20, run);
}
await deleteApiClient(ctx, minted.clientId);

// ——— Against the baseline —————————————————————————————————————————————————————————————————————

const write = process.argv.includes("--write");
const baseline = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")) as typeof measured;
  } catch {
    return null;
  }
})();
const worse: string[] = [];
for (const group of ["views", "routes"] as const) {
  console.log(
    `\n${group === "views" ? "VISTE" : "ROTTE /api/v1"}${" ".repeat(26)}mediana    p95   query   (partenza: mediana, query)`,
  );
  for (const [name, now] of Object.entries(measured[group])) {
    const before = baseline?.[group][name];
    const slower =
      before && now.medianMs > before.medianMs * WORSE && now.medianMs - before.medianMs > NOISE_MS;
    const more = before && now.queries > before.queries;
    if (slower) worse.push(`${name}: mediana ${before.medianMs} → ${now.medianMs} ms`);
    if (more) worse.push(`${name}: query ${before.queries} → ${now.queries}`);
    console.log(
      `PERF ${name.padEnd(36)} ${now.medianMs.toFixed(1).padStart(7)} ${now.p95Ms.toFixed(1).padStart(7)} ${String(now.queries).padStart(6)}` +
        (before
          ? `   (${before.medianMs}, ${before.queries})${slower || more ? "  PEGGIO" : ""}`
          : "   (nuova)"),
    );
  }
}
if (write) {
  const heavyUser = {
    accounts: ACCOUNTS,
    movements: MOVEMENTS,
    balanceEntries: ACCOUNTS * ENTRIES_PER_ACCOUNT,
  };
  // `production` (job durations, image) is read by hand at a deploy and kept as it is.
  writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, heavyUser, ...measured }, null, 2)}\n`);
  console.log(`\n${BASELINE} scritto`);
}

/** The plan of the list query itself, which is the widest single statement of the application. */
const plan = await getDb().execute<{ "QUERY PLAN": string }>(
  sql`explain (analyze, buffers, costs off)
      select t.id, t.occurred_at, t.amount_cents, t.payee, t.category_id, t.account_id
      from transactions t
      where t.user_id = ${user.id}::uuid
        and t.occurred_at >= ${day(30).toISOString()}::timestamptz
        and t.occurred_at < ${day(0).toISOString()}::timestamptz
        and t.hidden_at is null
      order by t.occurred_at desc, t.id desc
      limit 200`,
);
console.log("\nEXPLAIN — la lista dei movimenti di un mese:");
for (const row of plan.rows) console.log("   " + row["QUERY PLAN"]);

// The shape `balancesOn` really sends: the account list is in the WHERE, which is what lets
// `balance_entries_account_on_idx` lead. Without it the planner has no choice but a seq scan —
// measured, and the reason this EXPLAIN carries the IN.
const ids = sql.join(
  accountRows.map((row) => sql`${row.id}::uuid`),
  sql`, `,
);
const plan2 = await getDb().execute<{ "QUERY PLAN": string }>(
  sql`explain (analyze, buffers, costs off)
      select distinct on (b.account_id) b.account_id, b.balance_cents
      from balance_entries b
      where b.user_id = ${user.id} and b.account_id in (${ids}) and b.on <= ${civil(0)}::date
      order by b.account_id, b.on desc`,
);
console.log("\nEXPLAIN — l'ultimo saldo noto di ogni conto:");
for (const row of plan2.rows) console.log("   " + row["QUERY PLAN"]);

await getDb()
  .delete(users)
  .where(sql`${users.id} = ${user.id}`);
console.log("\nutente di prova rimosso");
if (!write && worse.length > 0) {
  console.error(`\nG9: ${worse.length} misure peggiori della partenza:\n  ${worse.join("\n  ")}`);
  process.exit(1);
}
if (!write)
  console.log(
    baseline
      ? "G9: nessuna misura peggiore della partenza"
      : "nessun file di partenza: `npm run perf -- --write`",
  );
process.exit(0);
