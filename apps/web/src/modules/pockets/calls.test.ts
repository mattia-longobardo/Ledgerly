import { describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
const reread = vi.hoisted(() => ({ asked: false, done: () => {} }));
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  invalidate: () => {
    reread.asked = true;
    return new Promise<void>((resolve) => (reread.done = resolve));
  },
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
}));

const { updatePocket } = await import("./calls");

describe("the calls of Pockets", () => {
  it("end a save only once the pocket is read again, so «Edit pocket» opens on the new values", async () => {
    call.mockResolvedValue({});
    let ended = false;
    const saving = updatePocket("pocket-1", {
      name: "Car",
      accountId: null,
      target: "",
      monthly: "",
      startMonth: "2026-11-01",
      accrualDay: 31,
    }).then((result) => {
      ended = true;
      return result;
    });
    await vi.waitFor(() => expect(reread.asked).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ended).toBe(false);
    reread.done();
    expect(await saving).toEqual({ ok: true });
  });
});
