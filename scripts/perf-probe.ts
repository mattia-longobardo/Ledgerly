// scripts/perf-probe.ts — `npm run perf`. Builds a deliberately heavy user in `ledgerly_test`
// (twelve accounts, sixty thousand movements over three years, fourteen thousand balance entries)
// and times the widest views against it, so "it is fast enough" is a number and not a feeling.
// Ends with the query plans of the two statements that carry the most rows.
//
// It never touches `ledgerly`: the guard below refuses any database whose name does not end in
// `_test`, and `scripts/perf-on-test.sh` builds the URL for that database and checks it again.
// The user it makes is removed at the end, and every row it owns goes with it.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { accountsView } from "../src/modules/accounts/queries";
import { accounts, balanceEntries } from "../src/modules/accounts/schema";
import { expensesView } from "../src/modules/transactions/queries";
import { categories, transactions } from "../src/modules/transactions/schema";
import { users } from "../src/platform/auth/schema";
import type { Ctx } from "../src/platform/context";
import { getDb } from "../src/platform/db/client";

const ACCOUNTS = 12;
const MOVEMENTS = 60_000;
const ENTRIES_PER_ACCOUNT = 1_200;

const [{ current_database: database }] = (
  await getDb().execute<{ current_database: string }>(sql`select current_database()`)
).rows;
if (!database.endsWith("_test")) throw new Error(`Refusing to run against "${database}"`);

const [user] = await getDb()
  .insert(users)
  .values({ email: `perf-${randomUUID()}@example.test`, name: "Perf", role: "user" })
  .returning({ id: users.id });
const ctx: Ctx = {
  userId: user.id,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
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

await getDb().execute(sql`analyze`);

async function timed(name: string, run: () => Promise<unknown>): Promise<void> {
  await run(); // warm
  const runs: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const at = performance.now();
    await run();
    runs.push(performance.now() - at);
  }
  runs.sort((a, b) => a - b);
  console.log(
    `PERF ${name.padEnd(28)} mediana ${runs[2].toFixed(0)} ms   (min ${runs[0].toFixed(0)}, max ${runs[4].toFixed(0)})`,
  );
}

const month = civil(15).slice(0, 7);
await timed("expensesView (mese corrente)", () =>
  expensesView(ctx, { from: `${month}-01`, to: `${month}-28` }),
);
await timed("expensesView (tre anni)", () => expensesView(ctx, { from: civil(1_095), to: civil(0) }));
await timed("accountsView (12 mesi)", () => accountsView(ctx, {}));

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
process.exit(0);
