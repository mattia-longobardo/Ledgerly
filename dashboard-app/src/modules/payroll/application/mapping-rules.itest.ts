/**
 * The payroll classification-rule editor (Phase 9), through the API against
 * real Postgres.
 *
 * `payroll_mapping_rules` mixes global rows (`user_id IS NULL`) with per-user
 * ones and carries four per-command RLS policies to keep a user from editing or
 * deleting a global (see `drizzle/0015_payroll.sql`), so these have to run
 * against Postgres to mean anything.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";
import { DEFAULT_MAPPING_RULES } from "../domain/mapping";

type Rule = {
  id: string;
  matchCode: string | null;
  matchLabel: string | null;
  componentKind: string;
  priority: number;
  version: number | null;
  global: boolean;
};

describe("payroll mapping rules", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seed() {
    const db = await testDb();
    const [organization] = await db.insert(organizations).values({ name: "Household" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: organization!.id, displayName: "A" }).returning();
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
    return { app: createApiApp(deps), db, userA: userA! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  async function list(app: ReturnType<typeof createApiApp>, userId: string): Promise<Rule[]> {
    const res = await app.request("/api/v1/payroll/mapping-rules", { headers: headers(userId) });
    expect(res.status).toBe(200);
    return (await res.json()).items as Rule[];
  }

  function create(app: ReturnType<typeof createApiApp>, userId: string, body: Record<string, unknown>) {
    return app.request("/api/v1/payroll/mapping-rules", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify(body),
    });
  }

  it("lists the global catalogue merged with the user's own, in classifier order", async () => {
    const { app, userA } = await seed();

    const globalsOnly = await list(app, userA.id);
    expect(globalsOnly).toHaveLength(DEFAULT_MAPPING_RULES.length);
    expect(globalsOnly.every((rule) => rule.global && rule.version === null)).toBe(true);

    const created = await create(app, userA.id, {
      matchLabel: "^premio",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    expect(created.status).toBe(201);

    const merged = await list(app, userA.id);
    expect(merged).toHaveLength(DEFAULT_MAPPING_RULES.length + 1);
    // `priority asc, id asc` — the order `classifyComponent` resolves in, so
    // the list on screen reads the way the classifier does.
    const priorities = merged.map((rule) => rule.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    const own = merged.find((rule) => !rule.global)!;
    expect(own).toMatchObject({ matchLabel: "^premio", componentKind: "bonus", version: 1, global: false });
  });

  it("defaults priority to 100 + the number of rules the user already has", async () => {
    const { app, userA } = await seed();

    const first = await create(app, userA.id, {
      matchCode: "one",
      componentKind: "earning",
      target: { kind: "earnings" },
    });
    expect((await first.json()).priority).toBe(100);

    const second = await create(app, userA.id, {
      matchCode: "two",
      componentKind: "earning",
      target: { kind: "earnings" },
    });
    expect((await second.json()).priority).toBe(101);

    // An explicit priority still wins — including one below the globals, which
    // is how a user rule deliberately shadows the catalogue.
    const explicit = await create(app, userA.id, {
      matchCode: "gross",
      componentKind: "info",
      target: { kind: "none" },
      priority: 10,
    });
    expect((await explicit.json()).priority).toBe(10);
    expect((await list(app, userA.id))[0]).toMatchObject({ priority: 10, global: false });
  });

  it("refuses a matchLabel that is not a valid regular expression", async () => {
    const { app, userA } = await seed();

    const bad = await create(app, userA.id, {
      matchLabel: "premio(",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    expect(bad.status).toBe(422);
    const body = await bad.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/not a valid regular expression/);

    // And on the way in through PATCH, not only on create.
    const good = await create(app, userA.id, {
      matchLabel: "premio",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    const rule = (await good.json()) as Rule;
    const patched = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": String(rule.version) }),
      body: JSON.stringify({ matchLabel: "premio[" }),
    });
    expect(patched.status).toBe(422);

    // A rule left with neither matcher is refused too — the table's own CHECK
    // says the same, but as a 500 rather than a 422.
    const noMatcher = await create(app, userA.id, { componentKind: "info", target: { kind: "none" } });
    expect(noMatcher.status).toBe(422);
  });

  it("updates under If-Match and answers 409 when the version has moved", async () => {
    const { app, userA } = await seed();
    const created = await create(app, userA.id, {
      matchCode: "premio",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    const rule = (await created.json()) as Rule;

    const ok = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": String(rule.version) }),
      body: JSON.stringify({ componentKind: "allowance", target: { kind: "none" } }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ componentKind: "allowance", version: 2 });

    const stale = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": String(rule.version) }),
      body: JSON.stringify({ priority: 5 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("version_mismatch");

    const missingPrecondition = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ priority: 5 }),
    });
    expect(missingPrecondition.status).toBe(428);
  });

  it("deletes a user rule and refuses to touch a global one", async () => {
    const { app, userA } = await seed();
    const created = await create(app, userA.id, {
      matchCode: "premio",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    const rule = (await created.json()) as Rule;

    const globalRule = (await list(app, userA.id)).find((r) => r.global)!;
    // A global has no row and not even a uuid id ("global-000"), so the route's
    // own param validation refuses it before the use case is reached — the
    // catalogue is overridden by adding a rule at a lower priority, never edited.
    const editGlobal = await app.request(`/api/v1/payroll/mapping-rules/${globalRule.id}`, {
      method: "DELETE",
      headers: headers(userA.id),
    });
    expect(editGlobal.status).toBe(422);

    const deleted = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "DELETE",
      headers: headers(userA.id),
    });
    expect(deleted.status).toBe(204);
    expect((await list(app, userA.id)).filter((r) => !r.global)).toHaveLength(0);

    const again = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "DELETE",
      headers: headers(userA.id),
    });
    expect(again.status).toBe(404);
  });

  it("needs payroll.review", async () => {
    const { app, userA } = await seed();
    const viewer = headers(userA.id, { "x-test-role": "viewer" });

    const read = await app.request("/api/v1/payroll/mapping-rules", { headers: viewer });
    expect(read.status).toBe(403);

    const write = await app.request("/api/v1/payroll/mapping-rules", {
      method: "POST",
      headers: viewer,
      body: JSON.stringify({ matchCode: "x", componentKind: "info", target: { kind: "none" } }),
    });
    expect(write.status).toBe(403);
    expect((await write.json()).error.code).toBe("permission_denied");
  });

  it("keeps one user's rules out of another's list", async () => {
    const { app, db, userA } = await seed();
    const [userB] = await db
      .insert(users)
      .values({ organizationId: userA.organizationId, displayName: "B" })
      .returning();

    const created = await create(app, userA.id, {
      matchCode: "premio",
      componentKind: "bonus",
      target: { kind: "earnings" },
    });
    const rule = (await created.json()) as Rule;

    expect((await list(app, userB!.id)).filter((r) => !r.global)).toHaveLength(0);
    const stolen = await app.request(`/api/v1/payroll/mapping-rules/${rule.id}`, {
      method: "PATCH",
      headers: headers(userB!.id, { "if-match": "1" }),
      body: JSON.stringify({ priority: 1 }),
    });
    expect(stolen.status).toBe(404);
  });
});
