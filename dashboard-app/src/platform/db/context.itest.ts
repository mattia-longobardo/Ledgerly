import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, testDb } from "@/test/db";
import { withSystemContext, withUserContext } from "./context";

describe("withUserContext", () => {
  afterAll(closeDb);
  it("sets app.user_id for the transaction only", async () => {
    const db = await testDb();
    const uid = "00000000-0000-7000-8000-000000000001";
    const inside = await withUserContext(db, { userId: uid }, async (tx) => {
      const r = await tx.execute<{ v: string }>(sql`SELECT current_setting('app.user_id', true) AS v`);
      return r.rows[0]?.v;
    });
    expect(inside).toBe(uid);
    const outside = await db.execute<{ v: string | null }>(sql`SELECT current_setting('app.user_id', true) AS v`);
    expect(outside.rows[0]?.v ?? "").toBe("");
    const role = await withSystemContext(db, async (tx) => {
      const r = await tx.execute<{ v: string }>(sql`SELECT current_setting('app.role', true) AS v`);
      return r.rows[0]?.v;
    });
    expect(role).toBe("system");
  });
});
