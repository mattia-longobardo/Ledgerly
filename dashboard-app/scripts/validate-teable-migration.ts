import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toCents, fromCents } from "@/lib/calc/money";
import { netWorth, type NetWorthContributor } from "@/lib/calc/networth";
import type { MonthPoint } from "@/lib/contracts";
import * as schema from "@/lib/db/schema";
import type { DbClient } from "@/lib/db/client";
import { userRoles, users } from "@/lib/db/schema";
import { monthlyHistoryQuery } from "@/lib/repo/balances";
import { addMonths, monthKey } from "@/lib/time";
import type { UseCaseDeps } from "@/modules/accounts/application/deps";
import { netWorthSeries } from "@/modules/accounts/application/net-worth-series";
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import { DrizzleGroupsRepository } from "@/modules/accounts/infrastructure/drizzle-groups-repository";
import { DrizzleProviderLinksRepository } from "@/modules/accounts/infrastructure/drizzle-provider-links-repository";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext, withUserContext } from "@/platform/db/context";

/**
 * Reconciles the imported accounts against the legacy net-worth series.
 *
 * The two are computed the same day, from the same database, over the same 24
 * months: the legacy figure out of `balance_snapshots` and the new one out of
 * `account_balances`. Any month where they disagree by a single cent is a
 * migration defect and fails the run, because after Teable is switched off the
 * legacy series is gone and there is nothing left to compare against.
 *
 * Deliberately does not import `db` from `@/lib/db`: that module is a Proxy
 * whose first property access calls `env()`, which requires the whole app's
 * environment (`AUTH_*`, `OIDC_*`, `PAPERLESS_*`, ...) — none of which this
 * one-off script needs or should be made to depend on. It builds its own
 * client from `DATABASE_URL` alone, exactly like `src/lib/db/migrate.ts`
 * does, so it runs with nothing but `DATABASE_URL` set. `monthlyHistoryQuery`
 * is imported from `@/lib/repo/balances` for its pure SQL-builder only — that
 * module also imports `db` from `@/lib/db` at its own top level, but never
 * touches it except inside functions this script never calls, so importing
 * it does not by itself reach `env()`.
 */

const MONTHS = 24;

/**
 * The four accounts the app itself managed, plus the five the owner used to
 * type in by hand. This is the same set `src/app/(app)/_lib/accounts.ts`
 * (deleted along with Teable) read before it was retired — and the same five
 * hand-tracked keys the export written by `migrate-teable.ts` carries. Fixed
 * here rather than read from a `tracked_accounts` registry because that
 * table went with the rest of the retirement migration.
 */
const APP_MANAGED_KEYS = ["fideuram", "cometa", "ing", "revolut_total"] as const;
const HAND_TRACKED_KEYS = ["etoro", "buddy_bank", "isybank", "mediolanum", "binance"] as const;
const LEGACY_KEYS = [...APP_MANAGED_KEYS, ...HAND_TRACKED_KEYS];

interface LegacyLatest extends Record<string, unknown> {
  accountKey: string;
  balance: string;
  capturedAt: Date;
}

interface LegacyMonthly extends Record<string, unknown> {
  accountKey: string;
  month: string;
  balance: string;
}

/**
 * The legacy net-worth series, computed straight from `balance_snapshots`
 * exactly as the deleted `_lib/accounts.ts` loader did: one point per account
 * per month (the last snapshot within the month, carried forward across
 * gaps), reconciled against the newest snapshot for the current month so a
 * same-month correction is never shadowed by a stale history row, then summed
 * across the four managed accounts and the five hand-tracked ones.
 */
export async function legacySeriesFromSnapshots(
  dbClient: DbClient,
  months: number,
): Promise<{ total: { points: MonthPoint[] } }> {
  const since = addMonths(monthKey(new Date()), -(months - 1));

  const latestResult = await dbClient.execute<LegacyLatest>(sql`
    SELECT DISTINCT ON (account_key)
      account_key AS "accountKey",
      balance,
      captured_at AS "capturedAt"
    FROM balance_snapshots
    WHERE account_key IN (${sql.join(
      LEGACY_KEYS.map((k) => sql`${k}`),
      sql`, `,
    )})
    ORDER BY account_key, captured_at DESC
  `);
  const monthlyResult = await dbClient.execute<LegacyMonthly>(monthlyHistoryQuery([...LEGACY_KEYS], since));

  const pointsByKey = new Map<string, MonthPoint[]>();
  for (const row of monthlyResult.rows) {
    const list = pointsByKey.get(row.accountKey) ?? [];
    list.push({ month: row.month, value: fromCents(toCents(row.balance)) });
    pointsByKey.set(row.accountKey, list);
  }
  for (const list of pointsByKey.values()) list.sort((a, b) => (a.month < b.month ? -1 : 1));

  // The current month's authoritative value is the latest snapshot, not
  // whatever `monthlyHistoryQuery`'s tie-break happened to pick for it — see
  // the long comment on that function for why the two can disagree.
  for (const row of latestResult.rows) {
    const list = pointsByKey.get(row.accountKey);
    if (!list) continue;
    const month = monthKey(new Date(row.capturedAt));
    const point = list.find((p) => p.month === month);
    if (point) point.value = fromCents(toCents(row.balance));
  }

  const latestByKey = new Map(latestResult.rows.map((r) => [r.accountKey, r]));
  const contributors: NetWorthContributor[] = LEGACY_KEYS.map((key) => {
    const latest = latestByKey.get(key);
    return {
      key,
      balance: latest?.balance ?? null,
      capturedAt: latest ? new Date(latest.capturedAt) : null,
      points: pointsByKey.get(key) ?? [],
    };
  });

  return { total: { points: netWorth(contributors).points } };
}

const USAGE = `Usage: npm run migrate:teable:validate

Compares the legacy net-worth series with the migrated one, month by month,
writes docs/migration/teable-reconciliation.md and exits 1 on any difference.

Environment:
  DATABASE_URL        The database to read both series from (required). This
                      is the only application env var this script needs.
  MIGRATION_OUT_DIR   Where the reconciliation report is written. Defaults to
                      the repository's docs/migration/ directory, which does not
                      exist inside the container image.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error(`Missing required environment variable: DATABASE_URL\n\n${USAGE}`);
  process.exit(1);
}

const outDir =
  process.env.MIGRATION_OUT_DIR ?? fileURLToPath(new URL("../../docs/migration/", import.meta.url));

async function ownerPrincipal(tx: DbClient): Promise<Principal> {
  const rows = await tx
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, "owner"), eq(users.status, "active")))
    .limit(2);
  if (rows.length === 0) throw new Error("No active user holds the owner role");
  if (rows.length > 1) throw new Error("More than one active owner: refusing to guess whose net worth to check");
  const owner = rows[0]!;
  return {
    userId: owner.id,
    organizationId: owner.organizationId,
    roles: ["owner"],
    permissions: permissionsForRoles(["owner"]),
  };
}

function centsByMonth(points: readonly MonthPoint[]): Map<string, number | null> {
  return new Map(points.map((p) => [p.month, p.value === null ? null : toCents(p.value)]));
}

/** Euro with two decimals, or a dash when the month is a genuine gap. */
function show(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The same assembly `accountDeps` makes, minus the audit sink: that module
 * reaches the Auth.js session helpers, and dragging the whole Next request
 * pipeline into a CLI script breaks the esbuild bundle the image ships. Nothing
 * here writes, so there is no event to record either.
 */
function readOnlyDeps(tx: DbClient): UseCaseDeps {
  return {
    accounts: new DrizzleAccountsRepository(tx),
    links: new DrizzleProviderLinksRepository(tx),
    groups: new DrizzleGroupsRepository(tx),
    clock: { now: () => new Date() },
    audit: async () => {},
  };
}

interface Row {
  month: string;
  legacy: number | null | undefined;
  migrated: number | null | undefined;
  difference: number | null;
  matches: boolean;
}

/** Two gaps are not a difference; a gap facing a figure has no numeric one. */
function differenceLabel(r: Row): string {
  if (r.difference !== null) return show(r.difference);
  return r.matches ? "—" : "gap";
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = drizzle(pool, { schema });

let exitCode = 0;
try {
  const principal = await withSystemContext(db, ownerPrincipal);

  const legacy = await legacySeriesFromSnapshots(db, MONTHS);
  const migrated = await withUserContext(db, { userId: principal.userId }, (tx) =>
    netWorthSeries(readOnlyDeps(tx))(principal, MONTHS),
  );

  const before = centsByMonth(legacy.total.points);
  const after = centsByMonth(migrated.total);
  const months = [...new Set([...before.keys(), ...after.keys()])].sort();

  const rows: Row[] = months.map((month) => {
    const a = before.get(month);
    const b = after.get(month);
    // A month that is a gap on one side and a figure on the other is a mismatch
    // even when the figure happens to be zero: the two series disagree about
    // whether anything is known at all.
    const matches = (a ?? null) === (b ?? null);
    const difference = a === null || a === undefined || b === null || b === undefined ? null : b - a;
    return { month, legacy: a, migrated: b, difference, matches };
  });

  const mismatches = rows.filter((r) => !r.matches);

  const header = `${"month".padEnd(12)}${"legacy".padStart(16)}${"migrated".padStart(16)}${"difference".padStart(16)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log(
      `${r.month.padEnd(12)}${show(r.legacy).padStart(16)}${show(r.migrated).padStart(16)}${differenceLabel(r).padStart(16)}`,
    );
  }

  const verdict = mismatches.length === 0
    ? `Every one of the ${rows.length} months matches to the cent.`
    : `${mismatches.length} of ${rows.length} months differ: ${mismatches.map((r) => r.month).join(", ")}.`;
  console.log(`\n${verdict}`);

  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "teable-reconciliation.md");
  writeFileSync(
    reportPath,
    [
      "# Teable migration reconciliation",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      `Net worth over the last ${MONTHS} months, computed twice on the same database:`,
      "the legacy series from `balance_snapshots`, the migrated one from `account_balances`.",
      "",
      "| Month | Legacy | Migrated | Difference |",
      "| --- | ---: | ---: | ---: |",
      ...rows.map(
        (r) => `| ${r.month} | ${show(r.legacy)} | ${show(r.migrated)} | ${differenceLabel(r)} |`,
      ),
      "",
      verdict,
      "",
    ].join("\n"),
  );
  console.log(`Report written to ${reportPath}`);

  exitCode = mismatches.length === 0 ? 0 : 1;
} finally {
  await pool.end();
}

process.exit(exitCode);
