import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, nameSchema } from "./name-policy";

describe("nameSchema", () => {
  it("trims surrounding whitespace", () => {
    expect(nameSchema.parse("  Giulia Rossi  ")).toBe("Giulia Rossi");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(nameSchema.safeParse("").success).toBe(false);
    expect(nameSchema.safeParse("   ").success).toBe(false);
  });

  it("accepts up to the maximum length and rejects beyond it", () => {
    expect(nameSchema.safeParse("a".repeat(MAX_NAME_LENGTH)).success).toBe(true);
    expect(nameSchema.safeParse("a".repeat(MAX_NAME_LENGTH + 1)).success).toBe(false);
  });
});
