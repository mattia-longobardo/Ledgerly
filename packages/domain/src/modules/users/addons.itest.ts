// The Addons of a person (rewrite plan R5a, H52): every addon is on until the person turns one off,
// the switch changes only the list, and a job of an addon that is off skips that person.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADDONS } from "@ledgerly/api-contract";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { contextFor, forEachUser } from "./jobs";
import { userPreferences } from "./schema";
import { getPreferences, getSavedPreferences, setAddon, updatePreferences } from "./service";
import { DEFAULT_PREFERENCES } from "./rules";

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the addons of a person", () => {
  it("are all on for a person without preferences and for a row written before R5a (PA13)", async () => {
    const fresh = await createTestUser();
    expect((await getSavedPreferences({ userId: fresh.id })).addons).toEqual([...ADDONS]);
    expect((await contextFor(fresh)).addons).toEqual([...ADDONS]);

    const saved = await createTestUser();
    await updatePreferences({ userId: saved.id }, DEFAULT_PREFERENCES);
    expect((await getSavedPreferences({ userId: saved.id })).addons).toEqual([...ADDONS]);
  });

  it("turn off and on again without touching the other preferences", async () => {
    const user = await createTestUser();
    const ctx = { userId: user.id };
    await updatePreferences(ctx, { ...DEFAULT_PREFERENCES, locale: "it", minutesPerDay: 420 });
    const before = await getPreferences(ctx);

    expect(await setAddon(ctx, "budgets", false)).not.toContain("budgets");
    expect(await setAddon(ctx, "payroll", false)).toEqual(
      ADDONS.filter((addon) => addon !== "budgets" && addon !== "payroll"),
    );
    expect((await contextFor(user)).addons).not.toContain("payroll");
    // A preference saved while an addon is off leaves the addons as they are.
    await updatePreferences(ctx, { ...before, theme: "dark" });
    expect((await getSavedPreferences(ctx)).addons).not.toContain("budgets");

    await setAddon(ctx, "budgets", true);
    expect(await setAddon(ctx, "payroll", true)).toEqual([...ADDONS]);
    expect(await getPreferences(ctx)).toEqual({ ...before, theme: "dark" });
  });

  it("gives a person without preferences a row with the defaults when an addon is turned off", async () => {
    const user = await createTestUser();
    await setAddon({ userId: user.id }, "pockets", false);
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
    expect((await getSavedPreferences({ userId: user.id })).addons).not.toContain("pockets");
  });

  it("are a subset of the list in the database", async () => {
    const user = await createTestUser();
    await expect(
      getDb()
        .insert(userPreferences)
        .values({
          userId: user.id,
          timeZone: "Europe/Rome",
          locale: "en",
          numberFormat: "it-IT",
          weekStart: 1,
          theme: "light",
          defaultRange: "this_month",
          monthlySummary: false,
          minutesPerDay: 480,
          modules: ["budgets", "wallet"],
        }),
    ).rejects.toThrow();
  });
});

describe("forEachUser with an addon", () => {
  it("skips the people who have it off, and only them", async () => {
    const keeps = await createTestUser();
    const drops = await createTestUser();
    await setAddon({ userId: drops.id }, "subscriptions", false);

    const seen: string[] = [];
    const counts = await forEachUser("test", async (person) => void seen.push(person.id), {
      addon: "subscriptions",
    });
    expect(seen).toEqual([keeps.id]);
    expect(counts.failed).toBe(0);

    seen.length = 0;
    await forEachUser("test", async (person) => void seen.push(person.id));
    expect(seen.sort()).toEqual([keeps.id, drops.id].sort());
  });
});
