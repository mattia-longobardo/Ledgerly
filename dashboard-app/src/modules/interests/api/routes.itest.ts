import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, accountBalances, organizations, users } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { createApiApp } from "@/platform/http/app";
import { permissionsForRoles } from "@/platform/auth/permissions";
import { withUserContext } from "@/platform/db/context";
import { DrizzleInterestRulesRepository } from "@/modules/interests/infrastructure/drizzle-interest-rules-repository";
import { DrizzleInterestAccrualsRepository } from "@/modules/interests/infrastructure/drizzle-interest-accruals-repository";
import { DrizzleInterestEntriesRepository } from "@/modules/interests/infrastructure/drizzle-interest-entries-repository";
import { closeDb, resetDb, testDb } from "@/test/db";

async function seedUser() {
  const testdb = await testDb();
  const [org] = await testdb.insert(organizations).values({ name: "P" }).returning();
  const [user] = await testdb.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await withUserContext(testdb, { userId: user!.id }, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning(),
  );
  return { userId: user!.id, organizationId: org!.id, accountId: account!.id };
}

function appFor(userId: string, organizationId: string) {
  return createApiApp({
    db,
    now: () => new Date("2026-09-05T09:00:00Z"),
    rateLimitEnabled: false,
    authenticate: async () => ({ principal: { userId, organizationId, roles: ["owner"], permissions: permissionsForRoles(["owner"]) }, method: "session" }),
  });
}

describe("interests API", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("creates a rule defaulting to analyze_only, then reads it back with a reconciliation and a projection", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    // A projection needs a balance to project from — `getInterestRuleDetail`
    // reports an empty (never fabricated) projection when none is on file,
    // matching the "never invent financial data" rule, so this test seeds
    // one to exercise the non-empty path instead.
    await withUserContext(db, { userId }, (tx) =>
      tx.insert(accountBalances).values({ accountId, asOf: "2026-09-01", balance: "1000.00", source: "manual" }),
    );
    const app = appFor(userId, organizationId);
    const createRes = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string; postingMode: string };
    expect(created.postingMode).toBe("analyze_only");

    const getRes = await app.request(`/api/v1/interest-rules/${created.id}?periodStart=2026-09-01&periodEnd=2026-09-30&projectionDays=5`, {
      headers: { "x-requested-with": "test" },
    });
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as { reconciliation: { status: string }; projection: unknown[] };
    // No accrual job has run for this rule/period yet, so there is no basis
    // for comparison at all — `reconcileInterest` (Task 14's review) reports
    // this as the distinct `no_data` status, never `matched` and never the
    // pre-fix `missing` a period with zero accrual rows used to get.
    expect(detail.reconciliation.status).toBe("no_data");
    expect(detail.projection).toHaveLength(5);
  });

  it("rejects a PATCH with a stale version as 409 version_mismatch", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const app = appFor(userId, organizationId);
    const createRes = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    const created = (await createRes.json()) as { id: string; version: number };
    const patchRes = await app.request(`/api/v1/interest-rules/${created.id}`, {
      method: "PATCH",
      headers: { "x-requested-with": "test", "content-type": "application/json", "if-match": String(created.version + 1) },
      body: JSON.stringify({ annualRate: "0.03" }),
    });
    expect(patchRes.status).toBe(409);
    expect(((await patchRes.json()) as { error: { code: string } }).error.code).toBe("version_mismatch");
  });

  it("refuses a cookie-authenticated POST that omits X-Requested-With", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const app = appFor(userId, organizationId);
    const res = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
  });

  it("cannot fetch another user's rule: RLS and the use case's own userId scoping both hold", async () => {
    const owner = await seedUser();
    const ownerApp = appFor(owner.userId, owner.organizationId);
    const createRes = await ownerApp.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId: owner.accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    const created = (await createRes.json()) as { id: string };

    const intruder = await seedUser();
    const intruderApp = appFor(intruder.userId, intruder.organizationId);
    const res = await intruderApp.request(`/api/v1/interest-rules/${created.id}?periodStart=2026-09-01&periodEnd=2026-09-30`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("returns exactly the declared fields on rule, accrual and entry shapes — no domain internals leak", async () => {
    const { userId, accountId, organizationId } = await seedUser();
    const app = appFor(userId, organizationId);
    const createRes = await app.request("/api/v1/interest-rules", {
      method: "POST",
      headers: { "x-requested-with": "test", "content-type": "application/json" },
      body: JSON.stringify({ accountId, annualRate: "0.0225", taxRate: "0.26", dayCount: 365, effectiveFrom: "2026-01-01" }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(Object.keys(created).sort()).toEqual(
      [
        "id", "accountId", "annualRate", "taxRate", "dayCount", "compounding", "effectiveFrom", "effectiveTo",
        "postingMode", "providerCategoryRef", "noteMarker", "version", "createdAt", "updatedAt",
      ].sort(),
    );

    const ruleId = created.id as string;
    await withUserContext(db, { userId }, async (tx) => {
      await new DrizzleInterestAccrualsRepository(tx).upsert({
        ruleId,
        accrualDate: "2026-09-01",
        balanceBasis: "1000.00",
        gross: "0.061644",
        tax: "0.016027",
        net: "0.05",
        carryAfter: "-0.004617",
        source: "computed",
        postedAt: null,
        entryId: null,
      });
      await new DrizzleInterestEntriesRepository(tx).create({
        userId,
        accountId,
        occurredAt: new Date("2026-09-15T00:00:00Z"),
        gross: "0.10",
        net: "0.07",
        kind: "paid",
        transactionId: null,
        ruleId,
        source: "provider",
      });
    });

    const getRes = await app.request(`/api/v1/interest-rules/${ruleId}?periodStart=2026-09-01&periodEnd=2026-09-30`, {
      headers: { "x-requested-with": "test" },
    });
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as { accruals: Record<string, unknown>[]; entries: Record<string, unknown>[] };
    expect(detail.accruals).toHaveLength(1);
    expect(Object.keys(detail.accruals[0]!).sort()).toEqual(
      ["id", "accrualDate", "balanceBasis", "gross", "tax", "net", "carryAfter", "postedAt"].sort(),
    );
    expect(detail.entries).toHaveLength(1);
    expect(Object.keys(detail.entries[0]!).sort()).toEqual(["id", "occurredAt", "gross", "net", "kind", "source"].sort());
  });

  // Task 17's reviewer flagged this as unverified: `dailyInterest` (Task 14's
  // review) now throws on a negative `annualRate` rather than silently
  // flooring to zero, but a rule already in the database can still carry one
  // if it was written before that validation existed, or inserted directly.
  // This proves what an API caller actually sees when a read path reaches
  // that throw: a clean 500, not a hang or an unhandled rejection.
  it("returns a clean 500 rather than hanging when a stored rule has an invalid rate and the domain throws", async () => {
    const { userId, organizationId, accountId } = await seedUser();
    const rule = await withUserContext(db, { userId }, async (tx) => {
      await tx.insert(accountBalances).values({ accountId, asOf: "2026-09-01", balance: "1000.00", source: "manual" });
      return new DrizzleInterestRulesRepository(tx).create({
        userId,
        accountId,
        annualRate: "-0.01", // invalid: dailyInterest rejects a negative annualRate
        taxRate: "0.26",
        dayCount: 365,
        compounding: "simple_daily",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        postingMode: "analyze_only",
        providerCategoryRef: null,
        noteMarker: "auto-interest",
      });
    });

    const app = appFor(userId, organizationId);
    const res = await app.request(`/api/v1/interest-rules/${rule.id}?periodStart=2026-09-01&periodEnd=2026-09-30&projectionDays=5`, {
      headers: { "x-requested-with": "test" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("internal");
    expect(body.error.requestId).toBeTruthy();
  });
});
