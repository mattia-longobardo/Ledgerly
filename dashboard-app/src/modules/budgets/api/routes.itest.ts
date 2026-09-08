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

  /**
   * Every path in `value` whose leaf key is an ownership field, so a failure
   * names where the leak is rather than just that there is one.
   */
  function ownershipKeysIn(value: unknown, path = "$"): string[] {
    if (Array.isArray(value)) return value.flatMap((item, i) => ownershipKeysIn(item, `${path}[${i}]`));
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      key === "userId" || key === "actorUserId"
        ? [`${path}.${key}`]
        : ownershipKeysIn(nested, `${path}.${key}`),
    );
  }

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
    // A second real user in the same organization: `deleteManualUsage` and
    // `endAllocation` take no `userId` at the repository layer, so their
    // cross-user safety rests entirely on RLS and needs a live proof.
    const [other] = await db.insert(users).values({ organizationId: organization!.id, displayName: "B" }).returning();
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
    return { app: createApiApp(deps), db, userId: user!.id, otherUserId: other!.id, accountId: account!.id };
  }

  async function createBudget(
    app: ReturnType<typeof createApiApp>,
    userId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number } & Record<string, unknown>> {
    const res = await app.request("/api/v1/budgets", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        name: "Budget",
        description: null,
        currency: "EUR",
        periodKind: "monthly",
        startDate: "2026-01-01",
        endDate: null,
        goalAmount: null,
        labels: [],
        initialAmount: "1000.00",
        ...overrides,
      }),
    });
    expect(res.status).toBe(201);
    return res.json() as Promise<{ id: string; version: number } & Record<string, unknown>>;
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

    // `docs/api/README.md` states budget, allocation, usage and event
    // responses never expose ownership fields. `events[].detail` is an open
    // record holding whole domain snapshots (`create-budget` stores
    // `{ budget }`, carrying `userId`), so asserting on the DTO's own keys
    // alone would miss it — walk the whole response instead.
    const events = detail.events as { kind: string; detail: unknown }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.kind === "budget_created")).toBe(true);
    expect(ownershipKeysIn(detail)).toEqual([]);

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

    // Un-archiving must clear `archivedAt`, not just flip `status` — the same
    // desync closed above, from the other direction.
    const reactivateRes = await app.request(`/api/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ status: "active", version: archived.version }),
    });
    expect(reactivateRes.status).toBe(200);
    const reactivated = (await reactivateRes.json()) as { status: string; archivedAt: string | null };
    expect(reactivated.status).toBe("active");
    expect(reactivated.archivedAt).toBeNull();
  });

  it("lists the caller's budgets with figures, and filters archived ones by default", async () => {
    const { app, userId } = await seed();
    const active = await createBudget(app, userId, { name: "Active one", initialAmount: "200.00" });
    const toArchive = await createBudget(app, userId, { name: "Will archive" });
    const archiveRes = await app.request(`/api/v1/budgets/${toArchive.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ status: "archived", version: toArchive.version }),
    });
    expect(archiveRes.status).toBe(200);

    const defaultList = await app.request("/api/v1/budgets", { headers: headers(userId) });
    expect(defaultList.status).toBe(200);
    const defaultBody = (await defaultList.json()) as { items: Record<string, unknown>[] };
    expect(defaultBody.items.map((item) => (item.budget as Record<string, unknown>).id)).toEqual([active.id]);
    expect(defaultBody.items[0]).toMatchObject({ budget: { id: active.id }, figures: { initial: "200.00" } });

    const fullList = await app.request("/api/v1/budgets?includeArchived=true", { headers: headers(userId) });
    expect(fullList.status).toBe(200);
    const fullBody = (await fullList.json()) as { items: Record<string, unknown>[] };
    expect(fullBody.items.map((item) => (item.budget as Record<string, unknown>).id).sort()).toEqual([active.id, toArchive.id].sort());
  });

  it("records a new initial-amount version that takes effect on its own effectiveFrom date", async () => {
    const { app, userId } = await seed();
    const budget = await createBudget(app, userId, { initialAmount: "1000.00" });

    const versionRes = await app.request(`/api/v1/budgets/${budget.id}/amount-versions`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({ initialAmount: "1500.00", effectiveFrom: "2026-06-01", reason: "Raise" }),
    });
    expect(versionRes.status).toBe(201);
    const version = (await versionRes.json()) as Record<string, unknown>;
    expect(version).toMatchObject({ budgetId: budget.id, initialAmount: "1500.00", effectiveFrom: "2026-06-01", reason: "Raise" });
    expect(version).not.toHaveProperty("actorUserId");

    // Today (the real system clock, well after 2026-06-01) is past the new
    // version's effectiveFrom, so it — not the original 1000.00 — is now the
    // figure `getBudgetDetail` reports.
    const detailRes = await app.request(`/api/v1/budgets/${budget.id}`, { headers: headers(userId) });
    const detail = (await detailRes.json()) as { figures: { initial: string }; versions: unknown[] };
    expect(detail.figures.initial).toBe("1500.00");
    expect(detail.versions).toHaveLength(2);
  });

  it("ends an allocation via PATCH, proving the {id, aid} params reach endAllocation in the right order", async () => {
    const { app, userId } = await seed();
    // A second budget makes the `{id, aid}` → `endAllocation(principal,
    // budgetId, allocationId, ...)` argument order testable: `endAllocation`
    // scopes its lookup with `deps.allocations.get(budgetId, allocationId)`,
    // so addressing the real allocation through the *wrong* budget's id
    // must 404. If the route ever passed `id`/`aid` to `endAllocation` in
    // the wrong order, this would either always 404 (an allocation id is
    // never a valid budget id) or, worse, silently succeed against the
    // wrong row — either way this test would catch it.
    const other = await createBudget(app, userId, { name: "Unrelated" });
    const budget = await createBudget(app, userId);
    const allocationRes = await app.request(`/api/v1/budgets/${budget.id}/allocations`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        sourceKind: "none", sourceId: null, amount: "40.00", recurrence: "monthly",
        effectiveFrom: "2026-01-01", effectiveTo: null, note: null,
      }),
    });
    expect(allocationRes.status).toBe(201);
    const allocation = (await allocationRes.json()) as { id: string; version: number };

    // A `once` allocation contributes its amount regardless of `effectiveTo`
    // (see `allocatedThrough`), so ending one would change no figure. The use
    // case rejects it and the route must surface that as a 422, not a
    // success the UI would render as "Ended …".
    const onceRes = await app.request(`/api/v1/budgets/${budget.id}/allocations`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        sourceKind: "none", sourceId: null, amount: "10.00", recurrence: "once",
        effectiveFrom: "2026-01-01", effectiveTo: null, note: null,
      }),
    });
    const once = (await onceRes.json()) as { id: string; version: number };
    const endOnceRes = await app.request(`/api/v1/budgets/${budget.id}/allocations/${once.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ version: once.version, effectiveTo: "2026-03-31" }),
    });
    expect(endOnceRes.status).toBe(422);

    const wrongBudgetRes = await app.request(`/api/v1/budgets/${other.id}/allocations/${allocation.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ version: allocation.version, effectiveTo: "2026-03-31" }),
    });
    expect(wrongBudgetRes.status).toBe(404);

    const endRes = await app.request(`/api/v1/budgets/${budget.id}/allocations/${allocation.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ version: allocation.version, effectiveTo: "2026-03-31" }),
    });
    expect(endRes.status).toBe(200);
    const ended = (await endRes.json()) as Record<string, unknown>;
    expect(ended).toMatchObject({ id: allocation.id, budgetId: budget.id, effectiveTo: "2026-03-31", version: allocation.version + 1 });

    // A stale version on the same allocation still 409s, same convention as
    // the budget-level PATCH.
    const staleEndRes = await app.request(`/api/v1/budgets/${budget.id}/allocations/${allocation.id}`, {
      method: "PATCH",
      headers: headers(userId),
      body: JSON.stringify({ version: allocation.version, effectiveTo: "2026-04-30" }),
    });
    expect(staleEndRes.status).toBe(409);
    expect((await staleEndRes.json()).error.code).toBe("version_mismatch");
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

  /**
   * `deleteManualUsage` and `endAllocation` are the two budgets use cases
   * whose repository methods take no `userId` (`application/ports.ts`) — they
   * are scoped by `budgetId` alone and rest entirely on RLS's
   * `EXISTS`-to-parent policy for cross-user safety. Nothing else in the
   * suite drives a second real user at another user's budget, so a regression
   * that widened those policies would pass every other test.
   */
  it("refuses a second user's delete-usage and end-allocation against another user's budget", async () => {
    const { app, db, userId, otherUserId } = await seed();
    const budget = await createBudget(app, userId);

    const allocationRes = await app.request(`/api/v1/budgets/${budget.id}/allocations`, {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({
        sourceKind: "none", sourceId: null, amount: "40.00", recurrence: "monthly",
        effectiveFrom: "2026-01-01", effectiveTo: null, note: null,
      }),
    });
    expect(allocationRes.status).toBe(201);
    const allocation = (await allocationRes.json()) as { id: string; version: number };

    const usageRes = await app.request(`/api/v1/budgets/${budget.id}/usages`, {
      method: "POST",
      headers: headers(userId, "owner", { "idempotency-key": "cross-user-usage" }),
      body: JSON.stringify({ amount: "12.00", occurredAt: "2026-02-01", note: "mine" }),
    });
    expect(usageRes.status).toBe(201);
    const usage = (await usageRes.json()) as { id: string };

    const stolenDelete = await app.request(`/api/v1/budgets/${budget.id}/usages/${usage.id}`, {
      method: "DELETE",
      headers: headers(otherUserId),
    });
    expect(stolenDelete.status).toBe(404);

    const stolenEnd = await app.request(`/api/v1/budgets/${budget.id}/allocations/${allocation.id}`, {
      method: "PATCH",
      headers: headers(otherUserId),
      body: JSON.stringify({ version: allocation.version, effectiveTo: "2026-03-31" }),
    });
    expect(stolenEnd.status).toBe(404);

    // Neither row moved: a 404 that had already written would be worse than
    // a 200, so assert the state, not only the status code.
    const rows = await withUserContext(db, { userId }, (tx) =>
      tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget.id)),
    );
    expect(rows.map((row) => row.id)).toEqual([usage.id]);

    const detail = (await (await app.request(`/api/v1/budgets/${budget.id}`, { headers: headers(userId) })).json()) as {
      allocations: { id: string; effectiveTo: string | null }[];
    };
    expect(detail.allocations.find((row) => row.id === allocation.id)?.effectiveTo).toBeNull();
  });
});
