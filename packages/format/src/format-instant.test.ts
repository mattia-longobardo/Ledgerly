import { describe, expect, it } from "vitest";
import { formatInstant } from "./format";

describe("formatInstant", () => {
  it("writes the day in the person's zone and the clock in 24 hours", () => {
    // 23:30 UTC is already the next day in Rome (UTC+1 in November).
    const instant = new Date("2026-11-18T23:30:00.000Z");
    expect(formatInstant(instant, { locale: "en", timeZone: "Europe/Rome" })).toMatch(/19.*2026, 00:30$/);
    expect(formatInstant(instant, { locale: "en", timeZone: "UTC" })).toMatch(/18.*2026, 23:30$/);
  });
});
