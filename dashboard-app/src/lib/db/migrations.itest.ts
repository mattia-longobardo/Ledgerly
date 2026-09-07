import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, testDb } from "@/test/db";

/** Created by `0018_timeoff_and_drop_legacy.sql`. */
const TIMEOFF_TABLES = ["timeoff_types", "timeoff_balances", "timeoff_events"];

/** Dropped by the same migration, in R7-5' order. */
const DROPPED_LEGACY_TABLES = [
  "fund_deposits",
  "fund_settings",
  "legacy_funds",
  "payslips",
  "vacation_ledger",
  "vacation_accrual_rate",
  "leave_days",
  "balance_snapshots",
];

describe("migrations", () => {
  afterAll(closeDb);

  it("apply on an empty database, create the timeoff tables and leave no legacy table behind", async () => {
    const db = await testDb();
    const res = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
    const names = res.rows.map((r) => r.table_name);

    expect(names).toEqual(expect.arrayContaining([...TIMEOFF_TABLES, "funds", "job_runs", "app_settings"]));
    for (const dropped of DROPPED_LEGACY_TABLES) {
      expect(names).not.toContain(dropped);
    }
  });
});
