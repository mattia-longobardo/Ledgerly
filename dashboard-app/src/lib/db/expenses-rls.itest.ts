import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import {
  accounts,
  organizations,
  recurringPatterns,
  transactionCategories,
  transactionLabelLinks,
  transactionLabels,
  transactions,
  users,
} from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

/**
 * A2: `transactions-rls.itest.ts` covers only `transactions` itself.
 * `transaction_categories`, `transaction_labels`, `transaction_label_links`
 * and `recurring_patterns` all carry `FORCE ROW LEVEL SECURITY` and a policy
 * in `0011_transactions.sql`, but no test ever exercised the policy under a
 * genuine `withUserContext` — the four "filters by userId explicitly" tests
 * in `repositories.itest.ts` run inside `withSystemContext`, where
 * `app_is_system()` short-circuits the policy and only proves the
 * repository's own explicit predicate.
 *
 * Each test here inserts under `withSystemContext` (bypassing RLS, matching
 * every other seed helper in this file), then reads/writes under
 * `withUserContext` as each user in turn, so the *policy* — not the
 * repository — is what is actually asserted. Drizzle 0.45 wraps a Postgres
 * error on `.cause`, so a policy violation is asserted on `err.cause.message`
 * / `err.cause.code`, never a `rejects.toThrow(/row-level security/)` match
 * against the outer wrapper.
 */
describe("expenses RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seedTwoUsers() {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: a!.id, name: "A cash", type: "cash", origin: "manual" }).returning(),
    );
    const [accB] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: b!.id, name: "B cash", type: "cash", origin: "manual" }).returning(),
    );
    return { db, a: { userId: a!.id, accountId: accA!.id }, b: { userId: b!.id, accountId: accB!.id } };
  }

  it("transaction_categories: a user sees only their own row and cannot write one for another user", async () => {
    const { db, a, b } = await seedTwoUsers();
    await withSystemContext(db, (tx) =>
      tx.insert(transactionCategories).values([
        { userId: a.userId, name: "Groceries" },
        { userId: b.userId, name: "Rent" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a.userId }, (tx) => tx.select().from(transactionCategories));
    expect(mine.map((r) => r.name)).toEqual(["Groceries"]);

    const err: unknown = await withUserContext(db, { userId: a.userId }, (tx) =>
      tx.insert(transactionCategories).values({ userId: b.userId, name: "Not mine" }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/row-level security policy for table "transaction_categories"/);
  });

  it("transaction_labels: a user sees only their own row and cannot write one for another user", async () => {
    const { db, a, b } = await seedTwoUsers();
    await withSystemContext(db, (tx) =>
      tx.insert(transactionLabels).values([
        { userId: a.userId, name: "Work" },
        { userId: b.userId, name: "Personal" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a.userId }, (tx) => tx.select().from(transactionLabels));
    expect(mine.map((r) => r.name)).toEqual(["Work"]);

    const err: unknown = await withUserContext(db, { userId: a.userId }, (tx) =>
      tx.insert(transactionLabels).values({ userId: b.userId, name: "Not mine" }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/row-level security policy for table "transaction_labels"/);
  });

  it("recurring_patterns: a user sees only their own row and cannot write one for another user", async () => {
    const { db, a, b } = await seedTwoUsers();
    const pattern = {
      cadence: "monthly",
      amountLow: "-10.00",
      amountHigh: "-10.00",
      currency: "EUR",
      sign: "-",
      lastSeenAt: new Date(),
      occurrenceCount: 3,
    };
    await withSystemContext(db, (tx) =>
      tx.insert(recurringPatterns).values([
        { ...pattern, userId: a.userId, payee: "A-Netflix" },
        { ...pattern, userId: b.userId, payee: "B-Netflix" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a.userId }, (tx) => tx.select().from(recurringPatterns));
    expect(mine.map((r) => r.payee)).toEqual(["A-Netflix"]);

    const err: unknown = await withUserContext(db, { userId: a.userId }, (tx) =>
      tx.insert(recurringPatterns).values({ ...pattern, userId: b.userId, payee: "Not mine" }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { message?: string } }).cause?.message).toMatch(/row-level security policy for table "recurring_patterns"/);
  });

  it("transaction_label_links: a user sees only links reached through their own transaction and cannot link another user's transaction", async () => {
    const { db, a, b } = await seedTwoUsers();
    const [txA] = await withSystemContext(db, (tx) =>
      tx.insert(transactions).values({ userId: a.userId, accountId: a.accountId, occurredAt: new Date(), amount: "-5.00", type: "expense" }).returning(),
    );
    const [txB] = await withSystemContext(db, (tx) =>
      tx.insert(transactions).values({ userId: b.userId, accountId: b.accountId, occurredAt: new Date(), amount: "-5.00", type: "expense" }).returning(),
    );
    const [labelA] = await withSystemContext(db, (tx) =>
      tx.insert(transactionLabels).values({ userId: a.userId, name: "Mine" }).returning(),
    );
    const [labelB] = await withSystemContext(db, (tx) =>
      tx.insert(transactionLabels).values({ userId: b.userId, name: "Theirs" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(transactionLabelLinks).values([
        { transactionId: txA!.id, labelId: labelA!.id },
        { transactionId: txB!.id, labelId: labelB!.id },
      ]),
    );

    const mine = await withUserContext(db, { userId: a.userId }, (tx) => tx.select().from(transactionLabelLinks));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.transactionId).toBe(txA!.id);

    // Owns the transaction but not the label — A5's policy fix requires both.
    const errLabel: unknown = await withUserContext(db, { userId: a.userId }, (tx) =>
      tx.insert(transactionLabelLinks).values({ transactionId: txA!.id, labelId: labelB!.id }),
    ).catch((e) => e);
    expect(errLabel).toBeInstanceOf(Error);
    expect((errLabel as { cause?: { message?: string } }).cause?.message).toMatch(/row-level security policy for table "transaction_label_links"/);

    // Owns the label but not the transaction.
    const errTx: unknown = await withUserContext(db, { userId: a.userId }, (tx) =>
      tx.insert(transactionLabelLinks).values({ transactionId: txB!.id, labelId: labelA!.id }),
    ).catch((e) => e);
    expect(errTx).toBeInstanceOf(Error);
    expect((errTx as { cause?: { message?: string } }).cause?.message).toMatch(/row-level security policy for table "transaction_label_links"/);
  });
});
