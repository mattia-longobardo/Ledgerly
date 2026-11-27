import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";

const call = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
  invalidate: () => undefined,
}));

const { backfillPlan, confirmRun, createPlan, updatePlan } = await import("./plan-calls");
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const PLAN = "00000000-0000-4000-8000-000000000002";
const RUN = { accountId: ACCOUNT, planId: PLAN, runId: "00000000-0000-4000-8000-000000000003" };

const EDIT = {
  name: "Monthly ETF",
  mode: "propose" as const,
  end: "never" as const,
  endOn: "",
  runsLimit: "",
  debitAccountId: "",
  fee: { kind: "none" as const, value: "" },
};
const FORM = {
  ...EDIT,
  instrumentId: "00000000-0000-4000-8000-000000000004",
  mic: "XMIL",
  size: "amount" as const,
  amount: "1.000,5",
  quantity: "",
  fractions: false,
  frequency: "month" as const,
  interval: "1",
  day: "5",
  startOn: "2026-01-05",
};

beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({ id: PLAN });
});

describe("the calls of the purchase plans", () => {
  // The body of a plan is a basket since PERS-681: the R5d form sends one instrument at 100 %.
  it("send a new plan as the contract's decimals, a basket of the one instrument", async () => {
    expect(await createPlan(ACCOUNT, FORM)).toEqual({ ok: true, id: PLAN });
    expect(call.mock.calls[0][1]).toEqual({
      params: { accountId: ACCOUNT },
      body: {
        name: "Monthly ETF",
        endOn: null,
        runsLimit: null,
        debitAccountId: null,
        fee: null,
        instruments: [{ instrumentId: FORM.instrumentId, mic: "XMIL", weight: "100" }],
        amount: "1000.50",
        frequency: "month",
        interval: 1,
        day: 5,
        startOn: "2026-01-05",
      },
    });
  });

  it("send a fee typed as a percentage as the fraction the contract takes, and the end chosen", async () => {
    const edit = {
      ...EDIT,
      end: "count" as const,
      runsLimit: "24",
      fee: { kind: "rate" as const, value: "0,19" },
    };
    expect(await updatePlan(ACCOUNT, PLAN, edit)).toEqual({ ok: true });
    expect(call.mock.calls[0][1].body).toMatchObject({
      runsLimit: 24,
      endOn: null,
      fee: { amount: null, rate: "0.19" },
    });
  });

  it("answer a field the form cannot read with `invalid`, before any call", async () => {
    expect(await createPlan(ACCOUNT, { ...FORM, day: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await createPlan(ACCOUNT, { ...FORM, amount: "" })).toEqual({ ok: false, error: "invalid" });
    expect(call).not.toHaveBeenCalled();
  });

  it("confirm an instalment with the corrections typed only", async () => {
    await confirmRun(RUN, { on: "", quantity: "", unitPrice: "37,05", fee: "" });
    expect(call.mock.calls[0][1]).toEqual({ params: RUN, body: { unitPrice: "37.05" } });
  });

  it("keep the server's refusal of a purchase with no cash (P2)", async () => {
    call.mockRejectedValue(new ApiError(409, "negative_cash", null));
    expect(await confirmRun(RUN, { on: "", quantity: "", unitPrice: "", fee: "" })).toEqual({
      ok: false,
      error: "negative_cash",
    });
  });

  it("send the past instalments together, the day of the purchase the due date when left empty", async () => {
    const row = { dueOn: "2026-10-05", on: "", quantity: "2,7", unitPrice: "36,9", fee: "" };
    await backfillPlan(ACCOUNT, PLAN, [row]);
    expect(call.mock.calls[0][1].body).toEqual({
      runs: [{ dueOn: "2026-10-05", on: "2026-10-05", quantity: "2.7", unitPrice: "36.9", fee: null }],
    });
  });
});
