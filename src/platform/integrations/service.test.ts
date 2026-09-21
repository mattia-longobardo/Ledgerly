import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./service";

/** What node-postgres throws for a unique violation, reduced to the fields that matter. */
const violation = (constraint: string) =>
  Object.assign(new Error("duplicate key"), { code: "23505", constraint });

describe("isUniqueViolation", () => {
  it("finds the violated constraint under Drizzle's wrapper", () => {
    const wrapped = new Error("Failed query: insert …", { cause: violation("provider_links_entity_uq") });
    expect(isUniqueViolation(wrapped, "provider_links_entity_uq")).toBe(true);
    expect(isUniqueViolation(wrapped, "provider_links_external_uq")).toBe(false);
  });

  it("does not depend on the wrapper's class, which the production bundle may duplicate", () => {
    // Production, 2026-09-18: the error was a `DrizzleQueryError` from another copy of drizzle-orm,
    // so `instanceof` said no, the conflict was never recognised, and every hourly transactions
    // pass failed on a second Wallet group reaching an already linked local group.
    class ForeignDrizzleQueryError extends Error {}
    const wrapped = new ForeignDrizzleQueryError("Failed query: insert …", {
      cause: violation("provider_links_entity_uq"),
    });
    expect(isUniqueViolation(wrapped, "provider_links_entity_uq")).toBe(true);
  });

  it("answers no for anything that is not a unique violation", () => {
    expect(isUniqueViolation(new Error("boom"), "provider_links_entity_uq")).toBe(false);
    expect(isUniqueViolation("boom", "provider_links_entity_uq")).toBe(false);
    expect(
      isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }), "provider_links_entity_uq"),
    ).toBe(false);
  });
});
