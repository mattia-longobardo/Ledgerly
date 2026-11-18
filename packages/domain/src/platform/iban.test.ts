import { describe, expect, it } from "vitest";
import { groupIban, normalizeIban } from "./iban";

// The examples of the standard and of the banks' documentation: no person's number.
const ITALIAN = "IT60X0542811101000000123456";
const BRITISH = "GB82WEST12345698765432";

describe("normalizeIban", () => {
  it("takes an IBAN with spaces, dashes and lower case, and gives it compact and upper case", () => {
    expect(normalizeIban("it60 x054 2811 1010 0000 0123 456")).toBe(ITALIAN);
    expect(normalizeIban("GB82-WEST-1234-5698-7654-32")).toBe(BRITISH);
  });

  it("refuses a number whose check digits are wrong", () => {
    expect(normalizeIban("IT61X0542811101000000123456")).toBeNull();
    expect(normalizeIban("GB82WEST12345698765433")).toBeNull();
  });

  it("refuses a text that has not the shape of an IBAN", () => {
    for (const text of [
      "",
      "wallet",
      "1234567890",
      "IT60",
      "Conto di casa",
      "IT60X05428111010000001234567890123456",
    ]) {
      expect(normalizeIban(text), text).toBeNull();
    }
    expect(normalizeIban(null)).toBeNull();
    expect(normalizeIban(undefined)).toBeNull();
  });
});

describe("groupIban", () => {
  it("shows an IBAN in groups of four, the last group as long as it is", () => {
    expect(groupIban(ITALIAN)).toBe("IT60 X054 2811 1010 0000 0123 456");
    expect(groupIban(BRITISH)).toBe("GB82 WEST 1234 5698 7654 32");
  });
});
