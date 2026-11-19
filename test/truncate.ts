// test/truncate.ts — imports nothing from src/, so both Vitest and Playwright's global setup can load it.
import type { ClientBase, Pool } from "pg";

type Db = Pool | ClientBase;

/** What the reset needs to know of the schema, read once per pool or client. */
interface ResetPlan {
  /** One query that returns the name of each table that has at least one row. */
  readonly filled: string | null;
  /** Every table, children before the tables they reference: the order of the deletes. */
  readonly order: readonly string[];
}

const plans = new WeakMap<Db, Promise<ResetPlan>>();

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const literal = (name: string): string => `'${name.replaceAll("'", "''")}'`;

async function assertTestDatabase(db: Db): Promise<void> {
  const {
    rows: [{ current_database: database }],
  } = await db.query<{ current_database: string }>("SELECT current_database()");
  if (!/_test(_\d+)?$/.test(database)) {
    throw new Error(`Refusing to truncate "${database}": not a _test database`);
  }
}

/**
 * Orders the tables so that a table comes before every table it references (a self-reference does
 * not count: one `DELETE` removes the parent and its children together). Returns `null` on a cycle
 * between tables: the caller then truncates everything, as before.
 */
export function deleteOrder(
  tables: readonly string[],
  references: readonly { child: string; parent: string }[],
): string[] | null {
  const children = new Map(tables.map((table) => [table, new Set<string>()]));
  for (const { child, parent } of references) {
    if (child !== parent) children.get(parent)?.add(child);
  }
  const order: string[] = [];
  const state = new Map<string, "open" | "done">();
  const visit = (table: string): boolean => {
    const seen = state.get(table);
    if (seen === "done") return true;
    if (seen === "open") return false;
    state.set(table, "open");
    for (const child of children.get(table) ?? []) if (!visit(child)) return false;
    state.set(table, "done");
    order.push(table);
    return true;
  };
  for (const table of tables) if (!visit(table)) return null;
  // `visit` pushes a parent after all its children: that is already the order of the deletes.
  return order;
}

async function readPlan(db: Db): Promise<ResetPlan> {
  const { rows: tables } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const { rows: references } = await db.query<{ child: string; parent: string }>(
    `SELECT child.relname AS child, parent.relname AS parent
       FROM pg_constraint
       JOIN pg_class child ON child.oid = pg_constraint.conrelid
       JOIN pg_class parent ON parent.oid = pg_constraint.confrelid
      WHERE pg_constraint.contype = 'f' AND pg_constraint.connamespace = 'public'::regnamespace`,
  );
  const names = tables.map((row) => row.tablename);
  const order = deleteOrder(names, references);
  return {
    filled:
      names.length === 0
        ? null
        : names
            .map((name) => `SELECT ${literal(name)} AS name WHERE EXISTS (SELECT FROM ${quote(name)})`)
            .join(" UNION ALL "),
    order: order ?? [],
  };
}

async function truncateEverything(db: Db): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => quote(row.tablename)).join(", ");
  await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

/**
 * Empties every table of the public schema and restarts its sequences; drizzle's journal lives in
 * the `drizzle` schema and stays. The end state is the one of `TRUNCATE … RESTART IDENTITY` on all
 * the tables, but only the tables that have rows are touched, with `DELETE`: a test fills a few of
 * the ~100 tables, and a `TRUNCATE` of all of them costs ~90 ms, once per test.
 */
export async function truncateAllTables(db: Db): Promise<void> {
  await assertTestDatabase(db);
  let plan = plans.get(db);
  if (!plan) {
    plan = readPlan(db);
    plans.set(db, plan);
  }
  const { filled, order } = await plan;
  if (filled === null) return;
  if (order.length === 0) return truncateEverything(db);

  const { rows } = await db.query<{ name: string }>(filled);
  const dirty = new Set(rows.map((row) => row.name));
  // One simple query: Postgres runs its statements in one implicit transaction, all or nothing.
  const deletes = order.filter((table) => dirty.has(table)).map((table) => `DELETE FROM ${quote(table)};`);
  await db.query(
    `${deletes.join(" ")}
     DO $restart$
     DECLARE name text;
     BEGIN
       FOR name IN SELECT format('%I.%I', schemaname, sequencename) FROM pg_sequences
                    WHERE schemaname = 'public' AND last_value IS NOT NULL LOOP
         EXECUTE 'ALTER SEQUENCE ' || name || ' RESTART';
       END LOOP;
     END
     $restart$;`,
  );
}
