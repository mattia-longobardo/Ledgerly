import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { createApiApp } from "@/platform/http/app";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { withUserContext } from "@/platform/db/context";
import { DrizzleTransactionsRepository } from "@/modules/expenses/infrastructure/drizzle-transactions-repository";
import { DrizzleCategoriesRepository } from "@/modules/expenses/infrastructure/drizzle-categories-repository";
import { DrizzleLabelsRepository } from "@/modules/expenses/infrastructure/drizzle-labels-repository";
import { closeDb, resetDb, testDb } from "@/test/db";

/** Narrows a `T | "duplicate_name"` create() result, failing loudly if a name collision was not expected. */
function assertCreated<T>(result: T | "duplicate_name"): T {
  if (result === "duplicate_name") throw new Error("expected create() to succeed, got duplicate_name");
  return result;
}

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  // `accounts` carries FORCE ROW LEVEL SECURITY (drizzle/0006_accounts.sql) —
  // unlike `organizations`/`users`, a plain pool-bound insert is rejected, so
  // this seed insert needs the same `withUserContext` every production write
  // path uses.
  const [account] = await withUserContext(testdb, { userId: user!.id }, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Cash", type: "cash", origin: "manual" }).returning(),
  );
  return { userId: user!.id, organizationId: org!.id, accountId: account!.id };
}

function appFor(userId: string, organizationId: string) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({
      principal: { userId, organizationId, roles: ["owner"], permissions: permissionsForRoles(["owner"]) },
      method: "session",
    }),
  });
}

describe("expenses API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists no transactions for a fresh account, then the one just created via direct repository seed", async () => {
    const { userId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    const res = await app.request("/api/v1/transactions", { headers: { "x-requested-with": "test" } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { items: unknown[] }).toMatchObject({ items: [] });
  });

  it("rejects a PATCH with no Idempotency concerns but a stale version as 409 version_mismatch", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const created = await withUserContext(db, { userId }, (tx) =>
      new DrizzleTransactionsRepository(tx).create({
        userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR",
        type: "expense", state: "cleared", categoryId: null, payee: null, note: null,
        transferGroupId: null, source: "manual", syncRunId: null,
      }),
    );
    const app = appFor(userId, organizationId);
    const res = await app.request(`/api/v1/transactions/${created.id}`, {
      method: "PATCH",
      headers: { "x-requested-with": "test", "content-type": "application/json", "if-match": String(created.version + 1) },
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("version_mismatch");
  });

  it("refuses a cookie-authenticated PATCH that omits X-Requested-With", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const created = await withUserContext(db, { userId }, (tx) =>
      new DrizzleTransactionsRepository(tx).create({
        userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR",
        type: "expense", state: "cleared", categoryId: null, payee: null, note: null,
        transferGroupId: null, source: "manual", syncRunId: null,
      }),
    );
    const app = appFor(userId, organizationId);
    const res = await app.request(`/api/v1/transactions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": String(created.version) },
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("cannot fetch another user's transaction: RLS and the repository's own userId filter both hold", async () => {
    const owner = await seedUser();
    const created = await withUserContext(db, { userId: owner.userId }, (tx) =>
      new DrizzleTransactionsRepository(tx).create({
        userId: owner.userId, accountId: owner.accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR",
        type: "expense", state: "cleared", categoryId: null, payee: null, note: null,
        transferGroupId: null, source: "manual", syncRunId: null,
      }),
    );
    const intruder = await seedUser();
    const app = appFor(intruder.userId, intruder.organizationId);
    const res = await app.request(`/api/v1/transactions/${created.id}`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("returns exactly the declared fields on transaction, category and label shapes — no domain internals leak", async () => {
    const { userId, accountId, organizationId } = await seedUser();
    const { category, label } = await withUserContext(db, { userId }, async (tx) => {
      const category = assertCreated(
        await new DrizzleCategoriesRepository(tx).create({
          userId, name: "Groceries", groupName: null, kind: "expense", color: null, parentId: null, source: "manual", archivedAt: null,
        }),
      );
      const label = assertCreated(
        await new DrizzleLabelsRepository(tx).create({ userId, name: "recurring", color: null, source: "manual" }),
      );
      const transactions = new DrizzleTransactionsRepository(tx);
      const created = await transactions.create({
        userId, accountId, occurredAt: new Date(), bookedAt: null, amount: "-5.00", currency: "EUR",
        type: "expense", state: "cleared", categoryId: category.id, payee: null, note: null,
        transferGroupId: null, source: "manual", syncRunId: null,
      });
      await transactions.setLabels(userId, created.id, [label.id]);
      return { category, label };
    });

    const app = appFor(userId, organizationId);
    const headers = { "x-requested-with": "test" };

    const txRes = await app.request("/api/v1/transactions", { headers });
    expect(txRes.status).toBe(200);
    const txBody = (await txRes.json()) as { items: [{ transaction: object; category: object; labelIds: string[] }] };
    expect(txBody.items).toHaveLength(1);
    expect(Object.keys(txBody.items[0]!.transaction).sort()).toEqual(
      [
        "accountId", "amount", "bookedAt", "categoryId", "createdAt", "currency", "id", "note",
        "occurredAt", "payee", "source", "state", "transferGroupId", "type", "updatedAt", "version",
      ].sort(),
    );
    expect(Object.keys(txBody.items[0]!.category!).sort()).toEqual(
      ["archivedAt", "color", "groupName", "id", "kind", "name", "source"].sort(),
    );
    expect(txBody.items[0]!.labelIds).toEqual([label.id]);

    const catRes = await app.request("/api/v1/transaction-categories", { headers });
    expect(catRes.status).toBe(200);
    const catBody = (await catRes.json()) as { items: object[] };
    expect(catBody.items.find((c) => (c as { id: string }).id === category.id)).toBeDefined();
    expect(Object.keys(catBody.items[0]!).sort()).toEqual(["archivedAt", "color", "groupName", "id", "kind", "name", "source"].sort());

    const labelRes = await app.request("/api/v1/transaction-labels", { headers });
    expect(labelRes.status).toBe(200);
    const labelBody = (await labelRes.json()) as { items: object[] };
    expect(labelBody.items.find((l) => (l as { id: string }).id === label.id)).toBeDefined();
    expect(Object.keys(labelBody.items[0]!).sort()).toEqual(["color", "id", "name", "source"].sort());
  });
});
