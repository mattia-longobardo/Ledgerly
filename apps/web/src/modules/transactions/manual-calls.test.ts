import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null, locale: "en" }),
  invalidate,
}));

const { MANUAL_CALLS } = await import("./manual-calls");
const ID = "00000000-0000-4000-8000-000000000001";
const FORM = {
  kind: "expense" as const,
  amount: "1.234,5",
  on: "2026-10-14",
  accountId: ID,
  categoryId: null,
  payee: "Shop",
  note: "",
  transferAccountId: null,
};

beforeEach(() => {
  call.mockReset();
  invalidate.mockReset();
});

describe("the calls of the manual movement", () => {
  it("send the typed amount as the decimal of its size, and say the day", async () => {
    call.mockResolvedValue({ id: ID, created: true, on: "2026-10-14", accountId: ID });
    const saved = await MANUAL_CALLS.create(FORM, ID);
    expect(call.mock.calls[0][1]).toEqual({ body: { ...FORM, amount: "1234.50", key: ID } });
    expect(saved).toMatchObject({ ok: true, created: true, id: ID, on: "2026-10-14", accountId: ID });
    expect(saved.ok && saved.date).toContain("2026");
    expect(invalidate).toHaveBeenCalled();
  });

  it("send a giroconto's other account, and read again the balances of every account", async () => {
    const other = "00000000-0000-4000-8000-000000000002";
    call.mockResolvedValue({ id: ID, created: true });
    await MANUAL_CALLS.create({ ...FORM, transferAccountId: other }, ID);
    expect(call.mock.calls[0][1].body).toMatchObject({ transferAccountId: other });
    expect(invalidate.mock.calls[0].map((route: { path: string }) => route.path)).toEqual(
      expect.arrayContaining(["/net-worth", "/accounts/{id}/context", "/accounts/{id}/daily-balances"]),
    );
  });

  it("refuse an amount that is not one above zero without a call", async () => {
    expect(await MANUAL_CALLS.create({ ...FORM, amount: "0" }, ID)).toEqual({ ok: false, error: "amount" });
    expect(await MANUAL_CALLS.preview({ ...FORM, amount: "abc" })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("name the use case's refusals with the dialog's words", async () => {
    const refusals = [
      [new ApiError(400, "invalid", "future_date"), "date"],
      [new ApiError(409, "conflict", "account_unavailable"), "account"],
      [new ApiError(409, "conflict", "not_manual"), "notFound"],
      [new ApiError(404, "not_found", null), "notFound"],
      [new ApiError(400, "invalid", "invalid"), "failed"],
    ] as const;
    for (const [error, word] of refusals) {
      call.mockRejectedValueOnce(error);
      expect(await MANUAL_CALLS.update(ID, FORM)).toEqual({ ok: false, error: word });
    }
  });

  it("format the preview's balances in the person's format", async () => {
    call.mockResolvedValue({
      preview: { kind: "change", account: "A", before: "100.00", after: "-1234.50" },
    });
    expect(await MANUAL_CALLS.preview({ ...FORM, amount: "1" })).toEqual({
      kind: "change",
      account: "A",
      before: expect.stringContaining("100,00"),
      after: expect.stringContaining("1.234,50"),
    });
  });
});
