import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents } from "@/lib/db/schema";
import { recordAudit } from "./record";

describe("recordAudit", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("writes one row with before/after", async () => {
    const db = await testDb();
    await recordAudit(db, {
      actorUserId: null,
      action: "account.create",
      entityType: "account",
      entityId: "a1",
      after: { name: "Cash" },
    });
    const rows = await db.select().from(auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toEqual({ name: "Cash" });
  });
});
