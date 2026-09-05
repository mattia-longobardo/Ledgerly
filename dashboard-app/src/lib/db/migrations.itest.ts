import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, testDb } from "@/test/db";

describe("migrations", () => {
  afterAll(closeDb);
  it("apply on an empty database and create the legacy tables", async () => {
    const db = await testDb();
    const res = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
    const names = res.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(["funds", "payslips", "job_runs", "leave_days"]));
  });
});
