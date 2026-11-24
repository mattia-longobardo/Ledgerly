import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@ledgerly/api-client";
import { employer, manual, payroll } from "@ledgerly/api-contract/payroll";

const call = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null, locale: "en" }),
  invalidate,
  remember: vi.fn(),
}));

const { deleteManualPayslipAction, saveEmployerAction, saveManualPayslipAction } = await import("./manual-calls");
const ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT = "00000000-0000-4000-8000-000000000002";
const FORM = {
  kind: "ordinary",
  year: "2031",
  month: "3",
  extraNumber: "2",
  paidOn: "",
  gross: "3.000,00",
  taxes: "600",
  contributions: "280,5",
  net: "2.119,50",
  fields: { irpefGross: "650,00", taxDeductions: " " },
};

beforeEach(() => {
  call.mockReset();
  invalidate.mockReset();
});

describe("the calls of a payslip typed by hand", () => {
  it("send the typed amounts as decimals, the month of the kind and no empty field", async () => {
    call.mockResolvedValue({ id: ID });
    expect(await saveManualPayslipAction(null, FORM, null)).toEqual({ ok: true, id: ID });
    expect(call).toHaveBeenCalledWith(manual.createManualPayslip, {
      body: {
        kind: "ordinary",
        year: 2031,
        month: 3,
        extraNumber: null,
        paidOn: null,
        gross: "3000.00",
        taxes: "600.00",
        contributions: "280.50",
        net: "2119.50",
        fields: { irpefGross: "650.00" },
      },
    });
    expect(invalidate).toHaveBeenCalledWith(payroll.getPayroll, payroll.getPayslip);
  });

  it("send the number of an extra payment and no month", async () => {
    call.mockResolvedValue({ id: ID });
    await saveManualPayslipAction(ID, { ...FORM, kind: "extra" }, null);
    expect(call.mock.calls[0][0]).toBe(manual.updateManualPayslip);
    expect(call.mock.calls[0][1]).toMatchObject({ params: { id: ID }, body: { month: null, extraNumber: 2 } });
  });

  it("refuse an amount nobody can read without a call", async () => {
    expect(await saveManualPayslipAction(null, { ...FORM, net: "abc" }, null)).toEqual({ ok: false, error: "invalid_value" });
    expect(call).not.toHaveBeenCalled();
  });

  it("answer the route's refusal by its reason", async () => {
    call.mockRejectedValue(new ApiError(409, "conflict", "conflict"));
    expect(await saveManualPayslipAction(null, FORM, null)).toEqual({ ok: false, error: "conflict" });
  });

  it("upload the PDF, wait until it is read, then give its id", async () => {
    vi.useFakeTimers();
    const states = ["extracting", "needs_review"];
    call.mockImplementation(async (route: unknown) => {
      if (route === manual.createManualPayslip) return { id: ID };
      if (route === payroll.getPayslip) return { document: { state: states.shift() } };
      return { id: DOCUMENT };
    });
    const saving = saveManualPayslipAction(null, FORM, new File(["%PDF-"], "march.pdf"));
    await vi.runAllTimersAsync();
    expect(await saving).toEqual({ ok: true, id: ID });
    expect(call.mock.calls.at(-1)?.[1].body.documentId).toBe(DOCUMENT);
    vi.useRealTimers();
  });

  it("delete one", async () => {
    call.mockResolvedValue({ deletedDocument: false });
    expect(await deleteManualPayslipAction(ID)).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith(manual.deleteManualPayslip, { params: { id: ID } });
  });
});

describe("the employer", () => {
  it("saves the frequency and the months, and refuses a fourth extra payment without a call", async () => {
    call.mockResolvedValue({ payFrequency: "monthly", extraMonths: [12, 6], configured: true });
    expect(await saveEmployerAction("monthly", [12, 6])).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith(employer.setPayrollEmployer, { body: { payFrequency: "monthly", extraMonths: [12, 6] } });
    call.mockReset();
    expect(await saveEmployerAction("monthly", [12, 6, 7, 8])).toEqual({ ok: false, error: "invalid_value" });
    expect(call).not.toHaveBeenCalled();
  });
});
