import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { DbClient } from "@/lib/db/client";
import { balanceSnapshots, legacyFunds, userRoles, users } from "@/lib/db/schema";
import { romeDate } from "@/lib/time";
import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import {
  pivotExportedRecords,
  planTeableImport,
  type ExportedPoint,
  type ExportedRecord,
} from "@/modules/accounts/infrastructure/teable-import";
import type { NewBalance } from "@/modules/accounts/application/ports";
import { withSystemContext } from "@/platform/db/context";

/**
 * One-shot import of the legacy world into the accounts module.
 *
 * `src/lib/clients/teable.ts` — the live Allocation-table client — is gone
 * along with the rest of the Teable integration, so this script now reads
 * from the JSON export written by an earlier run of itself
 * (`docs/migration/teable-allocation-*.json`, `--from <path>`) rather than
 * calling the API directly. A live read is still possible, but only as a
 * fallback, and only when `TEABLE_URL`/`TEABLE_TOKEN` happen to be set in the
 * environment this script runs in — those variables were removed from the
 * app's own configuration, so this is for a one-off re-run against a still-
 * reachable instance, not the normal path.
 *
 * Idempotent: accounts are matched by name (case-insensitively) and reused
 * rather than duplicated, and balances upsert on `(account, day, source)`. Run
 * it twice and the second run reports every account reused and rewrites the
 * same figures.
 *
 * Deliberately does not import `db` from `@/lib/db`: that module is a Proxy
 * whose first property access calls `env()`, which requires the whole app's
 * environment (`AUTH_*`, `OIDC_*`, `PAPERLESS_*`, ...) — none of which this
 * one-off script needs or should be made to depend on. It builds its own
 * client from `DATABASE_URL` alone, exactly like `src/lib/db/migrate.ts`
 * does, so it runs with nothing but `DATABASE_URL` set (plus `TEABLE_URL`/
 * `TEABLE_TOKEN` for the live-fetch fallback).
 */

const USAGE = `Usage: npm run migrate:teable -- --from <export.json> [--dry-run]
       npm run migrate:teable -- --dry-run   (live read, needs TEABLE_URL/TEABLE_TOKEN)

Imports a previously exported Allocation table (or, failing that, a live read)
and the cached Wallet balances into the accounts module, for the single owner
user.

Options:
  --from <path>  Read the JSON export written by an earlier run of this script
                 instead of contacting Teable. Recommended: the live client no
                 longer exists in this codebase.
  --dry-run      Read everything, write the JSON export (live-read mode only)
                 and print the plan, but leave the database untouched.
  --help         Show this message.

Environment:
  DATABASE_URL               The database to import into (required). This is
                             the only application env var this script needs.
  TEABLE_URL, TEABLE_TOKEN   Only consulted when --from is omitted.
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
const fromIndex = argv.indexOf("--from");
const fromPath = fromIndex === -1 ? null : (argv[fromIndex + 1] ?? null);
if (fromIndex !== -1 && fromPath === null) {
  console.error(`--from requires a path\n\n${USAGE}`);
  process.exit(2);
}

const unknown = argv.filter((a, i) => {
  if (["--dry-run", "--help", "-h", "--from"].includes(a)) return false;
  if (fromIndex !== -1 && i === fromIndex + 1) return false; // the --from value
  return true;
});
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}\n\n${USAGE}`);
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error(`Missing required environment variable: DATABASE_URL\n\n${USAGE}`);
  process.exit(1);
}

const outDir =
  process.env.MIGRATION_OUT_DIR ?? fileURLToPath(new URL("../../docs/migration/", import.meta.url));

interface ExportFile {
  exportedAt: string;
  records: ExportedRecord[];
  points: ExportedPoint[];
}

/** A minimal, paginated read of the live Allocation table — no client left to reuse. */
async function fetchLiveRecords(): Promise<ExportedRecord[]> {
  const baseUrl = process.env.TEABLE_URL?.replace(/\/+$/, "");
  const token = process.env.TEABLE_TOKEN;
  const tableId = process.env.TEABLE_TABLE_ID ?? "tblSgA94MQaiutzohCC";
  if (!baseUrl || !token) {
    throw new Error(
      "No --from export given and TEABLE_URL/TEABLE_TOKEN are not set — nothing to read from",
    );
  }

  const take = 1000;
  const out: ExportedRecord[] = [];
  for (let page = 0; page < 200; page += 1) {
    const qs = new URLSearchParams({ take: String(take), skip: String(page * take), fieldKeyType: "name" });
    const res = await fetch(`${baseUrl}/api/table/${tableId}/record?${qs}`, {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok) throw new Error(`Teable record list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { records: ExportedRecord[] };
    out.push(...body.records);
    if (body.records.length < take) break;
  }
  return out;
}

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

let points: ExportedPoint[];
let recordCount: number;

if (fromPath) {
  const exported = JSON.parse(readFileSync(fromPath, "utf8")) as ExportFile;
  points = exported.points ?? pivotExportedRecords(exported.records);
  recordCount = exported.records.length;
  console.log(`Read ${recordCount} record(s) and ${points.length} point(s) from ${fromPath}`);
} else {
  const records = await fetchLiveRecords();
  points = pivotExportedRecords(records);
  recordCount = records.length;

  mkdirSync(outDir, { recursive: true });
  const exportPath = join(outDir, `teable-allocation-${romeDate(new Date())}.json`);
  writeFileSync(
    exportPath,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), records, points }, null, 2)}\n`,
  );
  console.log(`Exported ${records.length} Teable record(s) and ${points.length} point(s) to ${exportPath}`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = drizzle(pool, { schema });

try {
  const legacy = await withSystemContext(db, async (tx) => ({
    owner: await resolveOwner(tx),
    funds: await tx.select({ slug: legacyFunds.slug, name: legacyFunds.name }).from(legacyFunds).orderBy(asc(legacyFunds.id)),
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

  // The `tracked_accounts` registry was retired along with Teable; the export
  // this script now reads was written while it still existed, so its own
  // `points` already reflect every hand-tracked column. Nothing here relies on
  // re-reading a registry the database no longer has.
  const plan = planTeableImport({
    userId: legacy.owner.id,
    tracked: [],
    funds: legacy.funds,
    points,
    walletSnapshots: legacy.walletSnapshots,
    today: romeDate(new Date()),
  });

  console.log(
    `Planned ${plan.accounts.length} account(s) and ${plan.balances.length} balance(s); skipped ${plan.skipped.length} key(s)`,
  );
  for (const account of plan.accounts) console.log(`  account ${account.key} -> "${account.name}" (${account.type})`);
  for (const s of plan.skipped) console.log(`  skipped ${s.key}: ${s.reason}`);

  if (dryRun) {
    console.log("Dry run: nothing was written to the database.");
  } else {
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
  }
} finally {
  await pool.end();
}

process.exit(0);
