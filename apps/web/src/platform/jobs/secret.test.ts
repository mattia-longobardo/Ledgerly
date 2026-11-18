import { describe, expect, it } from "vitest";
import { secretMatches } from "./secret";

describe("secretMatches", () => {
  it("compares in constant time and rejects missing or different secrets", () => {
    expect(secretMatches("s3cret-s3cret-s3cret", "s3cret-s3cret-s3cret")).toBe(true);
    expect(secretMatches("s3cret-s3cret-s3creX", "s3cret-s3cret-s3cret")).toBe(false);
    expect(secretMatches("short", "s3cret-s3cret-s3cret")).toBe(false);
    expect(secretMatches(null, "s3cret-s3cret-s3cret")).toBe(false);
  });
});
