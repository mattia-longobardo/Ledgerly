import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { type ContributionForm, newContributionForm } from "../forms";
import { ContributionButton, type ContributionSetup, DeleteContributionButton } from "./contribution-dialog";

type Result = { ok: true } | { ok: false; error: string };
const save = vi.fn<(fundId: string, form: ContributionForm) => Promise<Result>>(async () => ({ ok: true }));
const remove = vi.fn<(fundId: string, operationId: string) => Promise<Result>>(async () => ({ ok: true }));
vi.mock("../actions", () => ({
  saveContributionAction: (fundId: string, form: ContributionForm) => save(fundId, form),
  deleteContributionAction: (fundId: string, operationId: string) => remove(fundId, operationId),
}));

const m = messages.funds.contribution;
const TODAY = "2026-11-14";

function setup(patch: Partial<ContributionSetup> = {}): ContributionSetup {
  return {
    fundId: "f1",
    fundName: "Fondo Beta",
    today: TODAY,
    format: "en-US",
    defaults: {
      voluntary: newContributionForm("voluntary", TODAY, { fee: "1.50" }),
      payroll: newContributionForm("payroll", TODAY, { fee: "3.00", period: "2026-3" }),
      other: newContributionForm("other", TODAY),
    },
    kind: "voluntary",
    hasPayroll: true,
    periods: [
      { value: "2026-4", label: "Q4 2026" },
      { value: "2026-3", label: "Q3 2026" },
    ],
    movements: [{ id: "11111111-1111-4111-8111-111111111111", label: "05 Nov · Example · €100.00" }],
    ...patch,
  };
}

async function open(patch: Partial<ContributionSetup> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ContributionButton setup={setup(patch)} label={m.record} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: m.record }));
  return screen.getByRole("dialog", { name: "Record contribution · Fondo Beta" });
}

beforeEach(() => {
  save.mockClear();
  remove.mockClear();
});

describe("ContributionDialog", () => {
  it("opens on a voluntary contribution, with the fee of the fund's list and the amount invested", async () => {
    await open();
    expect(screen.getByRole("button", { name: m.kinds.voluntary })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(m.fee)).toHaveValue("1.50");
    await userEvent.type(screen.getByLabelText(m.amount), "100");
    expect(screen.getByTestId("contribution-invested")).toHaveTextContent("98.50");
    expect(screen.getByLabelText(m.movement)).toBeInTheDocument();
  });

  it("disables and empties the fee when the person does not know it", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(m.amount), "100");
    await userEvent.click(screen.getByLabelText(m.feeUnknown));
    expect(screen.getByLabelText(m.fee)).toBeDisabled();
    expect(screen.getByLabelText(m.fee)).toHaveValue("");
    expect(screen.getByTestId("contribution-invested")).toHaveTextContent("—");
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({
      kind: "voluntary",
      amount: "100",
      fee: "",
      feeUnknown: true,
    });
  });

  it("asks for an amount before it saves a voluntary contribution", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(screen.getByText(m.errors.amount)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("opens on the payslip for a fund fed by the payslip alone, on the oldest period still on its way", async () => {
    await open({ kind: "payroll" });
    expect(screen.getByRole("button", { name: m.kinds.payroll })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(m.payrollHelp)).toBeInTheDocument();
    expect(screen.getByLabelText(m.period)).toHaveValue("2026-3");
    expect(screen.queryByLabelText(m.movement)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(screen.getByText(m.errors.components)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(messages.funds.fund.contributions.components.tfr), "210");
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({
      kind: "payroll",
      tfr: "210",
      period: "2026-3",
      fee: "3.00",
    });
  });

  it("has no period to choose in a fund with no payslip source", async () => {
    await open({ hasPayroll: false, periods: [] });
    await userEvent.click(screen.getByRole("button", { name: m.kinds.payroll }));
    expect(screen.queryByLabelText(m.period)).not.toBeInTheDocument();
  });

  it("records an exit as another operation, and a change of compartment with no amount", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: m.kinds.other }));
    expect(screen.getByLabelText(m.operation)).toHaveValue("withdrawal");
    expect(screen.getByText(m.otherHelp)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(m.operation), "switch");
    expect(screen.queryByLabelText(m.amount)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(m.fee), "10");
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({
      kind: "other",
      classification: "switch",
      amount: "",
      fee: "10",
    });
  });

  it("says under the movement that it is already tied to another contribution", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "movement_taken" });
    await open();
    await userEvent.type(screen.getByLabelText(m.amount), "100");
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(await screen.findByText(messages.funds.errors.movement_taken)).toBeInTheDocument();
    expect(screen.getByLabelText(m.amount)).toHaveValue("100");
  });
});

describe("DeleteContributionButton", () => {
  it("asks before it deletes", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeleteContributionButton
          fundId="f1"
          operationId="o1"
          date="5 Nov 2026"
          label="Delete"
          ariaLabel="Delete the contribution of 5 Nov 2026"
        />
      </NextIntlClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete the contribution of 5 Nov 2026" }));
    expect(remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: m.delete.title });
    expect(dialog).toHaveTextContent("5 Nov 2026");
    await userEvent.click(screen.getByRole("button", { name: m.delete.confirm }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("f1", "o1"));
  });
});
