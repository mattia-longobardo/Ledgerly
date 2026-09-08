/**
 * The Time off API against real Postgres.
 *
 * The cases the reduced Phase 7 asks for: the default types are seeded by the
 * first call that touches the module, a weekday can be booked, a Saturday
 * cannot, a removal answers 204, and a viewer — who holds `timeoff.read` and
 * nothing else — cannot write.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import { createApiApp } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";

// 2026-03-02 is a Monday, 2026-03-03 a Tuesday, 2026-03-07 a Saturday.
const MONDAY = "2026-03-02";
const TUESDAY = "2026-03-03";
const SATURDAY = "2026-03-07";

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb
    .insert(users)
    .values({ organizationId: org!.id, displayName: "A" })
    .returning();
  return { userId: user!.id, organizationId: org!.id };
}

function appFor(userId: string, organizationId: string, roles: RoleCode[] = ["owner"]) {
  return createApiApp({
    db,
    now: () => new Date("2026-03-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({
      principal: { userId, organizationId, roles, permissions: permissionsForRoles(roles) },
      method: "session",
    }),
  });
}

const WRITE_HEADERS = { "x-requested-with": "test", "content-type": "application/json" };

describe("time off API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("seeds the three default types on the first call", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request("/api/v1/timeoff/types", {
      headers: { "x-requested-with": "test" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { code: string; label: string; hoursPerDay: string }[] };
    expect(body.items.map((t) => t.code)).toEqual(["vacation", "permits", "comp"]);
    // The wire shape carries no ownership field.
    expect(body.items[0]).not.toHaveProperty("userId");

    // Idempotent: a second call creates nothing.
    const again = await appFor(userId, organizationId).request("/api/v1/timeoff/types", {
      headers: { "x-requested-with": "test" },
    });
    expect(((await again.json()) as { items: unknown[] }).items).toHaveLength(3);
  });

  it("books a weekday, staged for the Trek sync rather than sent", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ fraction: "1.00", typeCode: "vacation", note: "Dentist" }),
    });

    expect(res.status).toBe(200);
    const event = (await res.json()) as Record<string, unknown>;
    expect(event).toMatchObject({
      date: MONDAY,
      fraction: "1.00",
      typeCode: "vacation",
      // The whole contract with the sync: nothing leaves this app until a pass
      // picks it up.
      pendingOp: "upsert",
      origin: "manual",
      note: "Dentist",
      trekEntryId: null,
    });
    expect(event).not.toHaveProperty("userId");
  });

  it("refuses a Saturday with 422 validation_failed", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request(`/api/v1/timeoff/events/${SATURDAY}`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ fraction: "1.00", typeCode: "vacation" }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/Saturday/);
  });

  it("refuses a date that is well shaped but not a real day, with 422 rather than 500", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);

    // 2026-02-31 clears `^\d{4}-\d{2}-\d{2}$`. Before the wire schema checked
    // the calendar, `new Date("2026-02-31T00:00:00Z")` rolled over to 3 March —
    // so the weekend guard reasoned about the wrong day — and Postgres then
    // refused the cast, surfacing a client input mistake as `500 internal`.
    const put = await app.request("/api/v1/timeoff/events/2026-02-31", {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ fraction: "1.00", typeCode: "vacation" }),
    });
    expect(put.status).toBe(422);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe("validation_failed");

    const del = await app.request("/api/v1/timeoff/events/2026-02-31", {
      method: "DELETE",
      headers: { "x-requested-with": "test" },
    });
    expect(del.status).toBe(422);

    const range = await app.request("/api/v1/timeoff/events?from=2026-02-31&to=2026-03-31", {
      headers: { "x-requested-with": "test" },
    });
    expect(range.status).toBe(422);
  });

  it("removes a day with 204, and answers 404 for one that was never booked", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    await app.request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ fraction: "0.50", typeCode: "comp" }),
    });

    const removed = await app.request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "DELETE",
      headers: { "x-requested-with": "test" },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");

    const again = await app.request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "DELETE",
      headers: { "x-requested-with": "test" },
    });
    expect(again.status).toBe(404);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("refuses a viewer's PUT with 403 permission_denied", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId, ["viewer"]).request(
      `/api/v1/timeoff/events/${MONDAY}`,
      {
        method: "PUT",
        headers: WRITE_HEADERS,
        body: JSON.stringify({ fraction: "1.00", typeCode: "vacation" }),
      },
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("permission_denied");
  });

  it("returns the year's workspace and the range of events behind it", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    for (const [date, fraction] of [[MONDAY, "1.00"], [TUESDAY, "0.50"]] as const) {
      await app.request(`/api/v1/timeoff/events/${date}`, {
        method: "PUT",
        headers: WRITE_HEADERS,
        body: JSON.stringify({ fraction, typeCode: "vacation" }),
      });
    }

    const workspace = await app.request(`/api/v1/timeoff/workspace?year=2026&date=${TUESDAY}`, {
      headers: { "x-requested-with": "test" },
    });
    expect(workspace.status).toBe(200);
    const body = (await workspace.json()) as {
      year: number;
      byDate: Record<string, { fraction: string; typeCode: string }>;
      balances: { remainingDays: string | null; source: string | null }[];
      selected: { date: string; event: { fraction: string } | null };
      pendingCount: number;
      trekConnected: boolean;
    };
    expect(body.year).toBe(2026);
    expect(Object.keys(body.byDate).sort()).toEqual([MONDAY, TUESDAY]);
    expect(body.byDate[TUESDAY]).toMatchObject({ fraction: "0.50", typeCode: "vacation" });
    expect(body.selected).toMatchObject({ date: TUESDAY, event: { fraction: "0.50" } });
    expect(body.pendingCount).toBe(2);
    expect(body.trekConnected).toBe(false);
    // No payslip has been applied, so every figure is absent — never `0.00`.
    expect(body.balances.every((b) => b.remainingDays === null && b.source === null)).toBe(true);

    const events = await app.request("/api/v1/timeoff/events?from=2026-03-01&to=2026-03-31", {
      headers: { "x-requested-with": "test" },
    });
    expect(events.status).toBe(200);
    expect(((await events.json()) as { items: { date: string }[] }).items.map((e) => e.date)).toEqual([
      MONDAY,
      TUESDAY,
    ]);

    // Nothing has written a balance, so the year's history is empty rather
    // than a fabricated zero row.
    const balances = await app.request("/api/v1/timeoff/balances?year=2026", {
      headers: { "x-requested-with": "test" },
    });
    expect(balances.status).toBe(200);
    expect(((await balances.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("refuses a cookie-authenticated PUT that omits X-Requested-With", async () => {
    const { userId, organizationId } = await seedUser();
    const res = await appFor(userId, organizationId).request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fraction: "1.00", typeCode: "vacation" }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("does not leak another user's days", async () => {
    const owner = await seedUser();
    await appFor(owner.userId, owner.organizationId).request(`/api/v1/timeoff/events/${MONDAY}`, {
      method: "PUT",
      headers: WRITE_HEADERS,
      body: JSON.stringify({ fraction: "1.00", typeCode: "vacation" }),
    });

    const intruder = await seedUser();
    const res = await appFor(intruder.userId, intruder.organizationId).request(
      "/api/v1/timeoff/events?from=2026-01-01&to=2026-12-31",
      { headers: { "x-requested-with": "test" } },
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });
});
