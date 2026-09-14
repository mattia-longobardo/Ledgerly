import { describe, expect, it } from "vitest";
import { isPasswordLengthValid, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";

describe("isPasswordLengthValid", () => {
  it("accepts lengths from the minimum to the maximum, inclusive", () => {
    expect(isPasswordLengthValid("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isPasswordLengthValid("a".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    expect(isPasswordLengthValid("a".repeat(MAX_PASSWORD_LENGTH))).toBe(true);
    expect(isPasswordLengthValid("a".repeat(MAX_PASSWORD_LENGTH + 1))).toBe(false);
  });
});
