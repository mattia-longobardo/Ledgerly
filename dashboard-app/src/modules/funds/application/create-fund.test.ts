import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { createFund } from "./create-fund";
import { InvalidInputError } from "./errors";
import { fundHarness } from "./test-support";

describe("createFund", () => {
  it("denies viewers, validates runtime enums and audits a valid create", async () => {
    const h = fundHarness();
    await expect(createFund(h.deps)(testPrincipal({ roles: ["viewer"] }), { slug: "fund", name: "Fund", kind: "pension" }))
      .rejects.toThrow(PermissionDeniedError);
    await expect(createFund(h.deps)(testPrincipal(), { slug: "X", name: "Fund", kind: "bad" as never }))
      .rejects.toThrow(InvalidInputError);
    const fund = await createFund(h.deps)(testPrincipal(), { slug: "fund", name: "Fund", kind: "pension" });
    expect(fund.currency).toBe("EUR");
    expect(h.audits).toEqual([expect.objectContaining({ action: "funds.fund_created", entityId: fund.id })]);
  });

  it("rejects foreign/missing account links, currency mismatches, and duplicate slugs", async () => {
    const h = fundHarness();
    await expect(createFund(h.deps)(testPrincipal(), { slug: "fund", name: "Fund", kind: "pension", accountId: "foreign" }))
      .rejects.toThrow(/own/i);
    h.accountLinks.set(`${testPrincipal().userId}:account-1`, { currency: "USD" });
    await expect(createFund(h.deps)(testPrincipal(), { slug: "fund", name: "Fund", kind: "pension", accountId: "account-1", currency: "EUR" }))
      .rejects.toThrow(/currency/i);
    await createFund(h.deps)(testPrincipal(), { slug: "fund", name: "Fund", kind: "pension" });
    await expect(createFund(h.deps)(testPrincipal(), { slug: "fund", name: "Again", kind: "pension" }))
      .rejects.toThrow(InvalidInputError);
  });
});
