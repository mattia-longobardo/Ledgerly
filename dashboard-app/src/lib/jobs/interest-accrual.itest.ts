import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, accountBalances, organizations, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { NewInterestRule } from "@/modules/interests/application/ports";
import { DrizzleInterestRulesRepository } from "@/modules/interests/infrastructure/drizzle-interest-rules-repository";
import { DrizzleInterestAccrualsRepository } from "@/modules/interests/infrastructure/drizzle-interest-accruals-repository";
import { DrizzleProviderLinksRepository } from "@/modules/accounts/infrastructure/drizzle-provider-links-repository";
import { runInterestAccrualJob } from "./interest-accrual";

/** A fresh user with a savings account and a balance on file for `asOf`. */
async function seedUser(displayName: string, asOf: string, balance = "1000.00") {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: displayName }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName }).returning();
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning(),
  );
  await withSystemContext(db, (tx) =>
    tx.insert(accountBalances).values({ accountId: account!.id, asOf, balance, source: "manual" }),
  );
  return { userId: user!.id, accountId: account!.id };
}

function newRule(userId: string, accountId: string, over: Partial<NewInterestRule> = {}): NewInterestRule {
  return {
    userId,
    accountId,
    annualRate: "0.0225",
    taxRate: "0.26",
    dayCount: 365,
    compounding: "simple_daily",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    postingMode: "analyze_only",
    providerCategoryRef: null,
    noteMarker: "auto-interest",
    ...over,
  };
}

async function createRule(input: NewInterestRule) {
  const db = await testDb();
  return withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).create(input));
}

describe("runInterestAccrualJob", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("accrues today for every user with an active rule and a recorded balance", async () => {
    const db = await testDb();
    const { userId, accountId } = await seedUser("A", "2026-09-05");
    await createRule(newRule(userId, accountId));

    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ rulesConsidered: 1, accrued: 1, failed: 0 });

    const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(userId));
    const accrued = await withSystemContext(db, (tx) => new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"));
    expect(accrued).toHaveLength(1);
    expect(accrued[0]!.net).not.toBe("0.00");
  });

  it("running the job twice for the same day does not duplicate the accrual", async () => {
    const db = await testDb();
    const { userId, accountId } = await seedUser("A", "2026-09-05");
    await createRule(newRule(userId, accountId));

    await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T18:00:00Z") });

    const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(userId));
    const accrued = await withSystemContext(db, (tx) => new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"));
    expect(accrued).toHaveLength(1);
  });

  it("a second run over an already-posted day leaves postedAt/entryId untouched (Ruling P3-16)", async () => {
    const db = await testDb();
    const { userId, accountId } = await seedUser("A", "2026-09-05");
    await createRule(newRule(userId, accountId));

    await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });

    const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(userId));
    const [firstAccrual] = await withSystemContext(db, (tx) =>
      new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"),
    );
    // Simulate the accrual having already been posted to a real account by a
    // separate posting step, the way `postingMode: "post_to_provider"` would.
    const postedAt = new Date("2026-09-05T13:00:00Z");
    const entryId = crypto.randomUUID();
    await withSystemContext(db, (tx) => new DrizzleInterestAccrualsRepository(tx).markPosted(firstAccrual!.id, entryId, postedAt));

    // The job re-runs later the same day (e.g. a retried cron tick).
    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T20:00:00Z") });
    expect(result.status).toBe("success");

    const [reread] = await withSystemContext(db, (tx) =>
      new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"),
    );
    expect(reread!.id).toBe(firstAccrual!.id);
    expect(reread!.postedAt?.toISOString()).toBe(postedAt.toISOString());
    expect(reread!.entryId).toBe(entryId);
  });

  it("one user's invalid rule fails in isolation — the run still completes and accrues for every other user", async () => {
    const db = await testDb();
    const good = await seedUser("Good", "2026-09-05");
    await createRule(newRule(good.userId, good.accountId));

    const bad = await seedUser("Bad", "2026-09-05");
    // `dailyInterest` throws on a negative annualRate (Task 14's contract
    // change). `createInterestRule` rejects this at the write boundary, but a
    // row written by a path that bypasses the use case — here, the
    // repository directly — can still reach the job.
    await createRule(newRule(bad.userId, bad.accountId, { annualRate: "-0.01" }));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });

    // The run itself is not a failure: it recorded one rule's failure and
    // moved on, rather than aborting or being marked "failed" overall.
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ rulesConsidered: 2, accrued: 1, failed: 1 });

    // The failure was actually recorded against the bad rule, not swallowed silently.
    expect(errorSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ event: "interest_accrual_rule_failed" });
    expect(logged.error).toContain("annualRate must not be negative");
    errorSpy.mockRestore();

    const [goodRule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(good.userId));
    const goodAccrued = await withSystemContext(db, (tx) =>
      new DrizzleInterestAccrualsRepository(tx).forRule(goodRule!.id, "2026-09-05", "2026-09-05"),
    );
    expect(goodAccrued).toHaveLength(1);

    const [badRule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(bad.userId));
    const badAccrued = await withSystemContext(db, (tx) =>
      new DrizzleInterestAccrualsRepository(tx).forRule(badRule!.id, "2026-09-05", "2026-09-05"),
    );
    expect(badAccrued).toHaveLength(0);
  });

  it("does not post when the rule's postingMode is post_to_provider but the account has no live Wallet link", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [account] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-05", balance: "1000.00", source: "manual" }),
    );
    await withSystemContext(db, (tx) =>
      new DrizzleInterestRulesRepository(tx).create({
        userId: user!.id, accountId: account!.id, annualRate: "0.0225", taxRate: "0.26", dayCount: 365,
        compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
        postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
      }),
    );
    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    expect(result.detail).toMatchObject({ accrued: 1, posted: 0 });
  });

  it("does not post against a live link to a different provider — liveFor matches by entity, not by provider", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [account] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(accountBalances).values({ accountId: account!.id, asOf: "2026-09-05", balance: "1000.00", source: "manual" }),
    );
    // A live link exists for this account, but for a different provider —
    // `ProviderLinksRepository.liveFor` matches on entity type/id and
    // "not missing" only, so without an explicit provider check on the
    // caller's side, `link.externalId` here would be trusted as a Wallet
    // account id even though it belongs to something else entirely.
    await withSystemContext(db, (tx) =>
      new DrizzleProviderLinksRepository(tx).upsertSeen(
        user!.id,
        { provider: "trek", entityType: "account", entityId: account!.id, externalId: "trek-external-id", metadata: {} },
        new Date("2026-09-01T00:00:00Z"),
      ),
    );
    await withSystemContext(db, (tx) =>
      new DrizzleInterestRulesRepository(tx).create({
        userId: user!.id, accountId: account!.id, annualRate: "0.0225", taxRate: "0.26", dayCount: 365,
        compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
        postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
      }),
    );
    const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
    expect(result.detail).toMatchObject({ accrued: 1, posted: 0, postFailed: 0 });
  });
});
