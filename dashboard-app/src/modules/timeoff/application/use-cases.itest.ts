/**
 * The timeoff use cases against real Postgres.
 *
 * The reduced Phase 7 keeps no memory repositories, so this file IS the
 * repository proof as well as the use-case proof: every assertion below runs
 * through `timeoffDeps(tx)` inside the owner's RLS context, against the
 * Drizzle repositories and the real constraints.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  auditEvents,
  organizations,
  payrollImports,
  payrollRecords,
  providerLinks,
  timeoffEvents,
  users,
} from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { testPrincipal } from "@/test/principal";
import { payrollTimeoffBalanceSink } from "../infrastructure/payroll-balance-sink";
import { timeoffDeps } from "../infrastructure/deps";
import { ensureDefaultTypes } from "./ensure-default-types";
import { getWorkspace } from "./get-workspace";
import { removeEvent } from "./remove-event";
import { setEvent } from "./set-event";

const principal = testPrincipal();

// 2026-03-07 is a Saturday; 2026-03-02 and 2026-03-03 are Mondays/Tuesdays.
const MONDAY = "2026-03-02";
const TUESDAY = "2026-03-03";
const SATURDAY = "2026-03-07";

async function seed() {
  const db = await testDb();
  await db.insert(organizations).values({ id: principal.organizationId, name: "P" });
  await db.insert(users).values({
    id: principal.userId,
    organizationId: principal.organizationId,
    displayName: "Owner",
  });
  return db;
}

type Db = Awaited<ReturnType<typeof testDb>>;

function asOwner<T>(db: Db, fn: (deps: ReturnType<typeof timeoffDeps>, tx: Db) => Promise<T>): Promise<T> {
  return withUserContext(db, { userId: principal.userId }, (tx) =>
    fn(timeoffDeps(tx), tx as unknown as Db));
}

/** One applied payroll record, so the balance sink has something to hang a row on. */
let sha = 0;
async function aPayrollRecord(db: Db, periodEnd: string): Promise<string> {
  sha += 1;
  return withUserContext(db, { userId: principal.userId }, async (tx) => {
    const [imported] = await tx.insert(payrollImports).values({
      userId: principal.userId,
      status: "applied",
      fileName: "Busta Paga.pdf",
      sizeBytes: 100,
      // `payroll_imports_user_sha_uq`: a second seeded payslip needs its own digest.
      sha256: String(sha).padStart(64, "0"),
      storageProvider: "local",
      storageKey: `payroll/${sha}.pdf`,
      retentionUntil: new Date("2036-01-01T00:00:00Z"),
    }).returning();
    const [record] = await tx.insert(payrollRecords).values({
      userId: principal.userId,
      importId: imported!.id,
      periodStart: `${periodEnd.slice(0, 7)}-01`,
      periodEnd,
    }).returning();
    return record!.id;
  });
}

/** A day as Trek would have left it: origin `trek`, linked through `provider_links`. */
async function aTrekDay(db: Db, date: string, trekEntryId: number) {
  await asOwner(db, async (deps) => {
    const types = await ensureDefaultTypes(deps)(principal);
    const vacation = types.find((t) => t.code === "vacation")!;
    await deps.events.upsertFromProvider(
      principal.userId,
      [{ date, fraction: "1.00", typeId: vacation.id, trekEntryId, note: null }],
      new Date("2026-02-01T00:00:00Z"),
    );
  });
}

describe("timeoff use cases against real Postgres", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  describe("ensureDefaultTypes (R7-1)", () => {
    it("seeds the three default types with hours_per_day from settings", async () => {
      const db = await seed();
      const types = await asOwner(db, (deps) => ensureDefaultTypes(deps)(principal));
      expect(types.map((t) => t.code)).toEqual(["vacation", "permits", "comp"]);
      expect(types.map((t) => t.label)).toEqual(["Ferie", "ROL / permessi", "Recupero"]);
      expect(new Set(types.map((t) => t.hoursPerDay))).toEqual(new Set(["8.00"]));
    });

    it("is idempotent — a second call creates nothing", async () => {
      const db = await seed();
      const first = await asOwner(db, (deps) => ensureDefaultTypes(deps)(principal));
      const second = await asOwner(db, (deps) => ensureDefaultTypes(deps)(principal));
      expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    });

    it("survives two concurrent first touches of the same user", async () => {
      // The real race: the hourly Trek sync seeds inside `store.withEvents`
      // while a workspace load seeds in its own context. Check-then-insert
      // without ON CONFLICT kills the loser on `timeoff_types_user_code_uq`
      // and takes its whole transaction — an apply, or a sync pass — with it.
      const db = await seed();
      const [first, second] = await Promise.all([
        asOwner(db, (deps) => ensureDefaultTypes(deps)(principal)),
        asOwner(db, (deps) => ensureDefaultTypes(deps)(principal)),
      ]);
      expect(first.map((t) => t.code)).toEqual(["vacation", "permits", "comp"]);
      expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    });

    it("returns the winning row when its own insert was a no-op", async () => {
      const db = await seed();
      await asOwner(db, (deps) => ensureDefaultTypes(deps)(principal));
      const again = await asOwner(db, (deps) => deps.types.create({
        userId: principal.userId,
        code: "vacation",
        label: "Ferie (duplicate attempt)",
        unit: "hours",
        hoursPerDay: "8.00",
      }));
      // No throw, and the row that comes back is the one already there.
      expect(again.label).toBe("Ferie");
    });

    it("refuses a principal without timeoff.read", async () => {
      const db = await seed();
      await expect(asOwner(db, (deps) =>
        ensureDefaultTypes(deps)({ ...principal, permissions: new Set() }),
      )).rejects.toThrow(/permission/i);
    });
  });

  describe("getWorkspace balances (R7-4)", () => {
    it("shows null, not zero, while no payslip has been applied", async () => {
      const db = await seed();
      const workspace = await asOwner(db, (deps) =>
        getWorkspace(deps)(principal, { year: 2026, trekConnected: false, cachedStats: null }));

      expect(workspace.balances.map((b) => b.type.code)).toEqual(["vacation", "permits", "comp"]);
      for (const balance of workspace.balances) {
        expect(balance.remainingHours).toBeNull();
        expect(balance.remainingDays).toBeNull();
        expect(balance.usedYtdHours).toBeNull();
        expect(balance.asOf).toBeNull();
        expect(balance.source).toBeNull();
      }
    });

    it("converts the sink's hours into days with the type's own hours_per_day", async () => {
      const db = await seed();
      const recordId = await aPayrollRecord(db, "2026-08-31");
      await withUserContext(db, { userId: principal.userId }, (tx) =>
        payrollTimeoffBalanceSink(tx).writeForRecord({
          userId: principal.userId,
          payrollRecordId: recordId,
          supersededRecordId: null,
          asOf: "2026-08-31",
          rows: [
            { timeoffCode: "vacation", kind: "balance", quantity: "88.000000", unit: "hours" },
            { timeoffCode: "vacation", kind: "used", quantity: "16.000000", unit: "hours" },
            { timeoffCode: "sabbatical", kind: "balance", quantity: "8.00", unit: "hours" },
          ],
        }),
      );

      const workspace = await asOwner(db, (deps) =>
        getWorkspace(deps)(principal, { year: 2026, trekConnected: false, cachedStats: null }));
      const vacation = workspace.balances.find((b) => b.type.code === "vacation")!;
      expect(vacation).toMatchObject({
        asOf: "2026-08-31",
        remainingHours: "88.00",
        remainingDays: "11.00",
        usedYtdHours: "16.00",
        source: "payroll",
      });
      // A code this user has no type for is skipped, never invented.
      expect(workspace.balances.find((b) => b.type.code === "comp")?.remainingHours).toBeNull();
    });

    it("takes used from the LATEST payslip, never the sum of the year's", async () => {
      // The payslip's GOD. column is cumulative (see the comment in
      // `get-workspace.ts`): July reported 4,00 hours taken and August 12,01,
      // and the true year-to-date figure in August is 12,01 — not 16,01.
      const db = await seed();
      for (const [periodEnd, used, remaining] of [
        ["2026-07-31", "4.000000", "96.00"],
        ["2026-08-31", "12.010000", "88.00"],
      ] as const) {
        const recordId = await aPayrollRecord(db, periodEnd);
        await withUserContext(db, { userId: principal.userId }, (tx) =>
          payrollTimeoffBalanceSink(tx).writeForRecord({
            userId: principal.userId,
            payrollRecordId: recordId,
            supersededRecordId: null,
            asOf: periodEnd,
            rows: [
              { timeoffCode: "vacation", kind: "balance", quantity: remaining, unit: "hours" },
              { timeoffCode: "vacation", kind: "used", quantity: used, unit: "hours" },
            ],
          }),
        );
      }

      const workspace = await asOwner(db, (deps) =>
        getWorkspace(deps)(principal, { year: 2026, trekConnected: false, cachedStats: null }));
      const vacation = workspace.balances.find((b) => b.type.code === "vacation")!;
      expect(vacation).toMatchObject({
        asOf: "2026-08-31",
        remainingHours: "88.00",
        usedYtdHours: "12.01",
      });

      // Both rows are still there — the view picks one, it does not delete the
      // other, and `listForYear` is what a rebuilt variance table will read.
      const year = await asOwner(db, (deps) =>
        deps.balances.listForYear(principal.userId, 2026));
      expect(year.map((row) => [row.asOf, row.used])).toEqual([
        ["2026-07-31", "4.00"],
        ["2026-08-31", "12.01"],
      ]);
      expect(await asOwner(db, (deps) => deps.balances.listForYear(principal.userId, 2025)))
        .toEqual([]);
    });
  });

  describe("setEvent", () => {
    it("refuses a Saturday before it ever reaches Trek", async () => {
      const db = await seed();
      await expect(asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: SATURDAY, fraction: "1.00", typeCode: "vacation" }),
      )).rejects.toMatchObject({ name: "InvalidInputError" });
    });

    it("stages an upsert on a day Trek owns, keeping its origin and its entry id", async () => {
      const db = await seed();
      await aTrekDay(db, MONDAY, 4242);

      const saved = await asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: MONDAY, fraction: "0.50", typeCode: "comp", note: "mezza" }));

      expect(saved).toMatchObject({
        date: MONDAY,
        fraction: "0.50",
        typeCode: "comp",
        note: "mezza",
        // R7-3: the link survives an edit, so the next push knows which entry
        // upstream this day is.
        trekEntryId: 4242,
        origin: "trek",
        pendingOp: "upsert",
      });
    });

    it("stages a new manual day with no provider link at all", async () => {
      const db = await seed();
      const saved = await asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: TUESDAY, fraction: "1.00", typeCode: "vacation" }));
      expect(saved).toMatchObject({ origin: "manual", pendingOp: "upsert", trekEntryId: null });
    });

    it("refuses a principal without timeoff.write", async () => {
      const db = await seed();
      await expect(asOwner(db, (deps) =>
        setEvent(deps)(testPrincipal({ roles: ["viewer"] }), {
          date: MONDAY, fraction: "1.00", typeCode: "vacation",
        }),
      )).rejects.toThrow(/permission/i);
    });

    it("writes a timeoff.event_set audit row", async () => {
      const db = await seed();
      await asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: MONDAY, fraction: "1.00", typeCode: "vacation" }));
      const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(auditEvents).where(eq(auditEvents.action, "timeoff.event_set")));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.after).toMatchObject({ date: MONDAY, typeCode: "vacation", pendingOp: "upsert" });
    });
  });

  describe("removeEvent", () => {
    it("hard-deletes a manual day Trek has never seen", async () => {
      const db = await seed();
      await asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: TUESDAY, fraction: "1.00", typeCode: "vacation" }));
      await asOwner(db, (deps) => removeEvent(deps)(principal, TUESDAY));

      const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(timeoffEvents));
      expect(rows).toEqual([]);
    });

    it("keeps a Trek day as a tombstone so the removal can still be pushed", async () => {
      const db = await seed();
      await aTrekDay(db, MONDAY, 77);
      await asOwner(db, (deps) => removeEvent(deps)(principal, MONDAY));

      const after = await asOwner(db, (deps) => deps.events.at(principal.userId, MONDAY));
      expect(after).toMatchObject({ date: MONDAY, pendingOp: "delete", trekEntryId: 77 });

      const links = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(providerLinks).where(and(
          eq(providerLinks.provider, "trek"),
          eq(providerLinks.entityType, "timeoff_event"),
        )));
      expect(links).toHaveLength(1);
    });

    it("clearPending finally deletes the tombstone and its link", async () => {
      const db = await seed();
      await aTrekDay(db, MONDAY, 77);
      await asOwner(db, (deps) => removeEvent(deps)(principal, MONDAY));
      await asOwner(db, (deps) =>
        deps.events.clearPending(principal.userId, [MONDAY], new Date("2026-03-01T00:00:00Z")));

      const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(timeoffEvents));
      expect(rows).toEqual([]);
      const links = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(providerLinks));
      expect(links).toEqual([]);
    });

    it("unlinkProvider drops the Trek link but keeps the day, so a conversion sticks", async () => {
      // What `syncPass` does once Trek confirms the removal for a day the owner
      // retyped to `permits`: the day is still theirs, it is simply no longer
      // Trek's — and the stale link would otherwise make the next
      // `removeEvent` stage a delete for an entry that is already gone.
      const db = await seed();
      await aTrekDay(db, MONDAY, 4242);
      const dropped = await asOwner(db, (deps) =>
        deps.events.unlinkProvider(principal.userId, [MONDAY]));
      expect(dropped).toBe(1);

      const after = await asOwner(db, (deps) => deps.events.at(principal.userId, MONDAY));
      expect(after).toMatchObject({ date: MONDAY, trekEntryId: null });
      const links = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(providerLinks));
      expect(links).toEqual([]);

      // And now a removal is a hard delete, not a second pointless push.
      await asOwner(db, (deps) => removeEvent(deps)(principal, MONDAY));
      expect(await asOwner(db, (deps) => deps.events.at(principal.userId, MONDAY))).toBeNull();
    });

    it("reports a day that is not there rather than pretending it removed one", async () => {
      const db = await seed();
      await expect(asOwner(db, (deps) => removeEvent(deps)(principal, TUESDAY)))
        .rejects.toMatchObject({ name: "NotFoundError" });
    });

    it("writes a timeoff.event_removed audit row", async () => {
      const db = await seed();
      await aTrekDay(db, MONDAY, 77);
      await asOwner(db, (deps) => removeEvent(deps)(principal, MONDAY));
      const rows = await withUserContext(db, { userId: principal.userId }, (tx) =>
        tx.select().from(auditEvents).where(eq(auditEvents.action, "timeoff.event_removed")));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.after).toMatchObject({ deleted: false, pendingOp: "delete" });
    });
  });

  describe("getWorkspace calendar", () => {
    it("keys the year by date, counts what is still pending and lists what is ahead", async () => {
      const db = await seed();
      await aTrekDay(db, MONDAY, 5);
      await asOwner(db, (deps) =>
        setEvent(deps)(principal, { date: TUESDAY, fraction: "0.50", typeCode: "permits" }));

      const workspace = await asOwner(db, (deps) =>
        getWorkspace(deps)(principal, {
          year: 2026,
          selectedDate: TUESDAY,
          trekConnected: true,
          cachedStats: null,
        }));

      expect(workspace.byDate[MONDAY]).toMatchObject({ fraction: "1.00", typeCode: "vacation", pendingOp: "none" });
      expect(workspace.byDate[TUESDAY]).toMatchObject({ fraction: "0.50", typeCode: "permits", pendingOp: "upsert" });
      expect(workspace.pendingCount).toBe(1);
      expect(workspace.selected?.event?.date).toBe(TUESDAY);
      expect(workspace.trekConnected).toBe(true);
      // The year is long past by the time this suite runs, so both days are
      // behind `today` and neither is upcoming; they still count towards YTD.
      expect(workspace.upcoming).toEqual([]);
      expect(workspace.plannedDaysYtd).toBe("1.50");
    });

    it("hands back a bookable empty day for a date with no event", async () => {
      const db = await seed();
      const workspace = await asOwner(db, (deps) =>
        getWorkspace(deps)(principal, {
          year: 2026,
          selectedDate: TUESDAY,
          trekConnected: false,
          cachedStats: null,
        }));
      expect(workspace.selected).toEqual({ date: TUESDAY, event: null, status: null });
    });
  });
});
