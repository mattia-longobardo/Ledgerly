import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  fundContributions,
  funds,
  idempotencyKeys,
  organizations,
  reconciliationIssues,
  users,
} from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { closeDb, resetDb, testDb } from "@/test/db";

describe("funds routes", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seed() {
    const db = await testDb();
    const [organization] = await db.insert(organizations).values({ name: "Funds household" }).returning();
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
      now: () => new Date("2026-09-06T10:00:00.000Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), db, userA: userA!, userB: userB! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      "x-test-user": userId,
      "x-requested-with": "fetch",
      ...extra,
    };
  }

  async function createFund(app: ReturnType<typeof createApiApp>, userId: string, slug = "pension") {
    const response = await app.request("/api/v1/funds", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({ slug, name: "Pension", kind: "pension", currency: "EUR" }),
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<Record<string, unknown>>;
  }

  async function overlappingRequests(
    db: Awaited<ReturnType<typeof testDb>>,
    userId: string,
    fundId: string,
    requests: (() => Promise<Response>)[],
  ): Promise<Response[]> {
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = withUserContext(db, { userId }, async (tx) => {
      await tx.select().from(funds).where(eq(funds.id, fundId)).for("no key update");
      locked();
      await gate;
    });
    await ready;
    const pending = requests.map((request) => request());
    try {
      // Both HTTP requests must have reached a database lock before we release
      // the parent. With atomic replay one waits on the key and one on the fund.
      // With the old middleware both pass the cache read and wait on the fund.
      const deadline = Date.now() + 5_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await db.execute<{ waiting: number }>(sql`
          SELECT count(*)::integer AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`);
        waiting = result.rows[0]!.waiting;
        if (waiting >= requests.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(requests.length);
    } finally {
      unlock();
      await blocker;
      await Promise.allSettled(pending);
    }
    return Promise.all(pending);
  }

  it("atomically replays overlapping identical contributions and reversals", async () => {
    const { app, db, userA } = await seed();
    const fund = await createFund(app, userA.id);
    const fundId = fund.id as string;
    const post = (path: string, key: string, body: string) => () => Promise.resolve(app.request(path, {
      method: "POST", headers: headers(userA.id, { "idempotency-key": key }), body,
    }));
    const add = post(`/api/v1/funds/${fundId}/contributions`, "overlap-add",
      JSON.stringify({ typeCode: "employee", accrualMonth: "2026-01-01", amount: "100.00" }));
    const responses = await overlappingRequests(db, userA.id, fundId, [add, add]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, replay] = await Promise.all(responses.map((response) => response.json()));
    expect(replay).toEqual(first);
    const rows = await withUserContext(db, { userId: userA.id }, (tx) => tx.select().from(fundContributions));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe("100.00");

    const reverse = post(`/api/v1/funds/${fundId}/contributions/${first.id}/reverse`, "overlap-reverse", JSON.stringify({ note: "Undo" }));
    const reversals = await overlappingRequests(db, userA.id, fundId, [reverse, reverse]);
    expect(reversals.map((response) => response.status)).toEqual([201, 201]);
    const [reversed, reversedReplay] = await Promise.all(reversals.map((response) => response.json()));
    expect(reversedReplay).toEqual(reversed);
    expect(reversed.amount).toBe("-100.00");
    const laterReplay = await reverse();
    expect(laterReplay.status).toBe(201);
    expect(await laterReplay.json()).toEqual(reversed);
    const all = await withUserContext(db, { userId: userA.id }, (tx) => tx.select().from(fundContributions));
    expect(all).toHaveLength(2);
  });

  it("rechecks the request hash after a concurrent key reservation", async () => {
    const { app, db, userA } = await seed();
    const fund = await createFund(app, userA.id);
    const fundId = fund.id as string;
    const requests = ["100.00", "200.00"].map((amount) => () => Promise.resolve(app.request(`/api/v1/funds/${fundId}/contributions`, {
      method: "POST", headers: headers(userA.id, { "idempotency-key": "different-body" }),
      body: JSON.stringify({ typeCode: "employee", accrualMonth: "2026-01-01", amount }),
    })));
    const responses = await overlappingRequests(db, userA.id, fundId, requests);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    const conflict = responses.find((response) => response.status === 422)!;
    expect((await conflict.json()).error.code).toBe("idempotency_key_reused");
    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const body = await responses[winnerIndex]!.json();
    const replay = await requests[winnerIndex]!();
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(body);
    const rows = await withUserContext(db, { userId: userA.id }, (tx) => tx.select().from(fundContributions));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(body.amount);
  });

  it.each(["idempotency_keys", "audit_events"] as const)("rolls back financial writes and successful replay records when %s fails", async (table) => {
    const { app, db, userA } = await seed();
    const fund = await createFund(app, userA.id);
    await db.execute(sql`CREATE FUNCTION funds_test_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected Funds transaction failure'; END; $$`);
    try {
      await db.execute(sql.raw(`CREATE TRIGGER funds_test_reject_write BEFORE INSERT ON ${table}
        FOR EACH ROW EXECUTE FUNCTION funds_test_reject_write()`));
      const request = () => app.request(`/api/v1/funds/${fund.id}/contributions`, {
        method: "POST", headers: headers(userA.id, { "idempotency-key": "rollback" }),
        body: JSON.stringify({ typeCode: "employee", accrualMonth: "2026-01-01", amount: "100.00" }),
      });
      const failed = await request();
      expect(failed.status).toBe(500);
      const state = await withUserContext(db, { userId: userA.id }, async (tx) => ({
        contributions: await tx.select().from(fundContributions),
        replay: await tx.select().from(idempotencyKeys),
      }));
      expect(state).toEqual({ contributions: [], replay: [] });
      await db.execute(sql.raw(`DROP TRIGGER funds_test_reject_write ON ${table}`));
      const retry = await request();
      expect(retry.status).toBe(201);
      const replay = await request();
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(await retry.json());
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS funds_test_reject_write ON ${table}`));
      await db.execute(sql`DROP FUNCTION funds_test_reject_write()`);
    }
  });

  it("serves all fund operations with explicit DTOs and optimistic concurrency", async () => {
    const { app, db, userA, userB } = await seed();
    const created = await createFund(app, userA.id);
    expect(created).toMatchObject({
      slug: "pension",
      name: "Pension",
      kind: "pension",
      currency: "EUR",
      status: "active",
      version: 1,
    });
    expect(created).not.toHaveProperty("userId");
    const fundId = created.id as string;

    const list = await app.request("/api/v1/funds", { headers: headers(userA.id) });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      fund: { id: fundId },
      value: null,
      valueAsOf: null,
      deposited: "0.00",
      absReturn: null,
      lastContributionMonth: null,
      openIssues: 0,
    });
    expect(listBody.items[0].fund).not.toHaveProperty("userId");

    const schedule = await app.request(`/api/v1/funds/${fundId}/schedules`, {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({
        frequency: "monthly",
        periodAnchorMonth: 1,
        postingLagMonths: 1,
        feePerPosting: "2.50",
        effectiveFrom: "2026-01-01",
      }),
    });
    expect(schedule.status).toBe(201);
    expect(await schedule.json()).toMatchObject({ fundId, postingLagMonths: 1, feePerPosting: "2.50" });

    const plan = await app.request(`/api/v1/funds/${fundId}/plans`, {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({
        effectiveFrom: "2026-01-01",
        initialCapital: "0.00",
        fixedMonthlyAmount: "150.00",
        note: "Baseline",
      }),
    });
    expect(plan.status).toBe(201);
    expect(await plan.json()).toMatchObject({ fundId, initialCapital: "0.00", fixedMonthlyAmount: "150.00" });

    const addBody = JSON.stringify({
      typeCode: "employee",
      accrualMonth: "2026-01-01",
      amount: "100.25",
      valueDate: "2026-02-15",
      note: "January",
    });
    const firstAdd = await app.request(`/api/v1/funds/${fundId}/contributions`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "add-january" }),
      body: addBody,
    });
    expect(firstAdd.status).toBe(201);
    const contribution = await firstAdd.json();
    expect(contribution).toMatchObject({
      fundId,
      typeCode: "employee",
      postedMonth: "2026-02-01",
      amount: "100.25",
      currency: "EUR",
      source: "manual",
    });

    const replayAdd = await app.request(`/api/v1/funds/${fundId}/contributions`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "add-january" }),
      body: addBody,
    });
    expect(replayAdd.status).toBe(201);
    expect(await replayAdd.json()).toEqual(contribution);
    const persistedAfterReplay = await withUserContext(db, { userId: userA.id }, (tx) =>
      tx.select().from(fundContributions).where(eq(fundContributions.fundId, fundId)),
    );
    expect(persistedAfterReplay).toHaveLength(1);

    for (const [key, accrualMonth, amount] of [
      ["add-february", "2026-02-01", "200.00"],
      ["add-march", "2026-03-01", "300.00"],
    ] as const) {
      const response = await app.request(`/api/v1/funds/${fundId}/contributions`, {
        method: "POST",
        headers: headers(userA.id, { "idempotency-key": key }),
        body: JSON.stringify({ typeCode: "employee", accrualMonth, amount }),
      });
      expect(response.status).toBe(201);
    }

    const contributions = await app.request(
      `/api/v1/funds/${fundId}/contributions?from=2026-03-01&to=2026-03-01`,
      { headers: headers(userA.id) },
    );
    expect(contributions.status).toBe(200);
    const contributionsBody = await contributions.json();
    expect(contributionsBody.nextCursor).toBeNull();
    expect(contributionsBody.items).toHaveLength(1);
    expect(contributionsBody.items[0]).toMatchObject({ amount: "200.00", postedMonth: "2026-03-01" });

    const reverseBody = JSON.stringify({ note: "Entered twice" });
    const reverse = await app.request(`/api/v1/funds/${fundId}/contributions/${contribution.id}/reverse`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "reverse-january" }),
      body: reverseBody,
    });
    expect(reverse.status).toBe(201);
    const reversed = await reverse.json();
    expect(reversed).toMatchObject({
      fundId,
      typeCode: "reversal",
      amount: "-100.25",
      reversesId: contribution.id,
      note: "Entered twice",
    });
    const reverseReplay = await app.request(`/api/v1/funds/${fundId}/contributions/${contribution.id}/reverse`, {
      method: "POST",
      headers: headers(userA.id, { "idempotency-key": "reverse-january" }),
      body: reverseBody,
    });
    expect(reverseReplay.status).toBe(201);
    expect(await reverseReplay.json()).toEqual(reversed);

    const detail = await app.request(`/api/v1/funds/${fundId}`, { headers: headers(userA.id) });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody).toMatchObject({
      fund: { id: fundId },
      schedule: { postingLagMonths: 1 },
      plan: { fixedMonthlyAmount: "150.00" },
    });
    expect(detailBody.contributions).toHaveLength(4);
    expect(detailBody.fund).not.toHaveProperty("userId");

    const patchWithBodyVersion = await app.request(`/api/v1/funds/${fundId}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "Pension renamed", version: 1 }),
    });
    expect(patchWithBodyVersion.status).toBe(200);
    expect(await patchWithBodyVersion.json()).toMatchObject({ name: "Pension renamed", version: 2 });

    const stalePatch = await app.request(`/api/v1/funds/${fundId}`, {
      method: "PATCH",
      headers: headers(userA.id, { "if-match": '"1"' }),
      body: JSON.stringify({ name: "Stale" }),
    });
    expect(stalePatch.status).toBe(409);
    expect((await stalePatch.json()).error.code).toBe("version_mismatch");

    const missingVersion = await app.request(`/api/v1/funds/${fundId}`, {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ name: "No precondition" }),
    });
    expect(missingVersion.status).toBe(428);
    expect((await missingVersion.json()).error.code).toBe("precondition_required");

    const crossOwner = await app.request(`/api/v1/funds/${fundId}`, { headers: headers(userB.id) });
    expect(crossOwner.status).toBe(404);
    const viewerWrite = await app.request("/api/v1/funds", {
      method: "POST",
      headers: headers(userA.id, { "x-test-role": "viewer" }),
      body: JSON.stringify({ slug: "blocked", name: "Blocked", kind: "other" }),
    });
    expect(viewerWrite.status).toBe(403);
    expect((await viewerWrite.json()).error.code).toBe("permission_denied");

    const clean = await createFund(app, userA.id, "clean");
    const reconcile = await app.request(`/api/v1/funds/${clean.id}/reconcile`, {
      method: "POST",
      headers: headers(userA.id),
    });
    expect(reconcile.status).toBe(200);
    expect(await reconcile.json()).toEqual({ detected: [], resolved: 0 });

    const [issue] = await withUserContext(db, { userId: userA.id }, (tx) =>
      tx.insert(reconciliationIssues).values({
        userId: userA.id,
        domain: "funds",
        entityType: "fund",
        entityId: `${fundId}:2026-04-01`,
        kind: "missing",
        severity: "warning",
        detail: { month: "2026-04-01" },
      }).returning(),
    );
    const acknowledge = await app.request(`/api/v1/funds/issues/${issue!.id}/acknowledge`, {
      method: "POST",
      headers: headers(userA.id),
    });
    expect(acknowledge.status).toBe(200);
    const acknowledged = await acknowledge.json();
    expect(acknowledged).toMatchObject({ id: issue!.id, status: "acknowledged" });
    expect(acknowledged).not.toHaveProperty("userId");
    expect(acknowledged).not.toHaveProperty("resolvedBy");
  });

  it("requires idempotency keys for contribution creates and reversals", async () => {
    const { app, userA } = await seed();
    const fund = await createFund(app, userA.id);
    const add = await app.request(`/api/v1/funds/${fund.id}/contributions`, {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ typeCode: "employee", accrualMonth: "2026-01-01", amount: "25.00" }),
    });
    expect(add.status).toBe(428);
    expect((await add.json()).error.code).toBe("validation_failed");

    const reverse = await app.request(`/api/v1/funds/${fund.id}/contributions/00000000-0000-7000-8000-000000000001/reverse`, {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ note: null }),
    });
    expect(reverse.status).toBe(428);
    expect((await reverse.json()).error.code).toBe("validation_failed");

    const malformed = await app.request(`/api/v1/funds/${fund.id}/contributions`, {
      method: "POST", headers: headers(userA.id), body: "not-json",
    });
    expect(malformed.status).toBe(428);
  });

  it("does not consume an idempotency key for an uncommitted validation error", async () => {
    const { app, db, userA } = await seed();
    const fund = await createFund(app, userA.id);
    const request = (amount: string) => app.request(`/api/v1/funds/${fund.id}/contributions`, {
      method: "POST", headers: headers(userA.id, { "idempotency-key": "correctable" }),
      body: JSON.stringify({ typeCode: "employee", accrualMonth: "2026-01-01", amount }),
    });
    const invalid = await request("-100.00");
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("validation_failed");
    const cached = await withUserContext(db, { userId: userA.id }, (tx) => tx.select().from(idempotencyKeys));
    expect(cached).toHaveLength(0);
    const corrected = await request("100.00");
    expect(corrected.status).toBe(201);
  });

  it("rejects malformed UUIDs, ambiguous booleans, non-month dates, and schedule lags outside 0..12", async () => {
    const { app, userA } = await seed();
    const invalidId = await app.request("/api/v1/funds/not-a-uuid", { headers: headers(userA.id) });
    expect(invalidId.status).toBe(422);

    const ambiguousBoolean = await app.request("/api/v1/funds?includeArchived=1", { headers: headers(userA.id) });
    expect(ambiguousBoolean.status).toBe(422);

    const fund = await createFund(app, userA.id);
    const invalidMonth = await app.request(
      `/api/v1/funds/${fund.id}/contributions?from=2026-02-15&to=2026-03-01`,
      { headers: headers(userA.id) },
    );
    expect(invalidMonth.status).toBe(422);

    const invalidLag = await app.request(`/api/v1/funds/${fund.id}/schedules`, {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({
        frequency: "monthly",
        periodAnchorMonth: 1,
        postingLagMonths: 13,
        feePerPosting: "0.00",
        effectiveFrom: "2026-01-01",
      }),
    });
    expect(invalidLag.status).toBe(422);
  });
});
