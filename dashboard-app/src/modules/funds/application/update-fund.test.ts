import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { updateFund } from "./update-fund";
import { fundHarness, seedFund } from "./test-support";

describe("updateFund", () => {
  it("denies viewers and archives with the application clock and an audit", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    await expect(updateFund(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id, fund.version, { name: "No" }))
      .rejects.toThrow(PermissionDeniedError);
    const archived = await updateFund(h.deps)(testPrincipal(), fund.id, fund.version, { status: "archived" });
    expect(archived.archivedAt).toEqual(h.deps.clock.now());
    expect(h.audits).toEqual([expect.objectContaining({ action: "funds.fund_updated", before: fund, after: archived })]);
  });

  it("rejects invalid runtime patches and mismatched linked account currencies", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    await expect(updateFund(h.deps)(testPrincipal(), fund.id, fund.version, { kind: "bad" as never })).rejects.toThrow(/invalid/i);
    h.accountLinks.set(`${testPrincipal().userId}:usd`, { currency: "USD" });
    await expect(updateFund(h.deps)(testPrincipal(), fund.id, fund.version, { accountId: "usd" })).rejects.toThrow(/currency/i);
  });
});
