import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, preferencesInputSchema } from "./rules";

describe("preferencesInputSchema", () => {
  it("accepts a complete, valid preference set", () => {
    const parsed = preferencesInputSchema.parse({
      ...DEFAULT_PREFERENCES,
      locale: "it",
      timeZone: "Europe/London",
      patronSaint: { month: 12, day: 7 },
    });
    expect(parsed.locale).toBe("it");
    expect(parsed.patronSaint).toEqual({ month: 12, day: 7 });
  });

  it("rejects an unknown timezone", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, timeZone: "Mars/Olympus" }),
    ).toThrow();
  });

  it("rejects an impossible patron-saint date", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 2, day: 30 } }),
    ).toThrow();
  });

  it("bounds the working day", () => {
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, minutesPerDay: 0 })).toThrow();
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, minutesPerDay: 721 })).toThrow();
  });

  it("defaults are themselves valid", () => {
    expect(preferencesInputSchema.parse(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
  });
});
