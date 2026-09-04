import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, integrationConnections, organizations, users } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { connectionProbes, dataProbes } from "./probes";

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

describe("connectionProbes", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("reports each user's own connection state and nobody else's", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    // FORCE ROW LEVEL SECURITY: on the bare pool this insert is rejected by the
    // WITH CHECK clause, so the fixture runs in the system context.
    await withSystemContext(db, (tx) =>
      tx.insert(integrationConnections).values({ userId: a!.id, provider: "wallet", status: "connected" }),
    );

    const probes = connectionProbes(db);
    expect(await probes.connectionStates(a!.id)).toEqual({ wallet: "connected", trek: "not_configured" });
    expect(await probes.connectionStates(b!.id)).toEqual({
      wallet: "not_configured",
      trek: "not_configured",
    });
  });
});
