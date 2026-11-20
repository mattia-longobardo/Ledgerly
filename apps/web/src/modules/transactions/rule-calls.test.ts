import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  invalidate,
  read: async () => ({
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    decimalSeparator: null,
    currencyPosition: null,
  }),
}));

const { previewRuleAction, ruleAmount, saveRuleAction } = await import("./rule-calls");
const ID = "00000000-0000-4000-8000-000000000001";
const RULE = {
  name: "Shop",
  conditions: [{ field: "amount" as const, op: "lt" as const, amount: "1234.50" }],
  categoryId: ID,
};

beforeEach(() => {
  call.mockReset();
  invalidate.mockReset();
});

describe("the calls of the rules", () => {
  it("read an amount typed in the person's format as the decimal of the contract", () => {
    expect(ruleAmount("1.234,5", "it-IT")).toBe("1234.50");
    expect(ruleAmount("-3", "it-IT")).toBeNull();
    expect(ruleAmount("abc", "it-IT")).toBeNull();
  });

  it("answer a save with the rule and its changes, and a refusal with its code", async () => {
    call.mockResolvedValue({ id: ID, changes: 3 });
    expect(await saveRuleAction(null, RULE)).toEqual({ ok: true, id: ID, changes: 3 });
    expect(call.mock.calls[0][1]).toEqual({ body: RULE });
    expect(invalidate).toHaveBeenCalled();
    call.mockRejectedValue(new ApiError(409, "conflict", "limit"));
    expect(await saveRuleAction(ID, RULE)).toEqual({ ok: false, error: "limit" });
  });

  it("format a preview, and give none for a rule the server refuses", async () => {
    call.mockResolvedValue({
      matched: 1,
      kept: 0,
      changes: 1,
      rows: [{ id: ID, on: "2026-10-14", payee: null, amount: "-42.80" }],
      retyped: { count: 1, amount: "-42.80", since: "2025-03-01", from: "expense" },
    });
    const preview = await previewRuleAction(RULE, null);
    expect(preview?.rows[0]).toMatchObject({ date: "14 Oct 2026", payee: "" });
    expect(preview?.rows[0].amount).toContain("42,80");
    expect(preview?.retyped).toMatchObject({ count: 1, year: 2025, from: "expense" });
    call.mockRejectedValue(new ApiError(400, "invalid", null));
    expect(await previewRuleAction(RULE, null)).toBeNull();
  });
});
