import { describe, expect, it } from "vitest";
import { legalLocale } from "./language";

describe("legalLocale", () => {
  it("follows ?lang= when it names a supported language", () => {
    expect(legalLocale("it", "en")).toBe("it");
    expect(legalLocale("en", "it")).toBe("en");
  });

  it("falls back to the language of the request", () => {
    expect(legalLocale(undefined, "it")).toBe("it");
    expect(legalLocale("de", "it")).toBe("it");
    expect(legalLocale(["it", "en"], "en")).toBe("en");
  });

  it("never returns a language without a catalogue", () => {
    expect(legalLocale("../../etc", "xx")).toBe("en");
  });
});
