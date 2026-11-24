import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { RestDays } from "./rest-days";
import { WorkingHoursForm } from "./settings-forms";
import { TypeAllowanceForm } from "./type-allowances";
import { WorkWeekForm } from "./work-week";

const savePreferences = vi.fn();
const saveAllowance = vi.fn();
const saveSettings = vi.fn();
const addRestDay = vi.fn();
const deleteRestDay = vi.fn();

vi.mock("./calls", () => ({
  saveTypeAllowanceAction: (...args: unknown[]) => saveAllowance(...args),
  saveTimeOffPreferencesAction: (...args: unknown[]) => savePreferences(...args),
  saveLeaveSettingsAction: (...args: unknown[]) => saveSettings(...args),
  addRestDayAction: (...args: unknown[]) => addRestDay(...args),
  deleteRestDayAction: (...args: unknown[]) => deleteRestDay(...args),
  settingsChanged: vi.fn(),
}));
function inIntl(children: React.ReactNode) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
    </NextIntlClientProvider>,
  );
}

/** The forms have no Save of their own: the page's banner saves them once they hold a change. */
const save = async () => userEvent.click(await screen.findByRole("button", { name: "Save changes" }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of [savePreferences, saveAllowance, saveSettings, addRestDay, deleteRestDay]) {
    call.mockResolvedValue({ ok: true });
  }
});

describe("RestDays", () => {
  it("adds a day off with its own button, the day kept within the month", async () => {
    inIntl(<RestDays days={[]} />);
    await userEvent.selectOptions(screen.getByLabelText("Month"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Day"), "28");
    await userEvent.selectOptions(screen.getByLabelText("Month"), "4");
    expect(screen.getByLabelText("Day")).toHaveDisplayValue("28");
    await userEvent.type(screen.getByLabelText("Name"), "Patron saint");
    await userEvent.click(screen.getByRole("button", { name: "Add the day off" }));
    expect(addRestDay).toHaveBeenCalledExactlyOnceWith({ month: 4, day: 28, name: "Patron saint" });
    // Not a form of the banner: nothing waits to be saved.
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
  });

  it("asks before it removes a day off, and says which", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    inIntl(<RestDays days={[{ id: "d1", month: 12, day: 7, name: "Sant'Ambrogio" }]} />);
    expect(screen.getByText("7 December · Sant'Ambrogio")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Sant'Ambrogio" }));
    expect(confirm).toHaveBeenCalledWith("Remove 7 December · Sant'Ambrogio from your days off?");
    expect(deleteRestDay).toHaveBeenCalledExactlyOnceWith("d1");
    confirm.mockRestore();
  });
});

describe("WorkWeekForm", () => {
  it("saves the working days in order and the first month of the leave year", async () => {
    inIntl(<WorkWeekForm workDays={[1, 2, 3, 4, 5]} yearStartMonth={1} weekStart={1} />);
    await userEvent.click(screen.getByLabelText("Friday"));
    await userEvent.click(screen.getByLabelText("Saturday"));
    await userEvent.selectOptions(screen.getByLabelText("Leave year starts in"), "4");
    await save();
    expect(saveSettings).toHaveBeenCalledWith({ workDays: [1, 2, 3, 4, 6], yearStartMonth: 4 });
  });
});

describe("WorkingHoursForm", () => {
  it("saves the hours as minutes, and nothing else", async () => {
    inIntl(<WorkingHoursForm minutesPerDay={480} />);
    const hours = screen.getByLabelText("Hours in a working day");
    await userEvent.clear(hours);
    await userEvent.type(hours, "7.5");
    await save();
    expect(savePreferences).toHaveBeenCalledWith({ minutesPerDay: 450 });
  });

  it("says when the value is refused", async () => {
    savePreferences.mockResolvedValue({ ok: false, error: "invalid" });
    inIntl(<WorkingHoursForm minutesPerDay={480} />);
    const hours = screen.getByLabelText("Hours in a working day");
    await userEvent.clear(hours);
    await userEvent.type(hours, "7");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.timeoff.errors.invalid);
  });
});

describe("TypeAllowanceForm", () => {
  const empty = [
    { typeId: "vacation", name: "Vacation", days: "", carriedDays: "" },
    { typeId: "rol", name: "ROL", days: "", carriedDays: "" },
  ];
  const last = [
    { typeId: "vacation", name: "Vacation", days: "26", carriedDays: "" },
    { typeId: "rol", name: "ROL", days: "4", carriedDays: "1.5" },
  ];

  it("saves the days and the carry-over of each type under its year", async () => {
    inIntl(<TypeAllowanceForm year={2026} rows={empty} previous={null} stepper={null} />);
    await userEvent.type(screen.getByLabelText("Vacation: days a year"), "26");
    await userEvent.type(screen.getByLabelText("ROL: carried over"), "-2");
    await save();
    expect(saveAllowance).toHaveBeenCalledWith({
      typeId: "vacation",
      year: 2026,
      days: "26",
      carriedDays: "",
    });
    expect(saveAllowance).toHaveBeenCalledWith({ typeId: "rol", year: 2026, days: "", carriedDays: "-2" });
  });

  it("fills in last year's values on request, shows the banner, and has no Save of its own", async () => {
    inIntl(<TypeAllowanceForm year={2026} rows={empty} previous={last} stepper={null} />);
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy from 2025" }));
    expect(screen.getByLabelText("ROL: days a year")).toHaveValue(4);
    expect(await screen.findByTestId("unsaved-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers no copy when last year has no allowance", () => {
    inIntl(<TypeAllowanceForm year={2026} rows={empty} previous={null} stepper={null} />);
    expect(screen.queryByRole("button", { name: /Copy from/ })).toBeNull();
  });

  it("says when a value is refused", async () => {
    saveAllowance.mockResolvedValueOnce({ ok: false, error: "invalid" });
    inIntl(<TypeAllowanceForm year={2026} rows={empty} previous={null} stepper={null} />);
    await userEvent.type(screen.getByLabelText("Vacation: days a year"), "26");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.timeoff.errors.invalid);
  });
});
