import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, budgetUsages, organizations, transactions, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";

describe("budgets routes", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  function headers(userId: string, role: RoleCode = "owner", extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      "x-test-user": userId,
      "x-test-role": role,
      "x-requested-with": "test",
      ...extra,
    };
  }

  async function seed() {
    const db = await testDb();
    const [organization] = await db.insert(organizations).values({ name: "Budgets household" }).returning();
    const [user] = await db.insert(users).values({ organizationId: organization!.id, displayName: "A" }).returning();
    const [account] = await withUserContext(db, { userId: user!.id }, (tx) =>
      tx.insert(accounts).values({ userId: user!.id, name: "Checking", type: "checking", origin: "manual" }).returning(),
    );
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
      now: () => new Date("2026-09-06T10:00:00.000Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), db, userId: user!.id, accountId: account!.id };
  }

  it("walks create, allocation, scopes, refresh and idempotent manual usage, then enforces write permission and optimistic concurrency", async () => {
    const { app, db, userId, accountId } = await seed();

    const createRes = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        name: "Groceries",
        description: null,
        currency: "EUR",
        periodKind: "monthly",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "1000.00",
      }),
    });
    expect(createRes.status).toBe(201);
    const budget = (await createRes.json()) as Record<string, unknown>;
    expect(budget).toMatchObject({ name: "Groceries", status: "active", version: 1 });
    expect(budget).not.toHaveProperty("userId");
    const budgetId = budget.id as string;

    const allocationRes = await app.request(`/api/v1/budgets/${budgetId}/allocations`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        sourceKind: "none",
        sourceId: null,
        amount: "50.00",
        recurrence: "once",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        note: "Top-up",
      }),
    });
    expect(allocationRes.status).toBe(201);
    const allocation = (await allocationRes.json()) as Record<string, unknown>;
    expect(allocation).toMatchObject({ budgetId, sourceKind: "none", amount: "50.00" });

    const scopesRes = await app.request(`/api/v1/budgets/${budgetId}/scopes`, {
      method: "PUT",
      headers: headers(userId),
      body: JSON.stringify([{ kind: "account", refId: accountId }]),
    });
    expect(scopesRes.status).toBe(200);
    const scopesBody = (await scopesRes.json()) as { items: Record<string, unknown>[] };
    expect(scopesBody.items).toHaveLength(1);
    expect(scopesBody.items[0]).toMatchObject({ kind: "account", refId: accountId });

    await withUserContext(db, { userId }, (tx) =>
      tx.insert(transactions).values({
        userId,
        accountId,
        occurredAt: new Date("2026-02-01T12:00:00.000Z"),
        amount: "-30.00",
        type: "expense",
        state: "cleared",
      }),
    );

    const refreshRes = await app.request(`/api/v1/budgets/${budgetId}/refresh`, {
      method: "POST",
      headers: headers(userId),
    });
    expect(refreshRes.status).toBe(200);
    expect(await refreshRes.json()).toMatchObject({ inserted: 1, updated: 0, deleted: 0 });

    const usageBody = JSON.stringify({ amount: "12.00", occurredAt: "2026-02-15", note: "Cash top-up" });
    const firstUsage = await app.request(`/api/v1/budgets/${budgetId}/usages`, {
      method: "POST",
      headers: headers(userId, "owner", { "idempotency-key": "manual-usage-1" }),
      body: usageBody,
    });
    expect(firstUsage.status).toBe(201);
    const usage = await firstUsage.json();
    expect(usage).toMatchObject({ budgetId, amount: "12.00", matchedBy: "manual" });

    const replayUsage = await app.request(`/api/v1/budgets/${budgetId}/usages`, {
      method: "POST",
      headers: headers(userId, "owner", { "idempotency-key": "manual-usage-1" }),
      body: usageBody,
    });
    expect(replayUsage.status).toBe(201);
    expect(await replayUsage.json()).toEqual(usage);

    // Prove the replay by counting rows, not by comparing response bodies:
    // a bug that recreated the row (or created a duplicate) would still be
    // able to serve an identical-looking response from the idempotency
    // cache, so the count is the ground truth.
    const manualRows = await withUserContext(db, { userId }, (tx) =>
      tx.select().from(budgetUsages).where(and(eq(budgetUsages.budgetId, budgetId), eq(budgetUsages.matchedBy, "manual"))),
    );
    expect(manualRows).toHaveLength(1);

    const deleteRes = await app.request(`/api/v1/budgets/${budgetId}/usages/${usage.id}`, {
      method: "DELETE",
      headers: headers(userId),
    });
    expect(deleteRes.status).toBe(204);
    const afterDelete = await withUserContext(db, { userId }, (tx) =>
      tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budgetId)),
    );
    expect(afterDelete.filter((row) => row.matchedBy === "manual")).toHaveLength(0);

    const detailRes = await app.request(`/api/v1/budgets/${budgetId}`, { headers: headers(userId) });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as Record<string, unknown>;
    expect(detail).toMatchObject({ budget: { id: budgetId }, figures: { initial: "1000.00" } });
    expect((detail.budget as Record<string, unknown>)).not.toHaveProperty("userId");

    const viewerWrite = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: headers(userId, "viewer"),
      body: JSON.stringify({
        name: "Blocked",
        description: null,
        currency: "EUR",
        periodKind: "none",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "0.00",
      }),
    });
    expect(viewerWrite.status).toBe(403);
    expect((await viewerWrite.json()).error.code).toBe("permission_denied");

    const stalePatch = await app.request(`/api/v1/budgets/${budgetId}`, {
      method: "PATCH",
      headers: headers(userId, "owner", { "if-match": '"999"' }),
      body: JSON.stringify({ name: "Stale rename" }),
    });
    expect(stalePatch.status).toBe(409);
    expect((await stalePatch.json()).error.code).toBe("version_mismatch");
  });

  it("archives a budget via a status PATCH, and never lets a client set archivedAt or slip version into the patch", async () => {
    const { app, userId } = await seed();
    const createRes = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        name: "Rent",
        description: null,
        currency: "EUR",
        periodKind: "monthly",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "500.00",
      }),
    });
    const budget = (await createRes.json()) as { id: string; version: number };

    // A body version (no If-Match) exercises `updateBudget`'s `.strict()`
    // patch schema through the route: if the route forwarded `version`
    // unstripped, this would 422 with `validation_failed` instead of
    // succeeding.
    const archiveRes = await app.request(`/api/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ status: "archived", version: budget.version }),
    });
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()) as { status: string; archivedAt: string | null; version: number };
    expect(archived.status).toBe("archived");
    // `updateBudget` sets `archivedAt` itself from its own clock — assert it
    // is a real, current timestamp, not a value the client could have
    // supplied (the wire schema never accepts one; see below).
    expect(archived.archivedAt).not.toBeNull();
    expect(new Date(archived.archivedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);

    // A client-supplied `archivedAt` is not a field `UpdateBudgetRequestSchema`
    // declares, so the wire schema itself rejects it — the field can never
    // reach `updateBudget` to desync `status` from a caller-chosen date.
    const smuggleRes = await app.request(`/api/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ status: "archived", version: archived.version, archivedAt: "1999-01-01T00:00:00.000Z" }),
    });
    expect(smuggleRes.status).toBe(422);
    expect((await smuggleRes.json()).error.code).toBe("validation_failed");
  });

  it("refuses a cookie-authenticated POST that omits X-Requested-With", async () => {
    const { app, userId } = await seed();
    const res = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userId, "x-test-role": "owner" },
      body: JSON.stringify({
        name: "No CSRF header",
        description: null,
        currency: "EUR",
        periodKind: "none",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "0.00",
      }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("requires an Idempotency-Key for manual usage creation", async () => {
    const { app, userId } = await seed();
    const createRes = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        name: "No key",
        description: null,
        currency: "EUR",
        periodKind: "none",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "0.00",
      }),
    });
    const budget = (await createRes.json()) as { id: string };
    const res = await app.request(`/api/v1/budgets/${budget.id}/usages`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({ amount: "1.00", occurredAt: "2026-02-01", note: null }),
    });
    expect(res.status).toBe(428);
    expect((await res.json()).error.code).toBe("validation_failed");
  });
});
