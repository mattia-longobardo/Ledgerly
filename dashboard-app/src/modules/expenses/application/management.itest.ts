/**
 * Category and label management (Phase 9), driven through the API against real
 * Postgres.
 *
 * Through the route rather than the use case directly, because half of what the
 * rules say is about the seam: the permission the route enforces, the status
 * code a duplicate name produces, and — for the provider-mirror rule — that a
 * `provider_links` row written by the sync is visible to the use case under the
 * caller's own RLS context.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  organizations,
  providerLinks,
  transactionCategories,
  transactions,
  users,
} from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";

describe("expenses management", () => {
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

  it("creates and renames a category, and refuses a duplicate name", async () => {
    const { app, userA } = await seed();

    const created = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Groceries", kind: "expense", color: "#0a0" }),
    });
    expect(created.status).toBe(201);
    const category = (await created.json()) as { id: string; name: string; source: string };
    expect(category).toMatchObject({ name: "Groceries", source: "manual" });

    const renamed = await app.request(`/api/v1/expenses/categories/${category.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Food", color: null }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "Food", color: null });

    const clash = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Food" }),
    });
    expect(clash.status).toBe(422);
    expect((await clash.json()).error.code).toBe("validation_failed");
  });

  it("needs finance.manage: a viewer cannot create or rename anything", async () => {
    const { app, userA } = await seed();

    const created = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Groceries" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    for (const [path, method, body] of [
      ["/api/v1/expenses/categories", "POST", { name: "Other" }],
      [`/api/v1/expenses/categories/${id}`, "PATCH", { name: "Other" }],
      ["/api/v1/expenses/labels", "POST", { name: "Trip" }],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: headers(userA.id, { "x-test-role": "viewer" }),
        body: JSON.stringify(body),
      });
      expect([path, res.status]).toEqual([path, 403]);
      expect((await res.json()).error.code).toBe("permission_denied");
    }
  });

  it("archives a category without touching the transactions that point at it", async () => {
    const { app, db, userA } = await seed();

    const created = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Groceries" }),
    });
    const { id } = (await created.json()) as { id: string };

    // Seeded in the owner's own context: `accounts` and `transactions` both
    // carry FORCE ROW LEVEL SECURITY, so a bare-pool insert is rejected.
    await withUserContext(db, { userId: userA.id }, async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ userId: userA.id, name: "Current", type: "checking", currency: "EUR", origin: "manual" })
        .returning();
      await tx.insert(transactions).values({
        userId: userA.id,
        accountId: account!.id,
        occurredAt: new Date("2026-08-01T00:00:00Z"),
        amount: "-12.34",
        currency: "EUR",
        type: "expense",
        categoryId: id,
      });
    });

    const archived = await app.request(`/api/v1/expenses/categories/${id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status).toBe(200);
    expect((await archived.json()).archivedAt).not.toBeNull();

    // The row is still there and the transaction still points at it: archiving
    // is a timestamp, not a delete, so history keeps its category.
    const rows = await withUserContext(db, { userId: userA.id }, (tx) =>
      tx.select().from(transactions).where(eq(transactions.categoryId, id)),
    );
    expect(rows).toHaveLength(1);

    // And it drops out of the default list while staying readable by id.
    const list = await app.request("/api/v1/transaction-categories", { headers: headers(userA.id) });
    expect(((await list.json()).items as { id: string }[]).map((c) => c.id)).not.toContain(id);

    const restored = await app.request(`/api/v1/expenses/categories/${id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ archived: false }),
    });
    expect((await restored.json()).archivedAt).toBeNull();
  });

  it("refuses to rename a provider-mirrored category but still takes its colour and parent", async () => {
    const { app, db, userA } = await seed();

    const parentRes = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Everyday" }),
    });
    const parent = (await parentRes.json()) as { id: string };

    const mirroredRes = await app.request("/api/v1/expenses/categories", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Wallet: Groceries" }),
    });
    const mirrored = (await mirroredRes.json()) as { id: string };

    // Exactly what `syncProviderTransactions` writes when it mirrors a
    // provider's category — the presence of this row is the whole rule.
    await withUserContext(db, { userId: userA.id }, (tx) =>
      tx.insert(providerLinks).values({
        userId: userA.id,
        provider: "wallet",
        entityType: "category",
        entityId: mirrored.id,
        externalId: "wallet-cat-1",
      }),
    );

    const rename = await app.request(`/api/v1/expenses/categories/${mirrored.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Groceries" }),
    });
    expect(rename.status).toBe(422);
    expect((await rename.json()).error.message).toMatch(/mirrored from wallet/);

    const local = await app.request(`/api/v1/expenses/categories/${mirrored.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ color: "#123456", parentId: parent.id }),
    });
    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({ color: "#123456" });
    const [row] = await withUserContext(db, { userId: userA.id }, (tx) =>
      tx
        .select()
        .from(transactionCategories)
        .where(and(eq(transactionCategories.userId, userA.id), eq(transactionCategories.id, mirrored.id))),
    );
    expect(row?.parentId).toBe(parent.id);
    // A no-op "rename" to the name it already has is not a rename, so it passes.
    const same = await app.request(`/api/v1/expenses/categories/${mirrored.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Wallet: Groceries" }),
    });
    expect(same.status).toBe(200);
  });

  it("creates and renames labels, and 404s an id that is not the caller's", async () => {
    const { app, db, userA } = await seed();
    const [other] = await db
      .insert(users)
      .values({ organizationId: userA.organizationId, displayName: "B" })
      .returning();

    const created = await app.request("/api/v1/expenses/labels", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Holiday", color: "#abc" }),
    });
    expect(created.status).toBe(201);
    const label = (await created.json()) as { id: string };

    const renamed = await app.request(`/api/v1/expenses/labels/${label.id}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Travel" }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "Travel", color: "#abc" });

    const stolen = await app.request(`/api/v1/expenses/labels/${label.id}`, {
      method: "PATCH",
      headers: headers(other!.id),
      body: JSON.stringify({ name: "Mine now" }),
    });
    expect(stolen.status).toBe(404);
  });
});
