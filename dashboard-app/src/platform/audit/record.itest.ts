import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { recordAudit } from "./record";

describe("recordAudit", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("writes one row with before/after", async () => {
    const db = await testDb();
    // `audit_events` carries FORCE ROW LEVEL SECURITY since migration 0009.
    // Every real caller already runs inside a user or system context (see
    // `accountDeps` and `wallet-accounts-sync.ts`); this null-actor write is
    // system-attributed, so it belongs in a system context too.
    await withSystemContext(db, (tx) =>
      recordAudit(tx, {
        actorUserId: null,
        action: "account.create",
        entityType: "account",
        entityId: "a1",
        after: { name: "Cash" },
      }),
    );
    const rows = await withSystemContext(db, (tx) => tx.select().from(auditEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toEqual({ name: "Cash" });
  });
});
