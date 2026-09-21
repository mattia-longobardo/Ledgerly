/**
 * What the database itself refuses (plan F7 §3.2, L0). Every rule here is one the service must be
 * able to rely on without reading a row first: a day off always having a size, that size being
 * half a day or a whole one, one row per day and kind, and nobody asking Trek to delete a day
 * Trek never had.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { leaveDays, timeoffAllowances } from "./schema";

let ctx: Ctx;
let other: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  other = await newContext();
});

afterAll(closeDatabase);

type DayValues = Partial<typeof leaveDays.$inferInsert>;

function insertDay(who: Ctx, values: DayValues = {}) {
  return getDb()
    .insert(leaveDays)
    .values(
      userScoped(who).stamp({
        on: "2026-03-10",
        kind: "vacation" as const,
        fraction: "1.0",
        ...values,
      }),
    )
    .returning();
}

describe("timeoff_allowances", () => {
  it("holds one row per user and year, and keeps two users apart", async () => {
    await getDb()
      .insert(timeoffAllowances)
      .values(userScoped(ctx).stamp({ year: 2026, vacationDays: "26.00", rolDays: "4.00" }));
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, vacationDays: "20.00" })),
    ).rejects.toThrow();

    // The same year for somebody else is a different row, not a conflict.
    await getDb()
      .insert(timeoffAllowances)
      .values(userScoped(other).stamp({ year: 2026, vacationDays: "20.00" }));
    const mine = await getDb()
      .select()
      .from(timeoffAllowances)
      .where(userScoped(ctx).owns(timeoffAllowances));
    expect(mine).toHaveLength(1);
    expect(mine[0].vacationDays).toBe("26.00");
  });

  it("refuses an impossible year, and days no year could grant", async () => {
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 1900 })),
    ).rejects.toThrow();
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, vacationDays: "-1.00" })),
    ).rejects.toThrow();
    // ROL is counted in days since N9, and holds to the same bounds as vacation does.
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, rolDays: "-1.00" })),
    ).rejects.toThrow();
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, rolDays: "400.01" })),
    ).rejects.toThrow();
    const [granted] = await getDb()
      .insert(timeoffAllowances)
      .values(userScoped(ctx).stamp({ year: 2026, rolDays: "4.00" }))
      .returning();
    expect(granted.rolDays).toBe("4.00");
  });

  it("leaves every figure unknown until somebody states it", async () => {
    // A row with no numbers in it is not a year that grants nothing. Since N9 there is no column
    // here with a zero default left, so no total is ever read as stated when nobody stated it.
    const [row] = await getDb()
      .insert(timeoffAllowances)
      .values(userScoped(ctx).stamp({ year: 2026 }))
      .returning();
    expect(row.vacationDays).toBeNull();
    expect(row.rolDays).toBeNull();
    expect(row.totalDays).toBeNull();
  });

  it("keeps the contract's total inside the same bounds as its parts (N7)", async () => {
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, totalDays: "-1.00" })),
    ).rejects.toThrow();
    await expect(
      getDb()
        .insert(timeoffAllowances)
        .values(userScoped(ctx).stamp({ year: 2026, totalDays: "400.01" })),
    ).rejects.toThrow();
    const [stated] = await getDb()
      .insert(timeoffAllowances)
      .values(userScoped(ctx).stamp({ year: 2026, vacationDays: "26.00", totalDays: "32.00" }))
      .returning();
    expect(stated.totalDays).toBe("32.00");
  });
});

describe("leave_days", () => {
  it("insists on a size, whatever the kind (N0)", async () => {
    // ROL used to be free-form minutes and no fraction at all. Since N0 there is one unit, and a
    // row with no size in it is a row nothing downstream could weigh.
    await expect(insertDay(ctx, { fraction: null as never })).rejects.toThrow();
    await expect(insertDay(ctx, { kind: "rol", fraction: null as never })).rejects.toThrow();
    const [rol] = await insertDay(ctx, { kind: "rol", fraction: "0.5" });
    expect(rol.fraction).toBe("0.5");
  });

  it("allows only a whole day or a half, for every kind alike", async () => {
    await expect(insertDay(ctx, { fraction: "0.3" })).rejects.toThrow();
    await expect(insertDay(ctx, { fraction: "0.0" })).rejects.toThrow();
    await expect(insertDay(ctx, { fraction: "2.0" })).rejects.toThrow();
    await expect(insertDay(ctx, { kind: "rol", fraction: "0.3" })).rejects.toThrow();
    const [half] = await insertDay(ctx, { fraction: "0.5" });
    expect(half.fraction).toBe("0.5");
    const [whole] = await insertDay(ctx, { kind: "rol", fraction: "1.0" });
    expect(whole.fraction).toBe("1.0");
  });

  it("holds one row per day and kind, but lets two kinds share a day", async () => {
    await insertDay(ctx, { on: "2026-03-10", kind: "vacation", fraction: "0.5" });
    await expect(insertDay(ctx, { on: "2026-03-10", kind: "vacation", fraction: "1.0" })).rejects.toThrow();
    // Half a day of vacation and half a day of ROL is a real day, and two rows.
    await insertDay(ctx, { on: "2026-03-10", kind: "rol", fraction: "0.5" });
    const rows = await getDb()
      .select()
      .from(leaveDays)
      .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.on, "2026-03-10")));
    expect(rows).toHaveLength(2);
  });

  it("refuses a pending deletion of a day Trek never had", async () => {
    // Never sent, never received: there is nobody to ask for its removal.
    await expect(insertDay(ctx, { origin: "manual", pending: "delete" })).rejects.toThrow();
    // Trek gave us this one, so it can be asked to take it back…
    const [fromTrek] = await insertDay(ctx, { origin: "trek", pending: "delete", on: "2026-03-11" });
    expect(fromTrek.pending).toBe("delete");
    // …and so can one we have already sent.
    const [sent] = await insertDay(ctx, {
      origin: "manual",
      pending: "delete",
      syncedAt: new Date(),
      on: "2026-03-12",
    });
    expect(sent.pending).toBe("delete");
  });

  it("only ever records a kind Trek knows as the observed one", async () => {
    await expect(insertDay(ctx, { trekKind: "rol" as never })).rejects.toThrow();
    const [seen] = await insertDay(ctx, { trekKind: "comp", trekFraction: "0.5" });
    expect(seen.trekKind).toBe("comp");
  });

  it("keeps one user's days out of another's", async () => {
    await insertDay(ctx);
    await insertDay(other);
    const mine = await getDb().select().from(leaveDays).where(userScoped(ctx).owns(leaveDays));
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe(ctx.userId);
  });
});
