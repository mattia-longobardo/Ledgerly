import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { italianHolidays } from "@/platform/holidays/rules";
import { Toaster } from "@/ui/toast";
import type { LeaveDayKind } from "../rules";
import { leaveTypeOptions } from "./kinds";
import { AddLeave, RowActions } from "./leave-actions";
import { BoardCalendar, LeaveBoard } from "./leave-board";
import type { BookedLeave } from "./leave-panel";

const { refresh, save, remove, undo } = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  undo: vi.fn(),
}));

// The board writes through three Server Actions and nothing else: counting their calls is counting
// the writes.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../actions", () => ({
  saveLeaveRangeAction: (...args: unknown[]) => save(...args),
  removeLeaveAction: (...args: unknown[]) => remove(...args),
  undoLeaveAction: (...args: unknown[]) => undo(...args),
}));

const TODAY = "2026-06-15";
const MONTHS = Array.from({ length: 12 }, (_, index) => `Month ${index + 1}`);
const HOLIDAYS = italianHolidays(2026, { month: 12, day: 7 }).map((one) => one.date);
const UNDO = { dates: ["2026-06-16"], rows: [] };

function booked(on: string, kind: LeaveDayKind = "vacation", fraction = 1): BookedLeave {
  return { id: `${on}-${kind}`, on, kind, fraction, note: null, origin: "manual", pending: "none" };
}

function renderBoard(days: BookedLeave[] = []) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <LeaveBoard
        year={2026}
        today={TODAY}
        minutesPerDay={420}
        weekStart={1}
        countedThrough={null}
        days={days}
        holidays={HOLIDAYS}
        residuals={{}}
        types={leaveTypeOptions((kind) => messages.timeoff.kinds[kind])}
      >
        <AddLeave label="Add leave" />
        <BoardCalendar
          monthNames={MONTHS}
          weekdays={["M", "T", "W", "T", "F", "S", "S"]}
          totals={MONTHS.map(() => "")}
          openOnMonth={null}
        />
        {days.map((day) => (
          <RowActions key={day.id} id={day.id} on={day.on} />
        ))}
      </LeaveBoard>
      <Toaster closeLabel="Close" />
    </NextIntlClientProvider>,
  );
}

const cell = (date: string) => document.querySelector(`[data-date="${date}"]`) as HTMLElement;
const writes = () => save.mock.calls.length + remove.mock.calls.length + undo.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ ok: true, undo: UNDO, days: 5, removed: 0, pending: 0 });
  remove.mockResolvedValue({ ok: true, undo: UNDO, days: 0, removed: 1, pending: 0 });
  undo.mockResolvedValue({ ok: true });
});

describe("nothing is written before Confirm (rewrite plan N5, criterion 3)", () => {
  it("picks a week, opens the panel, changes its fields and closes it without one call", async () => {
    renderBoard();
    await userEvent.click(cell("2026-06-15"));
    await userEvent.click(cell("2026-06-19"));

    const panel = within(await screen.findByRole("dialog", { name: "New leave" }));
    expect(panel.getByLabelText("From")).toHaveValue("2026-06-15");
    expect(panel.getByLabelText("To")).toHaveValue("2026-06-19");
    // The range stays drawn behind the panel.
    expect(cell("2026-06-17")).toHaveAttribute("data-selected", "inside");

    await userEvent.selectOptions(panel.getByLabelText("Type"), "rol");
    await userEvent.click(panel.getByRole("button", { name: "Half day" }));
    await userEvent.click(panel.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cell("2026-06-17")).not.toHaveAttribute("data-selected");
    expect(writes()).toBe(0);
  });

  it("writes a week with one call on Confirm, and says so with an Undo", async () => {
    renderBoard();
    await userEvent.click(cell("2026-06-15"));
    await userEvent.click(cell("2026-06-19"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));

    expect(save).toHaveBeenCalledExactlyOnceWith({
      from: "2026-06-15",
      to: "2026-06-19",
      kind: "vacation",
      fraction: "1",
      note: "",
      editedKind: null,
    });
    expect(await screen.findByText("Leave saved · 5 d")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New leave" })).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(writes()).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledExactlyOnceWith(UNDO);
    expect(await screen.findByText("Undone")).toBeInTheDocument();
  });

  it("keeps the panel open, with its values, when the server refuses", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      error: "not_bookable",
      refused: [{ on: "2026-06-16", reason: "holiday" }],
    });
    renderBoard();
    await userEvent.click(screen.getAllByRole("button", { name: "Add leave" })[0]);
    const panel = within(await screen.findByRole("dialog"));
    expect(panel.getByLabelText("From")).toHaveValue(TODAY);
    await userEvent.type(panel.getByLabelText("Note"), "keep me");
    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));

    expect(await panel.findByRole("alert")).toHaveTextContent("16 Jun 2026 is a public holiday.");
    expect(panel.getByLabelText("Note")).toHaveValue("keep me");
    expect(screen.queryByText(/Leave saved/)).not.toBeInTheDocument();
  });

  it("says it did not work when the call itself fails", async () => {
    save.mockRejectedValueOnce(new Error("offline"));
    renderBoard();
    await userEvent.click(screen.getAllByRole("button", { name: "Add leave" })[0]);
    const panel = within(await screen.findByRole("dialog"));
    await userEvent.click(panel.getByRole("button", { name: "Confirm" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("It did not work. Try again.");
  });
});

describe("a booked day", () => {
  it("opens in the panel from the calendar and from its row, the same panel", async () => {
    const day = booked("2026-06-16");
    renderBoard([day]);
    await userEvent.click(cell("2026-06-16"));
    expect(await screen.findByRole("dialog", { name: "Edit leave" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Edit leave" })).toBeInTheDocument();
    expect(writes()).toBe(0);
  });

  it("is removed from the panel at once, with no question, and an Undo in the toast", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderBoard([booked("2026-06-16")]);
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));

    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: "2026-06-16-vacation" });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Edit leave" })).not.toBeInTheDocument();
    expect(await screen.findByText("Leave removed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("is removed from its row and by Delete on the calendar, the same way", async () => {
    const confirm = vi.spyOn(window, "confirm");
    remove.mockResolvedValueOnce({ ok: true, undo: UNDO, days: 0, removed: 1, pending: 1 });
    remove.mockResolvedValueOnce({ ok: true, undo: UNDO, days: 0, removed: 2, pending: 0 });
    renderBoard([booked("2026-06-16", "vacation", 0.5), booked("2026-06-16", "rol", 0.5)]);

    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(remove).toHaveBeenLastCalledWith({ id: "2026-06-16-vacation" });
    // A day Trek holds is not gone until Trek agrees, and the toast does not say it is.
    expect(await screen.findByText("Removed here; Trek will be told at the next pass")).toBeInTheDocument();

    act(() => cell("2026-06-16").focus());
    await userEvent.keyboard("{Delete}");
    expect(remove).toHaveBeenLastCalledWith({ date: "2026-06-16" });
    expect(await screen.findByText("2 leaves removed")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("says why a removal was refused, in a toast, and reads the page again", async () => {
    remove.mockResolvedValueOnce({ ok: false, error: "not_found" });
    renderBoard([booked("2026-06-16")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That day is no longer there.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("says so when the undo itself fails", async () => {
    undo.mockResolvedValueOnce({ ok: false, error: "not_bookable" });
    renderBoard([booked("2026-06-16")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The undo did not work. Try again from the table.",
    );
  });
});

describe("Add leave", () => {
  it("opens the panel on today, for one day, with no range drawn", async () => {
    renderBoard();
    await userEvent.click(screen.getAllByRole("button", { name: "Add leave" })[0]);
    const panel = within(await screen.findByRole("dialog", { name: "New leave" }));
    expect(panel.getByLabelText("From")).toHaveValue(TODAY);
    expect(panel.getByLabelText("To")).toHaveValue(TODAY);
    expect(cell(TODAY)).not.toHaveAttribute("data-selected");

    // The fields are the calendar's range from then on.
    await userEvent.clear(panel.getByLabelText("To"));
    await userEvent.type(panel.getByLabelText("To"), "2026-06-17");
    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "inside");
  });
});
