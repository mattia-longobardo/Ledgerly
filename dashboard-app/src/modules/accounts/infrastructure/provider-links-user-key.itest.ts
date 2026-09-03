import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { DrizzleProviderLinksRepository } from "./drizzle-provider-links-repository";

describe("provider links are keyed per user", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lets two users hold the same provider external id", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const seenAt = new Date("2026-09-04T08:00:00Z");
    for (const user of [a!, b!]) {
      await withUserContext(db, { userId: user.id }, async (tx) => {
        const [account] = await tx
          .insert(accounts)
          .values({ userId: user.id, name: "Shared", type: "checking", origin: "synced", provider: "wallet" })
          .returning();
        await new DrizzleProviderLinksRepository(tx).upsertSeen(
          user.id,
          {
            provider: "wallet",
            entityType: "account",
            entityId: account!.id,
            externalId: "ext-1",
            metadata: { providerName: "Shared" },
          },
          seenAt,
        );
      });
    }

    for (const user of [a!, b!]) {
      const links = await withUserContext(db, { userId: user.id }, (tx) =>
        new DrizzleProviderLinksRepository(tx).byExternal(user.id, "wallet", "account", ["ext-1"]),
      );
      expect(links.get("ext-1")?.externalId).toBe("ext-1");
    }
  });

  // Every real caller of upsertSeen runs under withUserContext(..., { role: "system" })
  // (see src/lib/jobs/wallet-accounts-sync.ts), which by design bypasses RLS. The test
  // above only proves RLS *also* blocks the cross-user collision when the default "user"
  // role is used; it does not exercise the production call path, where RLS offers no
  // protection at all and the unique key is the only thing standing between a second
  // user's sync and silently rewriting the first user's link. This test runs both users
  // through that exact path.
  it("under the sync job's system role, a second user's upsert cannot rewrite the first user's link", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const seenAt = new Date("2026-09-04T08:00:00Z");
    const accountIdByUser = new Map<string, string>();
    for (const user of [a!, b!]) {
      await withUserContext(db, { userId: user.id, role: "system" }, async (tx) => {
        const [account] = await tx
          .insert(accounts)
          .values({ userId: user.id, name: "Shared", type: "checking", origin: "synced", provider: "wallet" })
          .returning();
        accountIdByUser.set(user.id, account!.id);
        await new DrizzleProviderLinksRepository(tx).upsertSeen(
          user.id,
          {
            provider: "wallet",
            entityType: "account",
            entityId: account!.id,
            externalId: "ext-1",
            metadata: { providerName: user.displayName },
          },
          seenAt,
        );
      });
    }

    for (const user of [a!, b!]) {
      const links = await withUserContext(db, { userId: user.id, role: "system" }, (tx) =>
        new DrizzleProviderLinksRepository(tx).byExternal(user.id, "wallet", "account", ["ext-1"]),
      );
      const link = links.get("ext-1");
      // Without a user_id-keyed unique index, user B's upsert conflicts on
      // (provider, entity_type, external_id) alone and rewrites user A's row's
      // entityId/metadata in place — RLS never sees it, since the whole point of
      // role: "system" is to bypass RLS. Each user must keep their own entity.
      expect(link?.entityId).toBe(accountIdByUser.get(user.id));
    }
  });
});
