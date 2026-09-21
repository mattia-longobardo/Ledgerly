import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { personalAccessTokens } from "./schema";
import {
  authenticateToken,
  createToken,
  deleteStaleTokens,
  listTokens,
  revokeToken,
  TokenError,
  touchToken,
} from "./service";

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function newContext(): Promise<Ctx> {
  return contextFor((await createTestUser()).id);
}

const NOW = new Date("2026-09-21T10:00:00Z");
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("personal access tokens", () => {
  it("shows the value once and keeps only the prefix and a digest", async () => {
    const ctx = await newContext();
    const { view, token } = await createToken(
      ctx,
      { name: "Home Assistant", scopes: ["read"], expiresInDays: 90 },
      NOW,
    );
    expect(token.startsWith(`pat_${view.prefix}.`)).toBe(true);
    const [row] = await getDb().select().from(personalAccessTokens);
    expect(row.tokenHash).not.toContain(token);
    expect(token).not.toContain(row.tokenHash);
    const listed = await listTokens(ctx, NOW);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0]).toMatchObject({ name: "Home Assistant", scopes: ["read"], state: "active" });
  });

  it("refuses a token with no name or no scope", async () => {
    const ctx = await newContext();
    for (const input of [
      { name: " ", scopes: ["read"], expiresInDays: null },
      { name: "ok", scopes: [], expiresInDays: null },
      { name: "ok", scopes: ["admin"], expiresInDays: null },
    ] as const) {
      await expect(createToken(ctx, input, NOW)).rejects.toBeInstanceOf(TokenError);
    }
  });

  it("authenticates its owner, with their role and preferences", async () => {
    const ctx = await newContext();
    await getDb().update(users).set({ role: "admin" }).where(eq(users.id, ctx.userId));
    const { token } = await createToken(
      ctx,
      { name: "script", scopes: ["read", "imports"], expiresInDays: null },
      NOW,
    );
    const identity = await authenticateToken(token, NOW);
    expect(identity?.ctx.userId).toBe(ctx.userId);
    expect(identity?.ctx.role).toBe("admin");
    expect(identity?.scopes).toEqual(["read", "imports"]);
  });

  it("answers null for a value that is not a live token of a live person", async () => {
    const ctx = await newContext();
    const { token } = await createToken(ctx, { name: "t", scopes: ["read"], expiresInDays: 30 }, NOW);
    expect(await authenticateToken("pat_abcdefgh.not-a-real-secret", NOW)).toBeNull();
    expect(await authenticateToken(token.slice(0, -1) + "x", NOW)).toBeNull();
    // Past its end date.
    expect(await authenticateToken(token, new Date("2026-12-31T00:00:00Z"))).toBeNull();
    // Blocked.
    await getDb().update(users).set({ banned: true }).where(eq(users.id, ctx.userId));
    expect(await authenticateToken(token, NOW)).toBeNull();
  });

  it("stops working the moment it is revoked", async () => {
    const ctx = await newContext();
    const { view, token } = await createToken(ctx, { name: "t", scopes: ["read"], expiresInDays: null }, NOW);
    expect(await authenticateToken(token, NOW)).not.toBeNull();
    await revokeToken(ctx, view.id, NOW);
    expect(await authenticateToken(token, minutesAfter(1))).toBeNull();
    expect((await listTokens(ctx, minutesAfter(1)))[0].state).toBe("revoked");
    await expect(revokeToken(ctx, view.id, NOW)).rejects.toMatchObject({ code: "not_found" });
  });

  it("writes last_used_at at most once a minute", async () => {
    const ctx = await newContext();
    const { view } = await createToken(ctx, { name: "t", scopes: ["read"], expiresInDays: null }, NOW);
    await touchToken(view.id, NOW);
    const first = (await listTokens(ctx, NOW))[0].lastUsedAt;
    expect(first?.toISOString()).toBe(NOW.toISOString());

    await touchToken(view.id, minutesAfter(0.5));
    expect((await listTokens(ctx, NOW))[0].lastUsedAt?.toISOString()).toBe(NOW.toISOString());

    await touchToken(view.id, minutesAfter(2));
    expect((await listTokens(ctx, NOW))[0].lastUsedAt?.toISOString()).toBe(minutesAfter(2).toISOString());
  });

  it("keeps one person's tokens out of another's list and out of their revocations", async () => {
    const a = await newContext();
    const b = await newContext();
    const mine = await createToken(a, { name: "mine", scopes: ["read"], expiresInDays: null }, NOW);
    await createToken(b, { name: "theirs", scopes: ["read"], expiresInDays: null }, NOW);

    expect((await listTokens(a, NOW)).map((token) => token.name)).toEqual(["mine"]);
    await expect(revokeToken(b, mine.view.id, NOW)).rejects.toMatchObject({ code: "not_found" });
    expect(await authenticateToken(mine.token, NOW)).toMatchObject({ ctx: { userId: a.userId } });
  });

  it("goes with its owner when the owner is removed", async () => {
    const ctx = await newContext();
    const { token } = await createToken(ctx, { name: "t", scopes: ["read"], expiresInDays: null }, NOW);
    await getDb().delete(users).where(eq(users.id, ctx.userId));
    expect(await getDb().select().from(personalAccessTokens)).toHaveLength(0);
    expect(await authenticateToken(token, NOW)).toBeNull();
  });

  it("is swept by housekeeping once it has been revoked or expired long enough", async () => {
    const ctx = await newContext();
    const live = await createToken(ctx, { name: "live", scopes: ["read"], expiresInDays: null }, NOW);
    const old = await createToken(ctx, { name: "old", scopes: ["read"], expiresInDays: 30 }, NOW);
    await getDb()
      .update(personalAccessTokens)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(personalAccessTokens.id, old.view.id));

    expect(await deleteStaleTokens(new Date("2025-01-01T00:00:00Z"))).toBe(1);
    expect((await listTokens(ctx, NOW)).map((token) => token.id)).toEqual([live.view.id]);
  });
});
