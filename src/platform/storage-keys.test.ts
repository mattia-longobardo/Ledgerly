import { describe, expect, it } from "vitest";
import { assertStorageKey } from "./storage-keys";

describe("assertStorageKey", () => {
  it("accepts well-formed keys", () => {
    expect(assertStorageKey("payslips/0199a1b2/2026/5f2c.pdf")).toBe("payslips/0199a1b2/2026/5f2c.pdf");
  });

  it.each(["/leading", "a//b", "a/../b", "UPPER.pdf", "space here", "", "x".repeat(513)])(
    "rejects %s",
    (key) => {
      expect(() => assertStorageKey(key)).toThrow(RangeError);
    },
  );
});
