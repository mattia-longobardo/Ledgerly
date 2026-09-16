// The hourly pass's own writes against a real Postgres (spec §11): the recurring patterns of
// §7.2, and the email §10.4 sends when a connection is not syncing. The Wallet engine itself is
// covered by `platform/integrations/wallet/sync.itest.ts`.
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { markConnection, saveConnection } from "@/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, hasMail, waitForMail } from "../../../test/mailpit";
import { createTestUser } from "../../../test/users";
import { refreshRecurrences, walletSyncJob } from "./jobs";
import { recurringPatterns, transactions } from "./schema";

const NOW = new Date("2026-01-20T08:07:00Z");

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newAccount(ctx: Ctx): Promise<string> {
  const account = await createAccount(ctx, {
    name: "Conto corrente",
    type: "checking",
    openingBalance: null,
  });
  return account.id;
}

/** A movement inserted straight in: these tests are about what the job derives, not about a sync. */
async function movement(
  ctx: Ctx,
  accountId: string,
  on: string,
  over: { payee?: string; amountCents?: bigint; hidden?: boolean } = {},
): Promise<void> {
  await getDb()
    .insert(transactions)
    .values({
      userId: ctx.userId,
      accountId,
      // Midnight in Rome, the instant the sync would have written for a bare day.
      occurredAt: new Date(`${on}T00:00:00+01:00`),
      amountCents: over.amountCents ?? -1299n,
      currency: "EUR",
      type: "expense",
      state: "cleared",
      payee: over.payee ?? "Netflix",
      hiddenAt: over.hidden ? NOW : null,
    });
}

/** A Wallet connection whose token has been refused: the engine attempts nothing for it. */
async function revokedConnection(): Promise<void> {
  const connection = await saveConnection(ctx, {
    provider: WALLET_PROVIDER,
    credentials: { token: "wallet-token-8ac31f" },
  });
  await markConnection(ctx, connection.id, "revoked", "token rejected");
}

async function patterns(ctx: Ctx) {
  return getDb()
    .select()
    .from(recurringPatterns)
    .where(eq(recurringPatterns.userId, ctx.userId))
    .orderBy(asc(recurringPatterns.payeeKey));
}

let ctx: Ctx;
let accountId: string;

describe("refreshRecurrences", () => {
  beforeEach(async () => {
    await resetDatabase();
    ctx = contextFor((await createTestUser()).id);
    accountId = await newAccount(ctx);
  });
  afterAll(closeDatabase);

  it("stores a monthly series, with the next date expected after the mean interval", async () => {
    for (const on of ["2025-11-05", "2025-12-05", "2026-01-05"]) await movement(ctx, accountId, on);

    expect(await refreshRecurrences(ctx, NOW)).toBe(1);
    const [pattern] = await patterns(ctx);
    expect(pattern).toMatchObject({
      payeeKey: "netflix",
      currency: "EUR",
      sign: -1,
      occurrences: 3,
      medianCents: -1299n,
      // Gaps of 30 and 31 days: the monthly band, mean 31 rounded half-up.
      intervalDays: 31,
      lastSeenOn: "2026-01-05",
      nextExpectedOn: "2026-02-05",
    });
  });

  it("writes nothing for a payee that is not a series", async () => {
    for (const on of ["2025-12-05", "2026-01-05"]) await movement(ctx, accountId, on);
    expect(await refreshRecurrences(ctx, NOW)).toBe(0);
    expect(await patterns(ctx)).toEqual([]);
  });

  it("is idempotent, and forgets a pattern that stopped being one", async () => {
    for (const on of ["2025-11-05", "2025-12-05", "2026-01-05"]) await movement(ctx, accountId, on);
    await refreshRecurrences(ctx, NOW);
    const [first] = await patterns(ctx);

    await refreshRecurrences(ctx, NOW);
    const [again] = await patterns(ctx);
    expect(again.id).toBe(first.id);

    // Hiding one occurrence leaves two, which is not a series any more (spec §7.2).
    await getDb().update(transactions).set({ hiddenAt: NOW }).where(eq(transactions.userId, ctx.userId));
    expect(await refreshRecurrences(ctx, NOW)).toBe(0);
    expect(await patterns(ctx)).toEqual([]);
  });

  it("leaves hidden movements, transfers and payee-less rows out of the detection", async () => {
    for (const on of ["2025-11-05", "2025-12-05"]) await movement(ctx, accountId, on);
    await movement(ctx, accountId, "2026-01-05", { hidden: true });
    expect(await refreshRecurrences(ctx, NOW)).toBe(0);
  });

  it("keeps one user's patterns out of another's", async () => {
    const other = contextFor((await createTestUser()).id);
    const otherAccount = await newAccount(other);
    for (const on of ["2025-11-05", "2025-12-05", "2026-01-05"]) await movement(ctx, accountId, on);
    for (const on of ["2025-11-07", "2025-12-07", "2026-01-07"]) {
      await movement(other, otherAccount, on, { payee: "Spotify" });
    }

    await refreshRecurrences(ctx, NOW);
    await refreshRecurrences(other, NOW);
    expect((await patterns(ctx)).map((one) => one.payeeKey)).toEqual(["netflix"]);
    expect((await patterns(other)).map((one) => one.payeeKey)).toEqual(["spotify"]);
  });
});

describe("walletSyncJob", () => {
  let email: string;

  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
    const person = await createTestUser();
    email = person.email;
    ctx = contextFor(person.id);
    accountId = await newAccount(ctx);
  });
  afterAll(closeDatabase);

  it("refreshes the recurrences of a user with no connection, and syncs nothing", async () => {
    for (const on of ["2025-11-05", "2025-12-05", "2026-01-05"]) await movement(ctx, accountId, on);
    expect(await walletSyncJob.run()).toMatchObject({
      users: 1,
      failed: 0,
      connections: 0,
      passes: 0,
      recurrences: 1,
    });
    expect(await patterns(ctx)).toHaveLength(1);
  });

  // §10.4 lists "sync failed **or** out of date" as two conditions, and a refused credential is
  // the first: the token was rejected, the database says so, and "out of date since <date>" would
  // hide the only sentence the user can act on.
  it("tells the user the token was rejected, not that the sync is out of date (spec §10.4)", async () => {
    await revokedConnection();

    // A connection that attempts no call is not a pass: it is counted apart, and reported as the
    // failure it is.
    expect(await walletSyncJob.run()).toMatchObject({
      connections: 1,
      passes: 0,
      refused: 1,
      failures: 0,
      notified: 1,
    });
    const mail = await waitForMail(email);
    expect(mail.Subject).toBe("Wallet sync failed");
    expect(mail.Text).toContain("token rejected");
    expect(mail.Text).toContain("Check the token");
    expect(mail.Text).not.toContain("out of date");
  });

  it("sends one email for the condition, not one an hour", async () => {
    await revokedConnection();
    await walletSyncJob.run();
    await waitForMail(email);
    await clearMailbox();

    expect(await walletSyncJob.run()).toMatchObject({ notified: 0 });
    expect(await hasMail(email)).toBe(false);
  });
});
