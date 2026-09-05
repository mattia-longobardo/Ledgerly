import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { balanceSnapshots } from "@/lib/db/schema";
import type { AccountKey, SourceKind } from "@/lib/contracts";

export interface SnapshotInput {
  source: SourceKind;
  accountKey: AccountKey | string;
  balance: string | number;
  raw?: unknown;
  capturedAt?: Date;
}

export async function recordSnapshots(rows: SnapshotInput[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(balanceSnapshots).values(
    rows.map((r) => ({
      source: r.source,
      accountKey: r.accountKey,
      balance: String(r.balance),
      raw: r.raw ?? null,
      ...(r.capturedAt ? { capturedAt: r.capturedAt } : {}),
    })),
  );
}

export interface LatestBalance extends Record<string, unknown> {
  accountKey: string;
  source: string;
  balance: string;
  capturedAt: Date;
}

/** One row per account: the newest snapshot. DISTINCT ON keeps it a single scan. */
export async function latestBalances(keys?: string[]): Promise<LatestBalance[]> {
  const filter = keys?.length
    ? sql`WHERE account_key IN (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : sql``;

  const result = await db.execute<LatestBalance>(sql`
    SELECT DISTINCT ON (account_key)
      account_key AS "accountKey",
      source,
      balance,
      captured_at AS "capturedAt"
    FROM balance_snapshots
    ${filter}
    ORDER BY account_key, captured_at DESC
  `);
  return result.rows;
}

/** Monthly history for charts: the last snapshot within each month. */
interface MonthlyRow extends Record<string, unknown> {
  accountKey: string;
  month: string;
  balance: string;
}

/**
 * One value per account per month, and WHICH value is the whole subtlety.
 *
 * This is a frozen read of history the old sweep job wrote before it was
 * retired (see `docs/migration/`): it used to write two kinds of row for the
 * hand-typed accounts. A `kind:'latest'` row was stamped `now` and held "the
 * newest non-null spreadsheet cell as of this hour"; a `kind:'history'` row
 * was stamped at the first instant of the month it belonged to. So for any
 * month that old job was running through, the hourly `latest` row is always
 * the more recent of the two — and picking by `captured_at` alone would show
 * the carried-forward figure for ever, never the real one. The owner filled a
 * month's cell after the month had closed, so that carried-forward figure was
 * the PREVIOUS month's number, and a correction typed in by hand could never
 * surface. Hence the first sort key: a `latest` row is the fallback of last
 * resort, used only when the month has nothing else.
 *
 * `COALESCE(raw->>'kind','')` rather than a bare comparison because wallet rows
 * carry no `raw` at all: `raw->>'kind'` is NULL for them, and a NULL boolean
 * sorts LAST under ASC (checked against Postgres, not assumed), which would put
 * a real wallet reading BELOW a hand-typed `latest` row — the opposite of
 * intent. Coalesced to `''` every non-`latest` row — history and wallet alike —
 * ranks above `latest`, and within that rank `captured_at DESC` still applies,
 * so a genuine wallet reading taken during the month beats a backfilled
 * figure, which is what keeps Wallet authoritative for the months it was
 * running for. (In practice the old job wrote `latest` rows only for the
 * columns it managed itself, so this demotion decides Fideuram and Cometa and
 * leaves ING and Revolut exactly as they were.)
 *
 * `id DESC` then breaks the remaining tie, which only ever happens between two
 * backfill rows: they share `monthStartInstant`, so a correction and the figure
 * it corrects arrive at the same instant and only the insert order tells them
 * apart.
 */
export async function monthlyHistory(keys: string[], since?: string): Promise<MonthlyRow[]> {
  if (keys.length === 0) return [];
  const result = await db.execute<MonthlyRow>(monthlyHistoryQuery(keys, since));
  return result.rows;
}

/**
 * Split out from the call above so the ordering can be asserted without a
 * database: the unit suite has no Postgres, and the bug this guards against was
 * a wrong ORDER BY, not a wrong result set. The clause order IS the behaviour.
 */
export function monthlyHistoryQuery(keys: string[], since?: string) {
  const sinceFilter = since ? sql`AND captured_at >= ${`${since}T00:00:00Z`}` : sql``;
  return sql`
    SELECT DISTINCT ON (account_key, month)
      account_key AS "accountKey",
      to_char(date_trunc('month', captured_at AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-01') AS month,
      balance
    FROM balance_snapshots
    WHERE account_key IN (${sql.join(
      keys.map((k) => sql`${k}`),
      sql`, `,
    )})
    ${sinceFilter}
    ORDER BY account_key, month,
             (COALESCE(raw->>'kind', '') = 'latest') ASC,
             captured_at DESC, id DESC
  `;
}

export async function snapshotsSince(key: string, since: Date) {
  return db
    .select()
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountKey, key), gte(balanceSnapshots.capturedAt, since)))
    .orderBy(desc(balanceSnapshots.capturedAt));
}

export { inArray };
