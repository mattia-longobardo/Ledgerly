// The first start and the defaults of the instance (rewrite plan R5a, E4, E8, PA13): a person signed
// up since R5a has the first start ahead of them, starts from the instance's defaults, and gets no
// default of Italy unless they chose Italy; the first admin's choice becomes the instance's defaults.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADDONS } from "@ledgerly/api-contract";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { DEFAULT_PREFERENCES } from "./rules";
import {
  completeOnboarding,
  getPreferences,
  getSavedPreferences,
  instanceDefaults,
  onboardingOf,
  saveInstanceDefaults,
  setCountry,
  startOnboarding,
} from "./service";

beforeEach(resetDatabase);
afterAll(closeDatabase);

const GERMANY = {
  country: "DE",
  displayCurrency: "EUR",
  timeZone: "Europe/Berlin",
  numberFormat: "en-US",
  locale: "en",
} as const;

describe("the first start", () => {
  it("is behind a person of today: no row, or a row written before R5a", async () => {
    const user = await createTestUser();
    expect(await onboardingOf({ userId: user.id })).toEqual({
      pending: false,
      country: null,
      proposal: null,
    });
  });

  it("is ahead of a person signed up since R5a, with the defaults of before when the instance has none", async () => {
    const user = await createTestUser();
    await startOnboarding(user.id);
    expect((await onboardingOf({ userId: user.id })).pending).toBe(true);
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
    // A second sign-up event changes nothing.
    await startOnboarding(user.id);
    expect((await onboardingOf({ userId: user.id })).pending).toBe(true);
  });

  it("gives a person of a country without a pack what they chose, and nothing of Italy (criterion 3)", async () => {
    const user = await createTestUser();
    await startOnboarding(user.id);
    const done = await completeOnboarding(
      { userId: user.id, role: "user" },
      { ...GERMANY, addons: ["budgets"] },
    );
    expect(done).toEqual({ pending: false, country: "DE", proposal: null });
    const saved = await getSavedPreferences({ userId: user.id });
    expect(saved).toMatchObject({
      timeZone: "Europe/Berlin",
      numberFormat: "en-US",
      locale: "en",
      country: "DE",
      addons: ["budgets"],
      onboarding: false,
    });
    expect(saved.timeZone).not.toBe("Europe/Rome");
    // An ordinary person does not set the instance's defaults.
    expect(await instanceDefaults()).toBeNull();
  });

  it("takes the week of the country's pack, and the first admin's choice as the instance's defaults", async () => {
    const admin = await createTestUser();
    await startOnboarding(admin.id);
    await completeOnboarding(
      { userId: admin.id, role: "admin" },
      {
        country: "IT",
        displayCurrency: "EUR",
        timeZone: "Europe/Rome",
        numberFormat: "it-IT",
        locale: "it",
        addons: [...ADDONS],
      },
    );
    expect((await getPreferences({ userId: admin.id })).weekStart).toBe(1);
    expect(await instanceDefaults()).toEqual({
      country: "IT",
      displayCurrency: "EUR",
      timeZone: "Europe/Rome",
      numberFormat: "it-IT",
      locale: "it",
    });

    // The next sign-up starts from the instance's defaults; the admin's second run keeps them.
    const next = await createTestUser();
    await startOnboarding(next.id);
    expect(await getSavedPreferences({ userId: next.id })).toMatchObject({
      locale: "it",
      country: "IT",
      onboarding: true,
    });
    await completeOnboarding({ userId: admin.id, role: "admin" }, { ...GERMANY, addons: [] });
    expect((await instanceDefaults())?.country).toBe("IT");
  });

  it("refuses a country that is not two capitals, and an addon the list does not have", async () => {
    const user = await createTestUser();
    const ctx = { userId: user.id, role: "user" as const };
    await expect(completeOnboarding(ctx, { ...GERMANY, country: "Germany", addons: [] })).rejects.toThrow();
    await expect(completeOnboarding(ctx, { ...GERMANY, addons: ["wallet"] })).rejects.toThrow();
  });
});

describe("the instance's defaults and the country", () => {
  it("are set by an admin only", async () => {
    const user = await createTestUser();
    await expect(saveInstanceDefaults({ userId: user.id, role: "user" }, GERMANY)).rejects.toThrow(
      "forbidden",
    );
    expect(await saveInstanceDefaults({ userId: user.id, role: "admin" }, GERMANY)).toEqual(GERMANY);
    expect(await instanceDefaults()).toEqual(GERMANY);
  });

  it("changes the country of a person with or without a row, and nothing else", async () => {
    const user = await createTestUser();
    const before = await getPreferences({ userId: user.id });
    expect(await setCountry({ userId: user.id }, "FR")).toBe("FR");
    expect(await setCountry({ userId: user.id }, null)).toBeNull();
    expect(await getPreferences({ userId: user.id })).toEqual(before);
    expect((await onboardingOf({ userId: user.id })).pending).toBe(false);
  });
});
