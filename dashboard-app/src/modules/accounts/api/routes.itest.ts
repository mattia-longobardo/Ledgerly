import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { budgetAllocations, budgets, interestRules, organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import {
  AccountGroupListResponseSchema,
  AccountGroupSchema,
  AccountListResponseSchema,
  AccountSchema,
  BalancePointSchema,
  BalancesPageSchema,
  DeleteAccountResponseSchema,
  DeleteResponseSchema,
  ErrorResponseSchema,
  NetWorthSeriesSchema,
} from "./schemas";

describe("accounts routes", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seed() {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Acme" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [userB] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const deps: ApiDeps = {
      db,
      authenticate: async (req: Request) => {
        const id = req.headers.get("x-test-user");
        if (!id) return null;
        const roles = [(req.headers.get("x-test-role") ?? "owner") as RoleCode];
        const principal: Principal = {
          userId: id,
          organizationId: org!.id,
          roles,
          permissions: permissionsForRoles(roles),
        };
        return { principal, method: "session" as const };
      },
      now: () => new Date("2026-09-02T10:00:00Z"),
      rateLimitEnabled: false,
    };
    const app = createApiApp(deps);
    return { app, userA: userA!, userB: userB! };
  }

  /** Writes are cookie-authenticated here, so they all carry the CSRF header the app requires. */
  function headers(userId: string, extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      "x-test-user": userId,
      "x-requested-with": "fetch",
      ...extra,
    };
  }

  it("covers create, idempotent replay, list, versioned update, balances pagination, cross-user 404 and delete", async () => {
    const { app, userA, userB } = await seed();
    const hA = headers(userA.id);
    const hB = headers(userB.id);
    const createBody = JSON.stringify({ name: "Checking", type: "checking" });

    const create1 = await app.request("/api/v1/accounts", {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "k1" }),
      body: createBody,
    });
    expect(create1.status).toBe(201);
    const created = await create1.json();
    expect(AccountSchema.parse(created)).toBeTruthy();
    expect(created.name).toBe("Checking");
    expect(created.version).toBe(1);
    const id = created.id as string;

    // Same key + same body replays the identical response.
    const create2 = await app.request("/api/v1/accounts", {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "k1" }),
      body: createBody,
    });
    expect(create2.status).toBe(201);
    expect(await create2.json()).toEqual(created);

    const list = await app.request("/api/v1/accounts", { headers: hA });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(AccountListResponseSchema.parse(listBody)).toBeTruthy();
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].account.id).toBe(id);

    const patch1 = await app.request(`/api/v1/accounts/${id}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": "1" }),
      body: JSON.stringify({ name: "Checking renamed" }),
    });
    expect(patch1.status).toBe(200);
    const patched = await patch1.json();
    expect(AccountSchema.parse(patched)).toBeTruthy();
    expect(patched.name).toBe("Checking renamed");
    expect(patched.version).toBe(2);

    const patch2 = await app.request(`/api/v1/accounts/${id}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": "1" }),
      body: JSON.stringify({ name: "Again" }),
    });
    expect(patch2.status).toBe(409);
    const patch2Body = await patch2.json();
    expect(ErrorResponseSchema.parse(patch2Body)).toBeTruthy();
    expect(patch2Body.error.code).toBe("version_mismatch");

    const bal1 = await app.request(`/api/v1/accounts/${id}/balances`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "b1" }),
      body: JSON.stringify({ asOf: "2026-08-30", balance: "100.00" }),
    });
    expect(bal1.status).toBe(201);
    const bal1Body = await bal1.json();
    expect(BalancePointSchema.parse(bal1Body)).toBeTruthy();
    expect(bal1Body.asOf).toBe("2026-08-30");

    const bal2 = await app.request(`/api/v1/accounts/${id}/balances`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "b2" }),
      body: JSON.stringify({ asOf: "2026-08-31", balance: "150.00" }),
    });
    expect(bal2.status).toBe(201);
    expect(BalancePointSchema.parse(await bal2.json())).toBeTruthy();

    const page1 = await app.request(`/api/v1/accounts/${id}/balances?limit=1`, { headers: hA });
    expect(page1.status).toBe(200);
    const page1Body = await page1.json();
    expect(BalancesPageSchema.parse(page1Body)).toBeTruthy();
    expect(page1Body.items).toHaveLength(1);
    expect(page1Body.items[0].asOf).toBe("2026-08-31");
    expect(typeof page1Body.nextCursor).toBe("string");

    const page2 = await app.request(
      `/api/v1/accounts/${id}/balances?limit=1&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
      { headers: hA },
    );
    expect(page2.status).toBe(200);
    const page2Body = await page2.json();
    expect(BalancesPageSchema.parse(page2Body)).toBeTruthy();
    expect(page2Body.items).toHaveLength(1);
    expect(page2Body.items[0].asOf).toBe("2026-08-30");
    expect(page2Body.nextCursor).toBeUndefined();

    const crossUser = await app.request(`/api/v1/accounts/${id}`, { headers: hB });
    expect(crossUser.status).toBe(404);
    expect(ErrorResponseSchema.parse(await crossUser.json())).toBeTruthy();

    const del = await app.request(`/api/v1/accounts/${id}`, { method: "DELETE", headers: hA });
    expect(del.status).toBe(200);
    const delBody = await del.json();
    expect(DeleteAccountResponseSchema.parse(delBody)).toBeTruthy();
    expect(delBody.outcome).toBe("deleted");
  });

  /**
   * Ruling P9-8. `hasReferences` answered `false` unconditionally, so this
   * endpoint hard-deleted a referenced manual account: the interest rule went
   * with it through `ON DELETE CASCADE` (and the accruals under the rule with
   * that), and the budget allocation was left pointing at an account that no
   * longer existed. The unreferenced case above still hard-deletes, which is
   * the half that had to keep working.
   */
  it("archives rather than deletes a manual account something still references", async () => {
    const { app, userA } = await seed();
    const db = await testDb();
    const h = headers(userA.id);

    // Account creation is one of the idempotent writes, so each POST carries
    // its own key.
    async function makeAccount(name: string): Promise<string> {
      const res = await app.request("/api/v1/accounts", {
        method: "POST",
        headers: headers(userA.id, { "idempotency-key": name }),
        body: JSON.stringify({ name, type: "checking" }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).id as string;
    }

    const withRule = await makeAccount("Has an interest rule");
    const withAllocation = await makeAccount("Funds a budget");

    const [ruleId, allocationId] = await withUserContext(db, { userId: userA.id }, async (tx) => {
      const [rule] = await tx
        .insert(interestRules)
        .values({ userId: userA.id, accountId: withRule, annualRate: "0.022500", effectiveFrom: "2026-01-01" })
        .returning();
      const [budget] = await tx
        .insert(budgets)
        .values({ userId: userA.id, name: "Holidays", startDate: "2026-01-01" })
        .returning();
      const [allocation] = await tx
        .insert(budgetAllocations)
        .values({
          budgetId: budget!.id,
          sourceKind: "account",
          sourceId: withAllocation,
          amount: "200.00",
          effectiveFrom: "2026-01-01",
        })
        .returning();
      return [rule!.id, allocation!.id];
    });

    for (const id of [withRule, withAllocation]) {
      const del = await app.request(`/api/v1/accounts/${id}`, { method: "DELETE", headers: h });
      expect(del.status).toBe(200);
      expect((await del.json()).outcome).toBe("archived");

      // Still readable — archived, not gone. The detail route wraps the row.
      const after = await app.request(`/api/v1/accounts/${id}`, { headers: h });
      expect(after.status).toBe(200);
      expect((await after.json()).account.status).toBe("archived");
    }

    // The rows the hard delete would have taken with it, or orphaned.
    const survivors = await withUserContext(db, { userId: userA.id }, async (tx) => ({
      rules: await tx.select().from(interestRules).where(eq(interestRules.id, ruleId)),
      allocations: await tx.select().from(budgetAllocations).where(eq(budgetAllocations.id, allocationId)),
    }));
    expect(survivors.rules).toHaveLength(1);
    expect(survivors.allocations).toHaveLength(1);
    expect(survivors.allocations[0]!.sourceId).toBe(withAllocation);
  });

  it("account detail returns 404 for an id the caller does not own or that does not exist", async () => {
    const { app, userA } = await seed();
    const res = await app.request("/api/v1/accounts/00000000-0000-7000-8000-00000000ffff", {
      headers: headers(userA.id),
    });
    expect(res.status).toBe(404);
  });

  it("account groups: create, list, rename, and delete clears groupId on the account", async () => {
    const { app, userA } = await seed();
    const hA = headers(userA.id);

    const create = await app.request("/api/v1/account-groups", {
      method: "POST",
      headers: hA,
      body: JSON.stringify({ name: "Savings" }),
    });
    expect(create.status).toBe(201);
    const group = await create.json();
    expect(AccountGroupSchema.parse(group)).toBeTruthy();
    expect(group.name).toBe("Savings");

    const dupe = await app.request("/api/v1/account-groups", {
      method: "POST",
      headers: hA,
      body: JSON.stringify({ name: "Savings" }),
    });
    expect(dupe.status).toBe(422);
    expect((await dupe.json()).error.code).toBe("validation_failed");

    const list = await app.request("/api/v1/account-groups", { headers: hA });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(AccountGroupListResponseSchema.parse(listBody)).toBeTruthy();
    expect(listBody.items).toHaveLength(1);

    const rename = await app.request(`/api/v1/account-groups/${group.id}`, {
      method: "PATCH",
      headers: hA,
      body: JSON.stringify({ name: "Long-term savings" }),
    });
    expect(rename.status).toBe(200);
    const renamed = await rename.json();
    expect(AccountGroupSchema.parse(renamed)).toBeTruthy();
    expect(renamed.name).toBe("Long-term savings");

    const createAccount = await app.request("/api/v1/accounts", {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "g1" }),
      body: JSON.stringify({ name: "In group", type: "cash", groupId: group.id }),
    });
    expect(createAccount.status).toBe(201);
    const account = await createAccount.json();
    expect(account.groupId).toBe(group.id);

    const del = await app.request(`/api/v1/account-groups/${group.id}`, { method: "DELETE", headers: hA });
    expect(del.status).toBe(200);
    expect(DeleteResponseSchema.parse(await del.json())).toBeTruthy();

    const detail = await app.request(`/api/v1/accounts/${account.id}`, { headers: hA });
    expect((await detail.json()).account.groupId).toBeNull();
  });

  it("refuses a cookie-authenticated write that omits X-Requested-With", async () => {
    const { app, userA } = await seed();
    const res = await app.request("/api/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userA.id, "idempotency-key": "csrf1" },
      body: JSON.stringify({ name: "Checking", type: "checking" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorResponseSchema.parse(body)).toBeTruthy();
    expect(body.error.code).toBe("csrf_required");

    // Reads are untouched by the check.
    const list = await app.request("/api/v1/accounts", {
      headers: { "x-test-user": userA.id },
    });
    expect(list.status).toBe(200);
  });

  it("net worth reports totals for included accounts", async () => {
    const { app, userA } = await seed();
    const hA = headers(userA.id);
    await app.request("/api/v1/accounts", {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "nw1" }),
      body: JSON.stringify({
        name: "Cash",
        type: "cash",
        openingBalance: { asOf: "2026-08-31", balance: "500.00" },
      }),
    });
    const res = await app.request("/api/v1/net-worth?months=2", { headers: hA });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(NetWorthSeriesSchema.parse(body)).toBeTruthy();
    expect(body.total.at(-1)?.value).toBe(500);
  });
});
