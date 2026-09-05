import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { accounts, accountBalances, organizations, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { testPrincipal } from "@/test/principal";
import type { NewInterestRule } from "@/modules/interests/application/ports";
import { DrizzleInterestRulesRepository } from "@/modules/interests/infrastructure/drizzle-interest-rules-repository";
import { DrizzleInterestAccrualsRepository } from "@/modules/interests/infrastructure/drizzle-interest-accruals-repository";
import { DrizzleInterestEntriesRepository } from "@/modules/interests/infrastructure/drizzle-interest-entries-repository";
import { DrizzleProviderLinksRepository } from "@/modules/accounts/infrastructure/drizzle-provider-links-repository";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import { importFileCredentials } from "@/modules/integrations/application/import-file-credentials";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import type { IntegrationProvider } from "@/platform/integrations/types";
import { runInterestAccrualJob } from "./interest-accrual";

function walletProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

/**
 * A user with a savings account, a balance on file, a connected Wallet
 * credential, a live Wallet provider link on that account, and a
 * `post_to_provider` rule — everything `tryPost` needs to actually attempt a
 * post. B3's own review finding: nothing in this package previously drove a
 * successful post all the way through to a real `interest_entries` row.
 */
async function seedPostableUser(asOf: string, balance = "1000.00") {
  const { userId, accountId } = await seedUser("Poster", asOf, balance);
  const db = await testDb();
  const principal = testPrincipal({ userId });
  await importFileCredentials(integrationDeps(db))(principal, { wallet: { token: "wallet-token" } });
  await withSystemContext(db, (tx) =>
    new DrizzleProviderLinksRepository(tx).upsertSeen(
      userId,
      { provider: "wallet", entityType: "account", entityId: accountId, externalId: "wallet-acc-1", metadata: {} },
      new Date("2026-09-01T00:00:00Z"),
    ),
  );
  await createRule(newRule(userId, accountId, { postingMode: "post_to_provider" }));
  return { userId, accountId };
}

/**
 * Mocks the three Wallet endpoints `tryPost` touches, on the base URL
 * `integration-setup.ts` fixes for every itest. Returns the raw calls for
 * assertions on what was actually sent (grain, marker, amount shape).
 */
function mockWalletFetch(opts: { existingRecord?: { id: string; amount: number; note: string } | null } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let nextId = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (init.method === "POST" && url.endsWith("/records")) {
      const records = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
      const created = records.map((r) => {
        nextId += 1;
        return { id: `wallet-record-${nextId}`, ...r, currencyCode: "EUR" };
      });
      return json({ records: created });
    }
    if (url.includes("/categories")) {
      return json({ categories: [{ id: "c1", name: "Interest, dividends", group: "Income" }] });
    }
    if (url.includes("/records?")) {
      return json({ records: opts.existingRecord ? [{ ...opts.existingRecord, accountId: "wallet-acc-1", currencyCode: "EUR", recordDate: "2026-09-05" }] : [] });
    }
    throw new Error(`interest-accrual.itest: unexpected fetch to ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

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

  describe("posting to a real Wallet connection (mocked HTTP, real Postgres)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      resetProviderRegistry();
      registerProvider(walletProvider());
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    // B3: "There is no test in the codebase that writes a posted entry to
    // Postgres" — this drives a successful post all the way through:
    // accrual -> Wallet POST -> `interest_entries` row, with the id Wallet
    // returns landing on `transaction_id` even though it is not
    // UUID-shaped (the column is `text`, migration 0014).
    it("drives a successful post_to_provider run all the way through to a real interest_entries row", async () => {
      const { userId, accountId } = await seedPostableUser("2026-09-05");
      const { fetchMock } = mockWalletFetch();

      const result = await runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") });
      expect(result.detail).toMatchObject({ accrued: 1, posted: 1, postFailed: 0 });

      const db = await testDb();
      const [rule] = await withSystemContext(db, (tx) => new DrizzleInterestRulesRepository(tx).list(userId));
      const [accrual] = await withSystemContext(db, (tx) =>
        new DrizzleInterestAccrualsRepository(tx).forRule(rule!.id, "2026-09-05", "2026-09-05"),
      );
      expect(accrual!.postedAt).not.toBeNull();
      expect(accrual!.entryId).not.toBeNull();

      const entries = await withSystemContext(db, (tx) => new DrizzleInterestEntriesRepository(tx).listForRule(rule!.id, "paid"));
      expect(entries).toHaveLength(1);
      expect(entries[0]!.transactionId).toBe("wallet-record-1");
      expect(entries[0]!.accountId).toBe(accountId);
      expect(entries[0]!.source).toBe("provider");

      // B1: the POST body carries the bare accrual day, not a midnight
      // timestamp, and the crash-recovery read queries that same grain.
      const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      const posted = JSON.parse((postCall![1] as RequestInit).body as string) as Array<{ recordDate: string; amount: number }>;
      expect(posted[0]!.recordDate).toBe("2026-09-05");
      const findCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("recordDate=eq."));
      expect(findCall![0]).toContain("recordDate=eq.2026-09-05");
    });

    // B2 / Ruling P3-C39: the claim, not the lock, is what stops a double
    // post. Two genuinely concurrent job runs racing the same rule on the
    // same day must never both post — proven end to end, through the real
    // job entry point, against real Postgres.
    it("two concurrent job runs on the same rule/day never both post — the claim stops the second one, not the lock", async () => {
      await seedPostableUser("2026-09-05");
      const { fetchMock } = mockWalletFetch();

      const [first, second] = await Promise.all([
        runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") }),
        runInterestAccrualJob({ trigger: "manual", now: new Date("2026-09-05T12:00:00Z") }),
      ]);

      const totalPosted = (first.detail as { posted: number }).posted + (second.detail as { posted: number }).posted;
      expect(totalPosted).toBe(1);

      const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(postCalls).toHaveLength(1);
    });
  });
});
