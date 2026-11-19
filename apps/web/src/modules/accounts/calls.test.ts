import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
}));
vi.mock("./actions", () => ({}));

const { checkSwitchAction, saveBalanceEntryAction } = await import("./calls");
const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  call.mockReset();
});

describe("the calls of accounts", () => {
  it("send an amount typed in the person's format as the decimal of the contract", async () => {
    call.mockResolvedValue({});
    const typed = { on: "2026-10-31", amount: "1.234,5", available: "", note: "x" };
    expect(await saveBalanceEntryAction(ID, typed)).toEqual({ ok: true });
    expect(call.mock.calls[0][1]).toEqual({
      params: { id: ID },
      body: { on: "2026-10-31", balance: "1234.50", available: null, note: "x" },
    });
  });

  it("answer an amount the format cannot read, and a refusal, with the form's code", async () => {
    const typed = { on: "2026-10-31", amount: "abc", available: "", note: "" };
    expect(await saveBalanceEntryAction(ID, typed)).toEqual({ ok: false, error: "invalid" });
    call.mockRejectedValue(new ApiError(400, "invalid", "future_date"));
    expect(await saveBalanceEntryAction(ID, { ...typed, amount: "1" })).toEqual({
      ok: false,
      error: "future_date",
    });
  });

  it("give the switch the moment to try again, and `failed` for what it cannot name", async () => {
    const target = { connectionId: ID, bankAccountId: ID };
    call.mockRejectedValue(new ApiError(429, "rate_limited", "2026-11-19T10:00:00.000Z"));
    expect(await checkSwitchAction(ID, target)).toEqual({
      ok: false,
      error: "rate_limited",
      retryAt: "2026-11-19T10:00:00.000Z",
    });
    call.mockRejectedValue(new ApiError(500, "server_error", null));
    expect(await checkSwitchAction(ID, target)).toEqual({ ok: false, error: "failed", retryAt: null });
  });
});
