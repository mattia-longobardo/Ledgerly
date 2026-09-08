/**
 * The cross-domain reconciliation issue list and `resolveIssue` (Phase 9),
 * through the API against real Postgres.
 *
 * Against Postgres because the two things worth proving are database
 * behaviours: keyset pagination that stays disjoint across pages, and the
 * partial unique index that only lets one live issue exist per (entity, kind) —
 * which is what makes resolving an issue different from acknowledging it.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, reconciliationIssues, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";

type Issue = { id: string; domain: string; severity: string; status: string; resolvedAt: string | null };

describe("reconciliation issues", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seed() {
    const db = await testDb();
    const [organization] = await db.insert(organizations).values({ name: "Household" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: organization!.id, displayName: "A" }).returning();
    const [userB] = await db.insert(users).values({ organizationId: organization!.id, displayName: "B" }).returning();
    const deps: ApiDeps = {
      db,
      authenticate: async (request: Request) => {
        const userId = request.headers.get("x-test-user");
        if (!userId) return null;
        const roles = [(request.headers.get("x-test-role") ?? "owner") as RoleCode];
        const principal: Principal = {
          userId,
          organizationId: organization!.id,
          roles,
          permissions: permissionsForRoles(roles),
        };
        return { principal, method: "session" as const };
      },
      now: () => new Date("2026-09-08T10:00:00.000Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), db, userA: userA!, userB: userB! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  type Db = Awaited<ReturnType<typeof testDb>>;

  async function seedIssues(
    db: Db,
    userId: string,
    rows: { domain: string; kind: string; severity: "info" | "warning" | "error"; createdAt: Date; status?: string }[],
  ): Promise<void> {
    await withUserContext(db, { userId }, (tx) =>
      tx.insert(reconciliationIssues).values(
        rows.map((row, i) => ({
          userId,
          domain: row.domain,
          entityType: "fund_month",
          entityId: `entity-${i}`,
          kind: row.kind,
          severity: row.severity,
          status: row.status ?? "open",
          createdAt: row.createdAt,
        })),
      ),
    );
  }

  async function list(app: ReturnType<typeof createApiApp>, userId: string, query = ""): Promise<{ items: Issue[]; nextCursor: string | null }> {
    const res = await app.request(`/api/v1/reconciliation/issues${query}`, { headers: headers(userId) });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("lists every domain, newest first, and filters by domain, status and severity", async () => {
    const { app, db, userA } = await seed();
    const base = Date.parse("2026-09-01T00:00:00Z");
    await seedIssues(db, userA.id, [
      { domain: "funds", kind: "missing_contribution", severity: "error", createdAt: new Date(base) },
      { domain: "funds", kind: "delayed_contribution", severity: "warning", createdAt: new Date(base + 1_000) },
      { domain: "payroll", kind: "unmapped_component", severity: "info", createdAt: new Date(base + 2_000), status: "acknowledged" },
    ]);

    const all = await list(app, userA.id);
    expect(all.items).toHaveLength(3);
    // Newest first: the list is a work queue, not a history.
    expect(all.items.map((i) => i.domain)).toEqual(["payroll", "funds", "funds"]);
    expect(all.nextCursor).toBeNull();

    expect((await list(app, userA.id, "?domain=payroll")).items).toHaveLength(1);
    expect((await list(app, userA.id, "?status=open")).items).toHaveLength(2);
    expect((await list(app, userA.id, "?severity=error")).items.map((i) => i.severity)).toEqual(["error"]);
    expect((await list(app, userA.id, "?domain=funds&severity=info")).items).toHaveLength(0);
  });

  it("pages disjointly with the cursor", async () => {
    const { app, db, userA } = await seed();
    const base = Date.parse("2026-09-01T00:00:00Z");
    await seedIssues(
      db,
      userA.id,
      Array.from({ length: 5 }, (_, i) => ({
        domain: "funds",
        kind: `kind-${i}`,
        severity: "warning" as const,
        createdAt: new Date(base + i * 1_000),
      })),
    );

    const first = await list(app, userA.id, "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]!.id);

    const second = await list(app, userA.id, `?limit=2&cursor=${first.nextCursor}`);
    const third = await list(app, userA.id, `?limit=2&cursor=${second.nextCursor}`);
    expect(third.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("resolves an issue once, stamps it, and 404s the second attempt", async () => {
    const { app, db, userA } = await seed();
    await seedIssues(db, userA.id, [
      { domain: "funds", kind: "missing_contribution", severity: "error", createdAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    const [issue] = (await list(app, userA.id)).items;

    const resolved = await app.request(`/api/v1/reconciliation/issues/${issue!.id}/resolve`, {
      method: "POST",
      headers: headers(userA.id),
    });
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as Issue;
    expect(body.status).toBe("resolved");
    expect(body.resolvedAt).not.toBeNull();

    const again = await app.request(`/api/v1/reconciliation/issues/${issue!.id}/resolve`, {
      method: "POST",
      headers: headers(userA.id),
    });
    expect(again.status).toBe(404);

    // Still listed — resolving takes it out of the work queue, not the record.
    expect((await list(app, userA.id, "?status=resolved")).items).toHaveLength(1);
  });

  it("needs finance.manage, and never shows another user's issues", async () => {
    const { app, db, userA, userB } = await seed();
    await seedIssues(db, userA.id, [
      { domain: "funds", kind: "missing_contribution", severity: "error", createdAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    const [issue] = (await list(app, userA.id)).items;

    const viewer = await app.request("/api/v1/reconciliation/issues", {
      headers: headers(userA.id, { "x-test-role": "viewer" }),
    });
    expect(viewer.status).toBe(403);
    expect((await viewer.json()).error.code).toBe("permission_denied");

    expect((await list(app, userB.id)).items).toHaveLength(0);
    const stolen = await app.request(`/api/v1/reconciliation/issues/${issue!.id}/resolve`, {
      method: "POST",
      headers: headers(userB.id),
    });
    expect(stolen.status).toBe(404);
  });
});
