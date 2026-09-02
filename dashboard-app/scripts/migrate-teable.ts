import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { listAllocationRecords, pivotToSeries } from "@/lib/clients/teable";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";
import { balanceSnapshots, funds, trackedAccounts, userRoles, users } from "@/lib/db/schema";
import { romeDate } from "@/lib/time";
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import { planTeableImport } from "@/modules/accounts/infrastructure/teable-import";
import type { NewBalance } from "@/modules/accounts/application/ports";
import { withSystemContext } from "@/platform/db/context";

/**
 * One-shot import of the legacy world into the accounts module.
 *
 * It reads the Teable Allocation table, snapshots it to `docs/migration/` so the
 * import can be re-checked (or replayed) long after Teable is switched off,
 * plans the accounts and balances with `planTeableImport`, and writes them.
 *
 * Idempotent: accounts are matched by name (case-insensitively) and reused
 * rather than duplicated, and balances upsert on `(account, day, source)`. Run
 * it twice and the second run reports every account reused and rewrites the
 * same figures.
 */

const USAGE = `Usage: npm run migrate:teable [-- --dry-run]

Imports the Teable Allocation table and the cached Wallet balances into the
accounts module, for the single owner user.

Options:
  --dry-run   Read everything, write the JSON export and print the plan, but
              leave the database untouched.
  --help      Show this message.

Environment:
  TEABLE_URL, TEABLE_TOKEN   The Allocation table to read (required).
  DATABASE_URL               The database to import into (required).
  MIGRATION_OUT_DIR          Where the JSON export is written. Defaults to the
                             repository's docs/migration/ directory, which does
                             not exist inside the container image.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const dryRun = argv.includes("--dry-run");

const unknown = argv.filter((a) => !["--dry-run", "--help", "-h"].includes(a));
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}\n\n${USAGE}`);
  process.exit(2);
}

/**
 * Fail before the first request rather than half-way through: a missing token
 * would otherwise surface as an opaque upstream 401 after the run has already
 * started reading.
 */
const missing = ["TEABLE_URL", "TEABLE_TOKEN", "DATABASE_URL"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}\n\n${USAGE}`);
  process.exit(1);
}

const outDir =
  process.env.MIGRATION_OUT_DIR ?? fileURLToPath(new URL("../../docs/migration/", import.meta.url));

async function resolveOwner(tx: DbClient): Promise<{ id: string }> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, "owner"), eq(users.status, "active")))
    .limit(2);
  if (rows.length === 0) throw new Error("No active user holds the owner role — run the migrations first");
  if (rows.length > 1) throw new Error("More than one active owner: refusing to guess which one to import into");
  return rows[0]!;
}

const records = await listAllocationRecords();
const points = pivotToSeries(records);

mkdirSync(outDir, { recursive: true });
const exportPath = join(outDir, `teable-allocation-${romeDate(new Date())}.json`);
writeFileSync(
  exportPath,
  `${JSON.stringify({ exportedAt: new Date().toISOString(), records, points }, null, 2)}\n`,
);
console.log(`Exported ${records.length} Teable record(s) and ${points.length} point(s) to ${exportPath}`);

const legacy = await withSystemContext(db, async (tx) => ({
  owner: await resolveOwner(tx),
  tracked: await tx
    .select({
      slug: trackedAccounts.slug,
      label: trackedAccounts.label,
      sortOrder: trackedAccounts.sortOrder,
      visible: trackedAccounts.visible,
    })
    .from(trackedAccounts)
    .orderBy(asc(trackedAccounts.sortOrder), asc(trackedAccounts.slug)),
  funds: await tx.select({ slug: funds.slug, name: funds.name }).from(funds).orderBy(asc(funds.id)),
  // Ascending so "the last row of a day wins" is decided on the capture order
  // the table itself recorded.
  walletSnapshots: await tx
    .select({
      accountKey: balanceSnapshots.accountKey,
      balance: balanceSnapshots.balance,
      capturedAt: balanceSnapshots.capturedAt,
    })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.source, "wallet"))
    .orderBy(asc(balanceSnapshots.capturedAt)),
}));

const plan = planTeableImport({
  userId: legacy.owner.id,
  tracked: legacy.tracked,
  funds: legacy.funds,
  points,
  walletSnapshots: legacy.walletSnapshots,
});

console.log(
  `Planned ${plan.accounts.length} account(s) and ${plan.balances.length} balance(s); skipped ${plan.skipped.length} key(s)`,
);
for (const account of plan.accounts) console.log(`  account ${account.key} -> "${account.name}" (${account.type})`);
for (const s of plan.skipped) console.log(`  skipped ${s.key}: ${s.reason}`);

if (dryRun) {
  console.log("Dry run: nothing was written to the database.");
  process.exit(0);
}

/** Comfortably under Postgres' bind-parameter ceiling, whatever the history's size. */
const BATCH = 500;

const result = await withSystemContext(db, async (tx) => {
  const repo = new DrizzleAccountsRepository(tx);
  const existing = await repo.list(legacy.owner.id, { includeArchived: true });
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a.id]));

  const idByKey = new Map<string, string>();
  let created = 0;
  let reused = 0;

  for (const account of plan.accounts) {
    const hit = byName.get(account.name.toLowerCase());
    if (hit) {
      idByKey.set(account.key, hit);
      reused += 1;
      continue;
    }
    const row = await repo.create({
      userId: legacy.owner.id,
      groupId: null,
      name: account.name,
      type: account.type,
      currency: "EUR",
      origin: account.origin,
      provider: null,
      status: "active",
      includeInNetWorth: account.includeInNetWorth,
      notes: null,
      sortOrder: account.sortOrder,
    });
    byName.set(row.name.toLowerCase(), row.id);
    idByKey.set(account.key, row.id);
    created += 1;
  }

  // `capturedAt` is the day the figure is true for, not the moment of the
  // import: stamping the whole history with "now" would make a 2024 balance
  // look freshly captured everywhere staleness is judged.
  const rows: NewBalance[] = plan.balances.map((b) => ({
    accountId: idByKey.get(b.key)!,
    asOf: b.asOf,
    balance: b.balance,
    available: null,
    source: b.source,
    capturedAt: new Date(`${b.asOf}T00:00:00Z`),
  }));
  for (let i = 0; i < rows.length; i += BATCH) await repo.recordBalances(rows.slice(i, i + BATCH));

  return { accounts: { created, reused }, balances: rows.length, skipped: plan.skipped };
});

console.log(JSON.stringify(result, null, 2));
process.exit(0);
