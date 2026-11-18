import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { type FeeForm, newFeeForm } from "@domain/modules/funds/forms";
import { FeeDialog } from "./fee-dialog";

const SCOPES = [
  { value: "#0", label: "Payslip" },
  { value: "#0:tfr", label: "Payslip · TFR" },
];

function renderDialog(
  fee: FeeForm = newFeeForm(),
  onSave = vi.fn<(fee: FeeForm) => string | null>(() => null),
  scopes = SCOPES,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FeeDialog open onOpenChange={() => {}} fee={fee} scopes={scopes} format="en-US" onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return onSave;
}

const basis = () => screen.getByLabelText("Type");
const mode = () => screen.queryByRole("group", { name: "Amount or percentage" });

/** The fields follow the basis (screens §7.2). */
describe("FeeDialog", () => {
  it("opens on a fee on each contribution: amount or percentage, a scope, no period", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Add fee" })).toBeInTheDocument();
    expect(basis()).toHaveValue("per_contribution");
    expect(mode()).toBeInTheDocument();
    expect(screen.getByLabelText("Applies to")).toBeInTheDocument();
    expect(screen.queryByLabelText("Every")).not.toBeInTheDocument();
    expect(screen.getByText("Taken from each contribution.")).toBeInTheDocument();
  });

  it("asks a fee on assets for a percentage and a period only", async () => {
    renderDialog();
    await userEvent.selectOptions(basis(), "on_assets");
    expect(mode()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Value (percentage)")).toBeInTheDocument();
    expect(screen.getByLabelText("Every")).toHaveValue("year");
    expect(screen.queryByLabelText("Applies to")).not.toBeInTheDocument();
  });

  it("asks a recurring fee for a period, and joining or a request for an amount only", async () => {
    renderDialog();
    await userEvent.selectOptions(basis(), "periodic");
    expect(mode()).toBeInTheDocument();
    expect(screen.getByLabelText("Every")).toBeInTheDocument();
    expect(screen.getByLabelText("Applies to")).toBeInTheDocument();
    for (const value of ["one_off", "per_request"]) {
      await userEvent.selectOptions(basis(), value);
      expect(mode()).not.toBeInTheDocument();
      expect(screen.getByLabelText("Value")).toBeInTheDocument();
      expect(screen.queryByLabelText("Every")).not.toBeInTheDocument();
    }
  });

  it("has no scope for a fund with no source", () => {
    renderDialog(newFeeForm(), undefined, []);
    expect(screen.queryByLabelText("Applies to")).not.toBeInTheDocument();
  });

  it("says what is missing under the fields and saves nothing", async () => {
    const onSave = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Save fee" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a value above zero.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hands over the fee as its basis takes it", async () => {
    const onSave = renderDialog({ ...newFeeForm(), mode: "amount", scope: "#0" });
    await userEvent.type(screen.getByLabelText("Name"), "Management");
    await userEvent.selectOptions(basis(), "on_assets");
    await userEvent.type(screen.getByLabelText("Value (percentage)"), "0.45");
    await userEvent.click(screen.getByRole("button", { name: "Save fee" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      label: "Management",
      basis: "on_assets",
      mode: "rate",
      value: "0.45",
      period: "year",
      scope: "",
    });
  });

  it("shows the message of a save that failed and keeps the fields", async () => {
    renderDialog(
      { ...newFeeForm(), label: "Entry", value: "10" },
      vi.fn(() => "Not saved. Try again."),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save fee" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved. Try again.");
    expect(screen.getByLabelText("Name")).toHaveValue("Entry");
  });

  it("is titled as an edit for a fee that exists", () => {
    renderDialog({ ...newFeeForm(), id: "f1", label: "Entry", value: "10" });
    expect(screen.getByRole("dialog", { name: "Edit fee" })).toBeInTheDocument();
  });
});
