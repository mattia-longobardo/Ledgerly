import { describe, expect, it } from "vitest";
import { type FundField, fundFormFields } from "./present";

/**
 * The design has one "New fund" form for both kinds, so the kind alone decides which fields it
 * shows (plan F6, design "Fund kind"). A field a kind does not own is never rendered: it cannot be
 * filled in and cannot be submitted.
 */
describe("fundFormFields", () => {
  const shared: FundField[] = ["compartment", "kind", "name", "provider", "start"];

  it("gives a PAC its whole plan", () => {
    const fields = fundFormFields("pac");
    const plan: FundField[] = ["isin", "monthly", "fee", "debit", "day", "ter", "valuation", "initial"];
    for (const field of [...shared, ...plan]) expect(fields.has(field), field).toBe(true);
  });

  it("leaves a pension fund only who runs it and since when", () => {
    expect([...fundFormFields("pension")].sort()).toEqual(shared);
  });

  it("never offers a pension fund a monthly deposit, a fee or a debit account", () => {
    const fields = fundFormFields("pension");
    for (const field of ["monthly", "fee", "debit", "day", "ter", "isin", "initial"] as FundField[])
      expect(fields.has(field), field).toBe(false);
  });
});
