import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { Toaster } from "@ledgerly/ui/toast";
import { LeaveTypes } from "./leave-types";

const saveType = vi.fn();
const deleteType = vi.fn();

vi.mock("./calls", () => ({
  saveLeaveTypeAction: (...args: unknown[]) => saveType(...args),
  deleteLeaveTypeAction: (...args: unknown[]) => deleteType(...args),
  settingsChanged: vi.fn(),
}));

const VACATION = {
  id: "t1",
  name: "Vacation",
  color: "primary",
  unit: "half_day",
  hasAllowance: true,
  toCalendar: true,
} as const;
const PERMIT = {
  ...VACATION,
  id: "t2",
  name: "Permit",
  color: "warn",
  unit: "hours",
  toCalendar: false,
} as const;

function renderTypes(types = [VACATION, PERMIT]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <LeaveTypes types={[...types]} />
      <Toaster closeLabel="Close" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  saveType.mockReset().mockResolvedValue({ ok: true });
  deleteType.mockReset().mockResolvedValue({ ok: true });
});

describe("LeaveTypes", () => {
  it("lists the person's types with what each one is", () => {
    renderTypes();
    const rows = within(screen.getByTestId("leave-types")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("VacationWhole or half days · Allowance · To the calendar"),
      expect.stringContaining("PermitHours · Allowance"),
    ]);
  });

  it("adds a type with the five fields of its dialog", async () => {
    renderTypes([]);
    expect(screen.getByText("No types of leave yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a type" }));
    const dialog = within(await screen.findByRole("dialog", { name: "New type of leave" }));
    await userEvent.type(dialog.getByLabelText("Name"), "  Sick leave ");
    await userEvent.selectOptions(dialog.getByLabelText("Colour"), "neg");
    await userEvent.selectOptions(dialog.getByLabelText("Booked in"), "day");
    await userEvent.click(dialog.getByLabelText("Goes to the external calendar"));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(saveType).toHaveBeenCalledExactlyOnceWith(null, {
      name: "Sick leave",
      color: "neg",
      unit: "day",
      hasAllowance: false,
      toCalendar: true,
    });
    expect(await screen.findByText("Type Sick leave added")).toBeInTheDocument();
  });

  it("edits a type in place, and says a name already in use", async () => {
    saveType.mockResolvedValueOnce({ ok: false, error: "conflict" });
    renderTypes();
    await userEvent.click(screen.getByRole("button", { name: "Edit Permit" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Edit type of leave" }));
    expect(dialog.getByLabelText("Name")).toHaveValue("Permit");
    await userEvent.clear(dialog.getByLabelText("Name"));
    await userEvent.type(dialog.getByLabelText("Name"), "Vacation");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    expect(saveType).toHaveBeenCalledWith("t2", expect.objectContaining({ name: "Vacation", unit: "hours" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("You already have a type with this name.");
  });

  it("asks before it removes a type, and says why one with days stays", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteType.mockResolvedValueOnce({ ok: false, error: "in_use" });
    renderTypes();
    await userEvent.click(screen.getByRole("button", { name: "Remove Vacation" }));
    expect(confirm).toHaveBeenCalledWith("Remove the type Vacation?");
    expect(deleteType).toHaveBeenCalledExactlyOnceWith("t1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vacation has days booked: move or remove them first.",
    );
  });

  it("removes nothing when the question is turned down", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTypes();
    await userEvent.click(screen.getByRole("button", { name: "Remove Permit" }));
    expect(deleteType).not.toHaveBeenCalled();
  });
});
