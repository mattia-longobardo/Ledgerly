import { describe, expect, it } from "vitest";
import { AddContributionRequestSchema, FundQuarterSchema, FundSummarySchema, FundValuePointSchema, SetPlanRequestSchema } from "./schemas";
import { buildOpenApiDocument } from "../../../../scripts/openapi";

describe("Funds computed money contracts", () => {
  it("allows exact totals beyond one stored row's numeric precision", () => {
    for (const value of ["120000000000000.00", "-120000000000000.01"]) {
      for (const field of ["value", "deposited", "absReturn"] as const) {
        expect(FundSummarySchema.shape[field].safeParse(value).success).toBe(true);
      }
      expect(FundQuarterSchema.safeParse({
        quarter: "2026-Q1", accrualMonths: ["2026-01-01"], postedMonth: "2026-02-01",
        gross: value, fees: value, net: value, posted: true,
      }).success).toBe(true);
      expect(FundValuePointSchema.safeParse({ month: "2026-01-01", value, deposited: value }).success).toBe(true);
    }
  });

  it("still bounds stored contribution and plan amounts and rejects non-decimal aggregates", () => {
    const input = { typeCode: "employee", accrualMonth: "2026-01-01", amount: "99999999999999.99" };
    expect(AddContributionRequestSchema.safeParse(input).success).toBe(true);
    expect(AddContributionRequestSchema.safeParse({ ...input, amount: "120000000000000.00" }).success).toBe(false);
    expect(SetPlanRequestSchema.shape.initialCapital.safeParse("120000000000000.00").success).toBe(false);
    for (const invalid of ["1e15", "NaN", "1.001", "-", ""]) {
      expect(FundSummarySchema.shape.deposited.safeParse(invalid).success).toBe(false);
    }
  });

  it("publishes large aggregate patterns without making non-null totals nullable", async () => {
    type Schema = { properties?: Record<string, Schema>; $ref?: string; pattern?: string; nullable?: boolean };
    const document = await buildOpenApiDocument() as { components: { schemas: Record<string, Schema> } };
    const resolve = (schema: Schema): Schema => schema.$ref
      ? resolve(document.components.schemas[schema.$ref.split("/").at(-1)!]!) : schema;
    const summary = document.components.schemas.FundSummary!.properties!;
    expect(resolve(summary.value!).nullable).toBe(true);
    expect(resolve(summary.absReturn!).nullable).toBe(true);
    expect(resolve(summary.deposited!).nullable).not.toBe(true);
    expect(new RegExp(resolve(summary.deposited!).pattern!).test("120000000000000.00")).toBe(true);
    expect(new RegExp(resolve(summary.deposited!).pattern!).test("1e15")).toBe(false);
    expect(resolve(document.components.schemas.FundQuarter!.properties!.net!).nullable).not.toBe(true);
  });
});
