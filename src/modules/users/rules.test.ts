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

  it("rejects a UTC-offset identifier instead of a zone name", () => {
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, timeZone: "+01:00" })).toThrow();
  });

  it("rejects a zone name in the wrong case", () => {
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, timeZone: "europe/rome" })).toThrow();
  });

  it("stores the canonical zone name", () => {
    const parsed = preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, timeZone: "Europe/Rome" });
    expect(parsed.timeZone).toBe("Europe/Rome");
  });

  it("rejects an impossible patron-saint date", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 2, day: 30 } }),
    ).toThrow();
  });

  it("rejects 29 February (the probe year is not a leap year)", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 2, day: 29 } }),
    ).toThrow();
  });

  it("rejects an out-of-range patron-saint month", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 13, day: 1 } }),
    ).toThrow();
  });

  it("rejects a zero patron-saint day", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 1, day: 0 } }),
    ).toThrow();
  });

  it("rejects a non-integer patron-saint day", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 1, day: 15.5 } }),
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
