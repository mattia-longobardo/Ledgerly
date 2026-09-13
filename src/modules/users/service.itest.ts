import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { DEFAULT_PREFERENCES } from "./rules";
import { getPreferences, updatePreferences } from "./service";

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
    expect((await getPreferences({ userId: alice.id })).theme).toBe("light");
    expect((await getPreferences({ userId: bob.id })).locale).toBe("en");
  });
});
