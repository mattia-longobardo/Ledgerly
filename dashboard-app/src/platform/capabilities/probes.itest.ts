import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { dataProbes } from "./probes";

/**
 * The regression this pins: `accounts` carries `FORCE ROW LEVEL SECURITY`, so
 * counting it on the bare pool — with no `app.user_id` set — returns no rows and
 * the probe answers "no accounts" for everybody, permanently. It has to count
 * inside the caller's own context.
 */
describe("dataProbes.hasAccounts", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("is true for the user who owns an account and false for anybody else", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Household" }).returning();
    const [owner] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [other] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({
        userId: owner!.id,
        groupId: null,
        name: "Main current",
        type: "checking",
        currency: "EUR",
        origin: "manual",
        provider: null,
        status: "active",
        includeInNetWorth: true,
        notes: null,
        sortOrder: 0,
      }),
    );

    const probes = dataProbes(db);
    expect(await probes.hasAccounts(owner!.id)).toBe(true);
    expect(await probes.hasAccounts(other!.id)).toBe(false);
  });

  it("ignores an archived account: the section is empty until something is in it", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Household" }).returning();
    const [owner] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();

    await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({
        userId: owner!.id,
        groupId: null,
        name: "Old",
        type: "checking",
        currency: "EUR",
        origin: "manual",
        provider: null,
        status: "archived",
        includeInNetWorth: true,
        notes: null,
        sortOrder: 0,
      }),
    );

    expect(await dataProbes(db).hasAccounts(owner!.id)).toBe(false);
  });
});
