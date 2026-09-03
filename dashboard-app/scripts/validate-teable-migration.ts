import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { loadAccounts } from "@/app/(app)/_lib/accounts";
import { toCents } from "@/lib/calc/money";
import type { MonthPoint } from "@/lib/contracts";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { userRoles, users } from "@/lib/db/schema";
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
 */

const MONTHS = 24;

const USAGE = `Usage: npm run migrate:teable:validate

Compares the legacy net-worth series with the migrated one, month by month,
writes docs/migration/teable-reconciliation.md and exits 1 on any difference.

Environment:
  DATABASE_URL        The database to read both series from (required).
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

const principal = await withSystemContext(db, ownerPrincipal);

const legacy = await loadAccounts(MONTHS);
const migrated = await withUserContext(db, { userId: principal.userId }, (tx) =>
  netWorthSeries(readOnlyDeps(tx))(principal, MONTHS),
);

const before = centsByMonth(legacy.total.points);
const after = centsByMonth(migrated.total);
const months = [...new Set([...before.keys(), ...after.keys()])].sort();

interface Row {
  month: string;
  legacy: number | null | undefined;
  migrated: number | null | undefined;
  difference: number | null;
  matches: boolean;
}

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

/** Two gaps are not a difference; a gap facing a figure has no numeric one. */
function differenceLabel(r: Row): string {
  if (r.difference !== null) return show(r.difference);
  return r.matches ? "—" : "gap";
}

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

process.exit(mismatches.length === 0 ? 0 : 1);
