import { describe, expect, it } from "vitest";
import { requestLocale } from "./locales";

describe("requestLocale", () => {
  it("renders a signed-in user in their saved language and time zone, whatever the cookie says", () => {
    expect(requestLocale({ locale: "it", timeZone: "America/New_York" }, "en")).toEqual({
      locale: "it",
      timeZone: "America/New_York",
    });
  });

  it("falls back to the locale cookie, then English, before sign-in", () => {
    expect(requestLocale(null, "it")).toEqual({ locale: "it", timeZone: "Europe/Rome" });
    expect(requestLocale(null, "fr")).toEqual({ locale: "en", timeZone: "Europe/Rome" });
    expect(requestLocale(null, undefined)).toEqual({ locale: "en", timeZone: "Europe/Rome" });
  });
});
