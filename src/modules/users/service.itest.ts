import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sessions } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { DEFAULT_PREFERENCES } from "./rules";
import { findSessionToken, getPreferences, listOwnSessions, updatePreferences } from "./service";

describe("preferences service", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("returns the defaults before anything is saved", async () => {
    const user = await createTestUser();
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
  });

  it("saves and reads back a full preference set", async () => {
    const user = await createTestUser();
    const saved = await updatePreferences(
      { userId: user.id },
      { ...DEFAULT_PREFERENCES, locale: "it", theme: "dark", patronSaint: { month: 12, day: 7 } },
    );
    expect(saved.locale).toBe("it");
    expect(await getPreferences({ userId: user.id })).toEqual(saved);
  });

  it("rejects invalid input without writing", async () => {
    const user = await createTestUser();
    await expect(
      updatePreferences({ userId: user.id }, { ...DEFAULT_PREFERENCES, minutesPerDay: 5 }),
    ).rejects.toThrow();
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps each user's preferences separate", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    await updatePreferences({ userId: alice.id }, { ...DEFAULT_PREFERENCES, locale: "it" });
    await updatePreferences({ userId: bob.id }, { ...DEFAULT_PREFERENCES, theme: "dark" });
    expect(await getPreferences({ userId: alice.id })).toEqual({ ...DEFAULT_PREFERENCES, locale: "it" });
    expect(await getPreferences({ userId: bob.id })).toEqual({ ...DEFAULT_PREFERENCES, theme: "dark" });
  });

  it("finds a session token only for the session's owner", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const [session] = await getDb()
      .insert(sessions)
      .values({ userId: alice.id, token: "alice-session-token", expiresAt: new Date(Date.now() + 60_000) })
      .returning({ id: sessions.id });
    expect(await findSessionToken({ userId: alice.id }, session.id)).toBe("alice-session-token");
    expect(await findSessionToken({ userId: bob.id }, session.id)).toBeNull();
  });

  it("lists the caller's own sessions regardless of age, but not another user's or an expired one", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const [old] = await getDb()
      .insert(sessions)
      .values({
        userId: alice.id,
        token: "alice-old-token",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: sessions.id });
    await getDb()
      .insert(sessions)
      .values({ userId: bob.id, token: "bob-token", expiresAt: new Date(Date.now() + 60_000) });
    await getDb()
      .insert(sessions)
      .values({ userId: alice.id, token: "alice-expired-token", expiresAt: new Date(Date.now() - 60_000) });

    const rows = await listOwnSessions({ userId: alice.id });
    expect(rows.map((row) => row.id)).toEqual([old.id]);
    expect(rows[0]).not.toHaveProperty("token");
  });
});
