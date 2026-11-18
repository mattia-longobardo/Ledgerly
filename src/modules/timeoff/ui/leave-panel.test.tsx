import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { italianHolidays } from "@domain/platform/holidays/rules";
import type { LeaveDayKind, LeaveDayView, ResidualInput } from "@domain/modules/timeoff/rules";
import { leaveTypeOptions } from "./kinds";
import { type BookedLeave, type LeavePanelEntry, LeavePanel } from "./leave-panel";

const onConfirm = vi.fn();
const onRemove = vi.fn();
const onClose = vi.fn();
const onRangeChange = vi.fn();

const MINUTES_PER_DAY = 420;
const HOLIDAYS = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((one) => one.date));
// Names nobody wrote in the panel: if one of them shows, it came from this list.
const NAMES: Record<LeaveDayKind, string> = {
  vacation: "Holiday leave",
  rol: "Hours bank",
  comp: "Time in lieu",
  sick: "Illness",
  other: "Something else",
};
const TYPES = leaveTypeOptions((kind) => NAMES[kind]);

function allowance(days: number, booked: LeaveDayView[]): ResidualInput {
  return {
    snapshot: null,
    allowanceMinutes: days * MINUTES_PER_DAY,
    carriedMinutes: 0,
    days: booked,
    countedThrough: null,
    minutesPerDay: MINUTES_PER_DAY,
  };
}

function row(on: string, kind: LeaveDayKind, fraction = 1, extra: Partial<BookedLeave> = {}): BookedLeave {
  return { id: `${on}-${kind}`, on, kind, fraction, note: null, origin: "manual", pending: "none", ...extra };
}

function renderPanel(
  entry: LeavePanelEntry,
  booked: BookedLeave[] = [],
  options: { vacation?: number | null; rol?: number; saving?: boolean; error?: string } = {},
) {
  const days = booked.map(({ on, kind, fraction }) => ({ on, kind, fraction }));
  const vacation = allowance(
    options.vacation ?? 26,
    days.filter((one) => one.kind === "vacation"),
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <LeavePanel
        entry={entry}
        data={{
          year: 2026,
          minutesPerDay: MINUTES_PER_DAY,
          days,
          holidays: HOLIDAYS,
          residuals: {
            vacation: options.vacation === null ? { ...vacation, allowanceMinutes: null } : vacation,
            rol: allowance(
              options.rol ?? 4,
              days.filter((one) => one.kind === "rol"),
            ),
          },
          types: TYPES,
        }}
        saving={options.saving ?? false}
        error={options.error ?? null}
        onRangeChange={onRangeChange}
        onConfirm={onConfirm}
        onRemove={onRemove}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("dialog"));
}

const summary = () => screen.getByTestId("summary");
/** One line of the summary, by its label. */
const line = (label: string) => within(summary()).getByText(label).nextElementSibling as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a range picked on the calendar", () => {
  it("says what the range comes to, what it leaves out and what is left, before anything is written", () => {
    // Monday 1 June to Sunday the 7th: Republic Day and a weekend are inside.
    const panel = renderPanel({ mode: "range", from: "2026-06-01", to: "2026-06-07" });
    expect(panel.getByRole("heading", { name: "New leave" })).toBeInTheDocument();
    expect(panel.getByText("1 – 7 June 2026")).toBeInTheDocument();
    expect(line("Duration")).toHaveTextContent("4 d (4 working days)");
    expect(line("Days left out")).toHaveTextContent("3: Tue 2 (holiday), Sat 6, Sun 7");
    expect(line("Holiday leave balance")).toHaveTextContent("26 d → 22 d");
    expect(within(summary()).queryByText("Replaces")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sends the fields as they stand on Confirm, once", async () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-19" });
    await userEvent.selectOptions(panel.getByLabelText("Type"), "rol");
    await userEvent.click(panel.getByRole("button", { name: "Half day" }));
    await userEvent.type(panel.getByLabelText("Note"), "mornings");
    expect(line("Duration")).toHaveTextContent("2.5 d (5 half days)");
    expect(line("Hours bank balance")).toHaveTextContent("4 d → 1.5 d");

    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      from: "2026-06-15",
      to: "2026-06-19",
      kind: "rol",
      fraction: "0.5",
      note: "mornings",
      editedKind: null,
    });
  });

  it("lists the rows the range replaces, with their kind, and the balance they give back", () => {
    renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-19" }, [
      row("2026-06-17", "rol"),
      row("2026-06-18", "rol", 0.5),
    ]);
    expect(line("Replaces")).toHaveTextContent("2: Wed 17 (Hours bank), Thu 18 (Hours bank ½)");
    expect(line("Holiday leave balance")).toHaveTextContent("26 d → 21 d");
    expect(line("Hours bank balance")).toHaveTextContent("2.5 d → 4 d");
  });

  it("says the first five and how many more when a list is long", () => {
    renderPanel({ mode: "range", from: "2026-06-01", to: "2026-06-30" });
    expect(line("Days left out")).toHaveTextContent(
      "9: Tue 2 (holiday), Sat 6, Sun 7, Sat 13, Sun 14, + 4 more",
    );
  });

  it("shows a balance below zero as a negative number, and still confirms (decision Q2)", async () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-19" }, [], { vacation: 3 });
    const balance = line("Holiday leave balance");
    expect(balance).toHaveTextContent("3 d → −2 d");
    expect(balance).toHaveAttribute("data-negative", "true");
    expect(panel.getByText(/The balance goes 2 d below zero\. You can confirm/)).toBeInTheDocument();

    const confirm = panel.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("says a balance nobody can compute is unknown, and where to state the allowance", () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-15" }, [], {
      vacation: null,
    });
    expect(line("Holiday leave balance")).toHaveTextContent("— · allowance not stated");
    expect(panel.getByRole("link", { name: "Set allowance" })).toHaveAttribute(
      "href",
      "/timeoff/settings?year=2026",
    );
  });

  it("says a kind with no allowance spends none", async () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-15" });
    await userEvent.selectOptions(panel.getByLabelText("Type"), "comp");
    expect(panel.getByText("This type does not use the balance.")).toBeInTheDocument();
    expect(within(summary()).queryByText(/balance$/)).not.toBeInTheDocument();
  });

  it("counts the days of another year apart, and says where their balance is", () => {
    const panel = renderPanel({ mode: "range", from: "2026-12-28", to: "2027-01-05" });
    // 2027's holidays are not in this year's set, so only its weekend is left out: 3 days there.
    expect(panel.getByText(/3 days are in 2027/)).toBeInTheDocument();
    expect(line("Holiday leave balance")).toHaveTextContent("26 d → 22 d");
  });
});

describe("the fields", () => {
  it("offers the kinds of the list it is handed, and not the one nobody books any more", () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" });
    const options = within(panel.getByLabelText("Type")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Holiday leave",
      "Hours bank",
      "Time in lieu",
      "Something else",
    ]);
    expect(panel.getByLabelText("Type")).toHaveValue("vacation");
  });

  it("opens from the button with both dates on the same day and the sentence about what is counted", () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" });
    expect(panel.getByLabelText("From")).toHaveValue("2026-06-15");
    expect(panel.getByLabelText("To")).toHaveValue("2026-06-15");
    expect(panel.getByText("Weekends and public holidays are not counted.")).toBeInTheDocument();
  });

  it("moves the last day along when the first day is put after it, and tells the calendar", async () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" });
    await userEvent.clear(panel.getByLabelText("From"));
    await userEvent.type(panel.getByLabelText("From"), "2026-06-18");
    expect(panel.getByLabelText("To")).toHaveValue("2026-06-18");
    expect(onRangeChange).toHaveBeenLastCalledWith({ from: "2026-06-18", to: "2026-06-18" });
  });

  it("keeps one day one day: the last day follows the first until the two are told apart", async () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" });
    await userEvent.clear(panel.getByLabelText("From"));
    await userEvent.type(panel.getByLabelText("From"), "2026-03-10");
    expect(panel.getByLabelText("To")).toHaveValue("2026-03-10");

    await userEvent.clear(panel.getByLabelText("To"));
    await userEvent.type(panel.getByLabelText("To"), "2026-03-13");
    await userEvent.clear(panel.getByLabelText("From"));
    await userEvent.type(panel.getByLabelText("From"), "2026-03-09");
    expect(panel.getByLabelText("To")).toHaveValue("2026-03-13");
  });

  it("will not confirm a range with no day anybody works, and says why a single day is refused", async () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-13", to: "2026-06-14" });
    expect(line("Duration")).toHaveTextContent("0 d");
    expect(panel.getByText("No day in this range can be booked.")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Confirm" })).toBeDisabled();

    await userEvent.clear(panel.getByLabelText("To"));
    await userEvent.type(panel.getByLabelText("To"), "2026-06-13");
    expect(panel.getByText("13 Jun 2026 is a weekend.")).toBeInTheDocument();
  });

  it("refuses a range longer than anybody books in one go, under the field, before any call", async () => {
    const panel = renderPanel({ mode: "add", from: "2026-01-01" });
    await userEvent.clear(panel.getByLabelText("To"));
    await userEvent.type(panel.getByLabelText("To"), "2026-12-31");
    expect(panel.getByText("That range is too long to add in one go.")).toBeInTheDocument();
    expect(panel.getByLabelText("To")).toHaveAttribute("aria-invalid", "true");
    expect(panel.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("says where the note goes, by what the list says about the kind", async () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" });
    expect(panel.getByText(/never goes to Trek/)).toBeInTheDocument();
    await userEvent.selectOptions(panel.getByLabelText("Type"), "other");
    expect(panel.getByText(/Stays here/)).toBeInTheDocument();
  });

  it("locks itself while saving, and shows what the server refused above the buttons", () => {
    const panel = renderPanel({ mode: "add", from: "2026-06-15" }, [], {
      saving: true,
      error: "That day is no longer there.",
    });
    expect(panel.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(panel.getByLabelText("From")).toBeDisabled();
    expect(panel.getByLabelText("Type")).toBeDisabled();
    expect(panel.getByRole("alert")).toHaveTextContent("That day is no longer there.");
  });
});

describe("a booked day", () => {
  it("opens on its row, with the date read-only and Remove beside Confirm", async () => {
    const booked = row("2026-06-17", "vacation", 0.5, { note: "afternoon" });
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: [booked] }, [booked]);
    expect(panel.getByRole("heading", { name: "Edit leave" })).toBeInTheDocument();
    expect(panel.getByText("Wednesday 17 June 2026")).toBeInTheDocument();
    expect(panel.queryByLabelText("From")).not.toBeInTheDocument();
    expect(panel.getByLabelText("Type")).toHaveValue("vacation");
    expect(panel.getByRole("button", { name: "Half day" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByLabelText("Note")).toHaveValue("afternoon");

    await userEvent.click(panel.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(booked);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the balance before and after a change, and names the row it edits on Confirm", async () => {
    const booked = row("2026-06-17", "vacation");
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: [booked] }, [booked]);
    expect(line("Holiday leave balance")).toHaveTextContent("25 d → 25 d");

    await userEvent.selectOptions(panel.getByLabelText("Type"), "rol");
    expect(line("Holiday leave balance")).toHaveTextContent("25 d → 26 d");
    expect(line("Hours bank balance")).toHaveTextContent("4 d → 3 d");
    // The row's own change of kind is the edit, not something the edit replaces.
    expect(within(summary()).queryByText("Replaces")).not.toBeInTheDocument();

    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      from: "2026-06-17",
      to: "2026-06-17",
      kind: "rol",
      fraction: "1",
      note: "",
      editedKind: "vacation",
    });
  });

  it("asks which leave when the day carries two, and follows the answer", async () => {
    const halves = [
      row("2026-06-17", "vacation", 0.5, { note: "am" }),
      row("2026-06-17", "rol", 0.5, { note: "pm" }),
    ];
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: halves }, halves);
    const which = panel.getByRole("group", { name: "Which leave" });
    expect(within(which).getByRole("button", { name: "Holiday leave ½" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(panel.getByLabelText("Note")).toHaveValue("am");

    await userEvent.click(within(which).getByRole("button", { name: "Hours bank ½" }));
    expect(panel.getByLabelText("Type")).toHaveValue("rol");
    expect(panel.getByLabelText("Note")).toHaveValue("pm");
    await userEvent.click(panel.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(halves[1]);
  });

  it("opens on the row the table asked for", () => {
    const halves = [row("2026-06-17", "vacation", 0.5), row("2026-06-17", "rol", 0.5)];
    const panel = renderPanel(
      { mode: "edit", date: "2026-06-17", rows: halves, active: halves[1].id },
      halves,
    );
    expect(panel.getByLabelText("Type")).toHaveValue("rol");
  });

  it("adds the other half as a new leave of the kind the rules propose", async () => {
    const half = row("2026-06-17", "vacation", 0.5);
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: [half] }, [half]);
    await userEvent.click(panel.getByRole("button", { name: "Add the other half" }));

    expect(panel.getByRole("heading", { name: "New leave" })).toBeInTheDocument();
    expect(panel.getByLabelText("Type")).toHaveValue("rol");
    expect(panel.getByRole("button", { name: "Half day" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    // Half beside half: the day keeps both, so nothing is replaced.
    expect(within(summary()).queryByText("Replaces")).not.toBeInTheDocument();

    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      from: "2026-06-17",
      to: "2026-06-17",
      kind: "rol",
      fraction: "0.5",
      note: "",
      editedKind: null,
    });
  });

  it("splits a whole day into half of each kind in one step (decision of 17/11/2026)", async () => {
    const whole = row("2026-11-17", "vacation");
    const panel = renderPanel({ mode: "edit", date: "2026-11-17", rows: [whole] }, [whole]);
    await userEvent.click(panel.getByRole("button", { name: "Half + half" }));
    expect(panel.getByLabelText("Other half")).toHaveValue("rol");
    expect(line("Duration")).toHaveTextContent("1 d (1 day: Holiday leave ½ + Hours bank ½)");
    expect(line("Holiday leave balance")).toHaveTextContent("25 d → 25.5 d");
    expect(line("Hours bank balance")).toHaveTextContent("4 d → 3.5 d");
    expect(within(summary()).queryByText("Replaces")).not.toBeInTheDocument();

    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      from: "2026-11-17",
      to: "2026-11-17",
      kind: "vacation",
      fraction: "0.5",
      note: "",
      editedKind: "vacation",
      otherKind: "rol",
    });
  });

  it("never offers the first half's kind for the second, and moves it on when the first takes it", async () => {
    const panel = renderPanel({ mode: "range", from: "2026-06-15", to: "2026-06-16" });
    await userEvent.click(panel.getByRole("button", { name: "Half + half" }));
    const other = panel.getByLabelText("Other half");
    expect(within(other).queryByRole("option", { name: "Holiday leave" })).not.toBeInTheDocument();
    await userEvent.selectOptions(panel.getByLabelText("Type"), "rol");
    expect(other).toHaveValue("vacation");
    expect(line("Duration")).toHaveTextContent("2 d (2 days: Hours bank ½ + Holiday leave ½)");

    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "rol", fraction: "0.5", otherKind: "vacation" }),
    );
  });

  it("does not offer the other half of a whole day, nor of a day that already has two", () => {
    const whole = row("2026-06-17", "vacation");
    renderPanel({ mode: "edit", date: "2026-06-17", rows: [whole] }, [whole]);
    expect(screen.queryByRole("button", { name: "Add the other half" })).not.toBeInTheDocument();
  });

  it("keeps the kind of a row that carries one nobody books any more", () => {
    const sick = row("2026-06-17", "sick");
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: [sick] }, [sick]);
    expect(panel.getByLabelText("Type")).toHaveValue("sick");
    expect(within(panel.getByLabelText("Type")).getByRole("option", { name: "Illness" })).toBeInTheDocument();
  });

  it("says where the row came from and what Trek is still owed", () => {
    const fromTrek = row("2026-06-17", "vacation", 1, { origin: "trek", pending: "delete" });
    const panel = renderPanel({ mode: "edit", date: "2026-06-17", rows: [fromTrek] }, [fromTrek]);
    expect(panel.getByText("From Trek")).toBeInTheDocument();
    expect(panel.getByText(messages.timeoff.table.pending.delete)).toBeInTheDocument();
  });
});
