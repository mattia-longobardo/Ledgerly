import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { UnsavedChangesProvider } from "@/ui/unsaved-changes";
import { AllowanceForm, PatronSaintForm, WorkingHoursForm } from "./settings-forms";

const savePreferences = vi.fn();
const saveAllowance = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/users/actions", () => ({
  saveTimeOffPreferencesAction: (...args: unknown[]) => savePreferences(...args),
}));
vi.mock("../actions", () => ({ saveAllowanceAction: (...args: unknown[]) => saveAllowance(...args) }));

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
  savePreferences.mockResolvedValue({ ok: true });
  saveAllowance.mockResolvedValue({ ok: true });
});

describe("PatronSaintForm", () => {
  it("clamps the day to the month's length, gives the day its own label, and saves only itself", async () => {
    inIntl(<PatronSaintForm patronSaint={{ month: 1, day: 31 }} />);
    // Only the month select carries the "Patron saint holiday" accessible name; the day select has
    // its own distinct label ("Day"), so a screen reader never announces the same name twice.
    await userEvent.selectOptions(screen.getByLabelText("Patron saint holiday"), "2");
    expect(screen.getByLabelText("Day")).toHaveDisplayValue("28");
    await save();
    expect(savePreferences).toHaveBeenCalledWith({ patronSaint: { month: 2, day: 28 } });
  });

  it("clears the patron saint", async () => {
    inIntl(<PatronSaintForm patronSaint={{ month: 12, day: 7 }} />);
    await userEvent.selectOptions(screen.getByLabelText("Patron saint holiday"), "");
    await save();
    expect(savePreferences).toHaveBeenCalledWith({ patronSaint: null });
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

describe("AllowanceForm", () => {
  const empty = { year: 2026, vacationDays: "", rolDays: "", totalDays: "", note: "" };
  const last = { year: 2025, vacationDays: "26", rolDays: "4", totalDays: "30", note: "CCNL" };

  it("fills in last year's values on request, and saves them under this year", async () => {
    inIntl(<AllowanceForm allowance={empty} previous={last} stepper={null} />);
    expect(saveAllowance).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Copy from 2025" }));
    await save();
    expect(saveAllowance).toHaveBeenCalledWith({
      year: "2026",
      vacationDays: "26",
      rolDays: "4",
      totalDays: "30",
      note: "CCNL",
    });
  });

  it("shows the banner only once a value differs, and has no Save of its own", async () => {
    inIntl(<AllowanceForm allowance={empty} previous={last} stepper={null} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
    // Set by a button, not typed: the form still sees it.
    await userEvent.click(screen.getByRole("button", { name: "Copy from 2025" }));
    expect(await screen.findByTestId("unsaved-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers no copy when last year has no allowance", () => {
    inIntl(<AllowanceForm allowance={empty} previous={null} stepper={null} />);
    expect(screen.queryByRole("button", { name: /Copy from/ })).toBeNull();
  });
});
