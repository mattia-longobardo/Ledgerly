import { beforeEach, describe, expect, it, vi } from "vitest";
import { movements, review, spending } from "@ledgerly/api-contract/transactions";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
  invalidate,
}));

const { changeVisibility, editInSource, setCategory, setLabels, setNote } = await import("./commands");
const ID = "00000000-0000-4000-8000-000000000001";
const READS = [
  movements.getTransactionsView,
  movements.listTransactions,
  movements.getTransaction,
  spending.getSpending,
  review.getReview,
];

beforeEach(() => {
  call.mockReset();
  invalidate.mockReset();
});

describe("the commands of the Expenses table", () => {
  it("set a category with the route's count, and read the movements again", async () => {
    call.mockResolvedValue({ count: 2 });
    expect(await setCategory([ID, ID], "cat")).toEqual({ ok: true, count: 2 });
    expect(call).toHaveBeenCalledWith(movements.setTransactionsCategory, {
      body: { ids: [ID, ID], categoryId: "cat" },
    });
    expect(invalidate).toHaveBeenCalledWith(...READS);
  });

  it("hide, restore and delete through the visibility route, which rebuilds the balances", async () => {
    call.mockResolvedValue({ count: 1 });
    await changeVisibility([ID], "hide");
    await changeVisibility([ID], "restore");
    await changeVisibility([ID], "delete");
    expect(call.mock.calls.map(([route, input]) => [route, input])).toEqual(
      ["hide", "restore", "delete"].map((change) => [
        movements.changeTransactionsVisibility,
        { body: { ids: [ID], change, rebuildBalances: true } },
      ]),
    );
  });

  it("save the note and the labels as a patch of the movement", async () => {
    call.mockResolvedValue(null);
    expect(await setNote(ID, "  family  ")).toEqual({ ok: true });
    expect(await setLabels(ID, ["lab"])).toEqual({ ok: true });
    expect(call.mock.calls[0]).toEqual([
      movements.updateTransaction,
      { params: { id: ID }, body: { note: "  family  " } },
    ]);
    expect(call.mock.calls[1]).toEqual([
      movements.updateTransaction,
      { params: { id: ID }, body: { labelIds: ["lab"] } },
    ]);
  });

  it("answer a refusal with the service's code, and throw a server fault", async () => {
    call.mockRejectedValueOnce(new ApiError(409, "conflict", "provider_owned"));
    expect(await setNote(ID, "x")).toEqual({ ok: false, error: "provider_owned" });
    call.mockRejectedValueOnce(new ApiError(404, "not_found", null));
    expect(await changeVisibility([ID], "hide")).toEqual({ ok: false, error: "not_found" });
    call.mockRejectedValueOnce(new ApiError(500, "internal", null));
    await expect(setCategory([ID], null)).rejects.toThrow();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("the edit at the source", () => {
  const input = { type: "expense" as const, amount: "1.234,5", payee: "Shop", note: "" };

  it("sends the amount typed in the person's format as a decimal", async () => {
    call.mockResolvedValue({ state: "saved" });
    expect(await editInSource(ID, input)).toEqual({ ok: true, state: "saved" });
    expect(call).toHaveBeenCalledWith(movements.editAtSource, {
      params: { id: ID },
      body: { ...input, amount: "1234.50" },
    });
    expect(invalidate).toHaveBeenCalledWith(...READS);
  });

  it("refuses an unreadable or zero amount without a call", async () => {
    expect(await editInSource(ID, { ...input, amount: "abc" })).toEqual({ ok: false, error: "amount" });
    expect(await editInSource(ID, { ...input, amount: "0" })).toEqual({ ok: false, error: "amount" });
    expect(call).not.toHaveBeenCalled();
  });

  it("maps the route's refusals to the codes of the panel", async () => {
    const cases: [ApiError, unknown][] = [
      [new ApiError(409, "conflict", "not_linked"), { ok: false, error: "notLinked" }],
      [new ApiError(409, "conflict", "no_transfer_category"), { ok: false, error: "noTransferCategory" }],
      [new ApiError(409, "conflict", "provider_refused"), { ok: false, error: "refused" }],
      [new ApiError(409, "conflict", "zero_amount"), { ok: false, error: "amount" }],
      [new ApiError(409, "conflict", "gone"), { ok: false, error: "notLinked" }],
      [
        new ApiError(409, "conflict", "Record locked"),
        { ok: false, error: "refused", reason: "Record locked" },
      ],
      [new ApiError(503, "unavailable", "timeout"), { ok: false, error: "failed", reason: "timeout" }],
      [new ApiError(400, "invalid", null), { ok: false, error: "invalid" }],
    ];
    for (const [refusal, result] of cases) {
      call.mockRejectedValueOnce(refusal);
      expect(await editInSource(ID, input)).toEqual(result);
    }
  });
});
