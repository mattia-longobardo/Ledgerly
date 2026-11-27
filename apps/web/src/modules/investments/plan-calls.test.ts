import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
  invalidate: () => undefined,
}));

const { confirmRun, createPlan, previewRun, updatePlan } = await import("./plan-calls");
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const PLAN = "00000000-0000-4000-8000-000000000002";
const RUN = { accountId: ACCOUNT, planId: PLAN, runId: "00000000-0000-4000-8000-000000000003" };
const ASSET = "00000000-0000-4000-8000-000000000005";
const INSTRUMENT = "00000000-0000-4000-8000-000000000004";

// A basket (PERS-681 §5): an instrument of the registry and one the portfolio already holds.
const FORM = {
  name: "Monthly ETFs",
  amount: "1.000,5",
  instruments: [
    { key: "a", name: "A", weight: "66,67", assetId: null, instrumentId: INSTRUMENT, mic: "XMIL" },
    { key: "b", name: "B", weight: "33,33", assetId: ASSET, instrumentId: null, mic: null },
  ],
  frequency: "month" as const,
  interval: "1",
  day: "5",
  startOn: "2026-12-05",
  end: "never" as const,
  endOn: "",
  runsLimit: "",
  debitAccountId: "",
  fee: { kind: "none" as const, value: "" },
};

beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({ id: PLAN });
});

describe("the calls of the purchase plans", () => {
  it("send a new basket as the contract's decimals: each instrument with its percentage", async () => {
    expect(await createPlan(ACCOUNT, FORM)).toEqual({ ok: true, id: PLAN });
    expect(call.mock.calls[0][1]).toEqual({
      params: { accountId: ACCOUNT },
      body: {
        name: "Monthly ETFs",
        amount: "1000.50",
        instruments: [
          { instrumentId: INSTRUMENT, mic: "XMIL", weight: "66.67" },
          { assetId: ASSET, weight: "33.33" },
        ],
        frequency: "month",
        interval: 1,
        day: 5,
        endOn: null,
        runsLimit: null,
        debitAccountId: null,
        fee: null,
        startOn: "2026-12-05",
      },
    });
  });

  it("send a working-day cadence with no day of its own", async () => {
    await createPlan(ACCOUNT, { ...FORM, frequency: "day", day: "" });
    expect(call.mock.calls[0][1].body).toMatchObject({ frequency: "day", day: 1 });
  });

  it("send a plan's cadence only when it changed: a new one starts from today", async () => {
    const edit = {
      ...FORM,
      end: "count" as const,
      runsLimit: "24",
      fee: { kind: "rate" as const, value: "0,19" },
    };
    expect(await updatePlan(ACCOUNT, PLAN, edit, FORM)).toEqual({ ok: true });
    const body = call.mock.calls[0][1].body;
    expect(body).toMatchObject({ runsLimit: 24, endOn: null, fee: { amount: null, rate: "0.19" } });
    expect(body).not.toHaveProperty("frequency");
    await updatePlan(ACCOUNT, PLAN, { ...FORM, day: "10" }, FORM);
    expect(call.mock.calls[1][1].body).toMatchObject({ frequency: "month", interval: 1, day: 10 });
  });

  it("answer a field the form cannot read with `invalid`, before any call", async () => {
    expect(await createPlan(ACCOUNT, { ...FORM, day: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await createPlan(ACCOUNT, { ...FORM, amount: "" })).toEqual({ ok: false, error: "invalid" });
    expect(call).not.toHaveBeenCalled();
  });

  it("preview the corrections typed only: a price changed, shares typed", async () => {
    call.mockResolvedValue({
      runId: RUN.runId,
      currency: "EUR",
      budget: "200.00",
      spent: "0.00",
      carryOut: "200.00",
      lines: [],
    });
    const answer = await previewRun(RUN, [
      { assetId: ASSET, unitPrice: "41,5", quantity: "", fee: "" },
      { assetId: INSTRUMENT, unitPrice: "", quantity: "3", fee: "" },
      { assetId: PLAN, unitPrice: "", quantity: "", fee: "" },
    ]);
    expect(answer).toMatchObject({ ok: true, carryOut: "200.00" });
    expect(call.mock.calls[0][1]).toEqual({
      params: RUN,
      body: {
        lines: [
          { assetId: ASSET, unitPrice: "41.5" },
          { assetId: INSTRUMENT, quantity: "3" },
        ],
      },
    });
  });

  it("confirm every line with its shares and price, the fee only when typed", async () => {
    await confirmRun(RUN, "2026-11-27", [
      { assetId: ASSET, unitPrice: "41,3", quantity: "2", fee: "" },
      { assetId: INSTRUMENT, unitPrice: "18,75", quantity: "0", fee: "1,5" },
    ]);
    expect(call.mock.calls[0][1]).toEqual({
      params: RUN,
      body: {
        on: "2026-11-27",
        lines: [
          { assetId: ASSET, quantity: "2", unitPrice: "41.3" },
          { assetId: INSTRUMENT, quantity: "0", unitPrice: "18.75", fee: "1.50" },
        ],
      },
    });
  });

  it("keep the server's refusal of purchases with no cash, and of a preview", async () => {
    call.mockRejectedValue(new ApiError(409, "negative_cash", null));
    const line = { assetId: ASSET, unitPrice: "41,3", quantity: "2", fee: "" };
    expect(await confirmRun(RUN, "", [line])).toEqual({ ok: false, error: "negative_cash" });
    call.mockRejectedValue(new ApiError(409, "not_editable", null));
    expect(await previewRun(RUN, [line])).toEqual({ ok: false, error: "not_editable" });
  });
});
