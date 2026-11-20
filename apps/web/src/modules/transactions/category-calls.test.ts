import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null, locale: "en" }),
  invalidate: () => {},
}));

const { CATEGORY_CALLS, dismissMerge } = await import("./category-calls");
const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  call.mockReset();
});

describe("the calls of the automatic categories", () => {
  it("answer a choice with its count and its «Undo», and a refusal with its code", async () => {
    call.mockResolvedValueOnce({ count: 2, undoId: ID });
    expect(await CATEGORY_CALLS.choose([ID], null)).toEqual({ ok: true, count: 2, undoId: ID });
    expect(call.mock.calls[0][1]).toEqual({ body: { ids: [ID], categoryId: null } });
    call.mockRejectedValueOnce(new ApiError(404, "not_found", null));
    expect(await CATEGORY_CALLS.confirm([ID])).toEqual({ ok: false, error: "not_found" });
    call.mockRejectedValueOnce(new ApiError(500, "server_error", null));
    await expect(CATEGORY_CALLS.undo(ID)).rejects.toThrow();
  });

  it("list the similar movements with their day and amount formatted, none for a refusal", async () => {
    call.mockResolvedValueOnce({
      text: "Shop",
      rows: [
        {
          id: ID,
          on: "2026-09-14",
          amount: "-1234.50",
          categoryId: null,
          suggestedCategoryId: ID,
          automatic: false,
        },
      ],
    });
    const similar = await CATEGORY_CALLS.similar(ID, ID);
    expect(similar.rows[0]).toMatchObject({ id: ID, amount: expect.stringContaining("1.234,50") });
    expect(similar.rows[0].date).toContain("2026");
    call.mockRejectedValueOnce(new ApiError(404, "not_found", null));
    expect(await CATEGORY_CALLS.similar(ID, ID)).toEqual({ text: "", rows: [] });
  });

  it("send «They are different» and its «Undo» to their two routes", async () => {
    call.mockResolvedValue(null);
    expect(await dismissMerge(ID, ID, true)).toEqual({ ok: true, count: 1 });
    expect(await dismissMerge(ID, ID, false)).toEqual({ ok: true, count: 1 });
    expect(call.mock.calls.map(([route]) => route.id)).toEqual([
      "dismiss_merge_proposal",
      "restore_merge_proposal",
    ]);
  });
});
