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
});
