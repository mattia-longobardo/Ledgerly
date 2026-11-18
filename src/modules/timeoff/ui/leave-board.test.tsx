import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { italianHolidays } from "@domain/platform/holidays/rules";
import { Toaster } from "@/ui/toast";
import type { LeaveDayKind } from "@domain/modules/timeoff/rules";
import { leaveTypeOptions } from "./kinds";
import { AddLeave, RowActions } from "./leave-actions";
import { BoardCalendar, LeaveBoard } from "./leave-board";
import type { BookedLeave } from "./leave-panel";

const { refresh, save, remove, removeRange, undo } = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  removeRange: vi.fn(),
  undo: vi.fn(),
}));

// The board writes through three Server Actions and nothing else: counting their calls is counting
// the writes.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../actions", () => ({
  saveLeaveRangeAction: (...args: unknown[]) => save(...args),
  removeLeaveAction: (...args: unknown[]) => remove(...args),
  removeLeaveRangeAction: (...args: unknown[]) => removeRange(...args),
  undoLeaveAction: (...args: unknown[]) => undo(...args),
}));

const TODAY = "2026-06-15";
const MONTHS = Array.from({ length: 12 }, (_, index) => `Month ${index + 1}`);
const HOLIDAYS = italianHolidays(2026, { month: 12, day: 7 }).map((one) => one.date);
const UNDO = { dates: ["2026-06-16"], rows: [] };

function booked(on: string, kind: LeaveDayKind = "vacation", fraction = 1): BookedLeave {
  return { id: `${on}-${kind}`, on, kind, fraction, note: null, origin: "manual", pending: "none" };
}

function board(days: BookedLeave[]) {
  return (
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
    </NextIntlClientProvider>
  );
}

function renderBoard(days: BookedLeave[] = []) {
  return render(board(days));
}

/** The panel, under either name: the toast is a dialog too. */
const PANEL = /^(New|Edit) leave$/;
const cell = (date: string) => document.querySelector(`[data-date="${date}"]`) as HTMLElement;
const writes = () =>
  save.mock.calls.length + remove.mock.calls.length + removeRange.mock.calls.length + undo.mock.calls.length;

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
    expect(screen.queryByRole("dialog", { name: "Remove leave" })).not.toBeInTheDocument();

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

  it("opens its own panel when it is tapped right after Confirm, before the page is read again", async () => {
    const { rerender } = renderBoard();
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Leave saved · 5 d");
    expect(screen.queryByRole("dialog", { name: PANEL })).not.toBeInTheDocument();

    // The write is done and the page is not read again yet: the day stays booked on the calendar,
    // and a tap on it starts no new range.
    await userEvent.click(cell("2026-06-16"));
    expect(cell("2026-06-16")).not.toHaveAttribute("data-selected");
    expect(screen.queryByRole("dialog", { name: PANEL })).not.toBeInTheDocument();

    // The server's rows arrive: the tap opens the panel of the booked day.
    rerender(board([booked("2026-06-16")]));
    const panel = within(await screen.findByRole("dialog", { name: "Edit leave" }));
    expect(panel.getByLabelText("Type")).toHaveValue("vacation");
    expect(save).toHaveBeenCalledOnce();
  });

  it("is not in the panel when the day is tapped again before the page is read again", async () => {
    // The removal stays on its way: the page has not been read again yet.
    remove.mockReturnValueOnce(new Promise(() => {}));
    renderBoard([booked("2026-06-16", "vacation", 0.5), booked("2026-06-16", "rol", 0.5)]);
    await userEvent.click(cell("2026-06-16"));
    const first = within(await screen.findByRole("dialog", { name: "Edit leave" }));
    expect(first.getByLabelText("Type")).toHaveValue("vacation");
    await userEvent.click(first.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: "2026-06-16-vacation" });

    await userEvent.click(cell("2026-06-16"));
    const panel = within(await screen.findByRole("dialog", { name: "Edit leave" }));
    expect(panel.queryByRole("group", { name: "Which leave" })).not.toBeInTheDocument();
    expect(panel.getByLabelText("Type")).toHaveValue("rol");
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

describe("a row Trek still has to let go of (pending = 'delete')", () => {
  const trekDay = (on: string, kind: LeaveDayKind, fraction: number, pending: BookedLeave["pending"]) => ({
    ...booked(on, kind, fraction),
    origin: "trek" as const,
    pending,
  });

  it("leaves the calendar at once: the page read after the removal does not bring it back", async () => {
    remove.mockResolvedValueOnce({ ok: true, undo: UNDO, days: 0, removed: 1, pending: 1 });
    const { rerender } = renderBoard([trekDay("2026-06-16", "vacation", 1, "none")]);
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Removed here; Trek will be told at the next pass")).toBeInTheDocument();

    // What router.refresh() hands back: the row is still stored, waiting for the Trek pass.
    rerender(board([trekDay("2026-06-16", "vacation", 1, "delete")]));
    expect(cell("2026-06-16")).toHaveAttribute("data-testid", "free-cell");
  });

  it("is not one of the day's rows: the half left offers the other half", async () => {
    renderBoard([
      trekDay("2026-06-16", "vacation", 1, "delete"),
      trekDay("2026-06-16", "rol", 0.5, "upsert"),
    ]);
    await userEvent.click(cell("2026-06-16"));
    const panel = within(await screen.findByRole("dialog", { name: "Edit leave" }));
    expect(panel.queryByRole("group", { name: "Which leave" })).not.toBeInTheDocument();
    expect(panel.getByLabelText("Type")).toHaveValue("rol");
    await userEvent.click(panel.getByRole("button", { name: "Add the other half" }));
    const other = within(await screen.findByRole("dialog", { name: "New leave" }));
    expect(other.getByLabelText("Type")).toHaveValue("vacation");
    expect(other.getByTestId("summary")).not.toHaveTextContent("Replaces");
  });
});

describe("several booked days removed together (decision of 17/11/2026, N5 §7.5)", () => {
  const WEEK = ["2026-06-15", "2026-06-16", "2026-06-17"];
  const RANGE_UNDO = {
    dates: WEEK,
    rows: WEEK.map((on) => ({ on, kind: "vacation", fraction: 1, note: null })),
  };

  it("starts a range on a booked day, lists the days, and removes them with one call and one Undo", async () => {
    let answer: (value: unknown) => void = () => {};
    removeRange.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderBoard(WEEK.map((on) => booked(on)));

    // A booked day still opens its own panel (Q3); the visible control starts a range from it.
    await userEvent.click(cell("2026-06-15"));
    const edit = within(await screen.findByRole("dialog", { name: "Edit leave" }));
    await userEvent.click(edit.getByRole("button", { name: "Select more days from here" }));
    expect(await screen.findByTestId("selection-bar")).toHaveTextContent("pick the last day");
    expect(writes()).toBe(0);

    await userEvent.click(cell("2026-06-17"));
    const panel = within(await screen.findByRole("dialog", { name: "New leave" }));
    expect(panel.getByLabelText("From")).toHaveValue("2026-06-15");
    expect(panel.getByLabelText("To")).toHaveValue("2026-06-17");
    await userEvent.click(panel.getByRole("button", { name: "Remove 3 days" }));

    // The days are listed before anything goes.
    const confirmStep = within(await screen.findByRole("dialog", { name: "Remove leave" }));
    expect(confirmStep.getAllByRole("listitem")).toHaveLength(3);
    expect(confirmStep.getByText("These 3 days lose all their leave:")).toBeInTheDocument();
    expect(writes()).toBe(0);
    await userEvent.click(confirmStep.getByRole("button", { name: "Remove 3 days" }));

    expect(removeRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-15", to: "2026-06-17" });
    expect(screen.queryByRole("dialog", { name: "Remove leave" })).not.toBeInTheDocument();
    // At once, before the server has answered.
    for (const on of WEEK) expect(cell(on)).toHaveAttribute("data-testid", "free-cell");
    await act(async () => answer({ ok: true, undo: RANGE_UNDO, days: 3, removed: 3, pending: 3 }));
    expect(
      await screen.findByText("3 days removed here; Trek will be told at the next pass"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledExactlyOnceWith(RANGE_UNDO);
    expect(writes()).toBe(2);
  });

  it("goes back from the list without a call, and is not offered on a range with nothing booked", async () => {
    renderBoard([booked("2026-06-16")]);
    await userEvent.click(cell("2026-06-15"));
    await userEvent.click(cell("2026-06-16"));
    const panel = within(await screen.findByRole("dialog", { name: "New leave" }));
    await userEvent.click(panel.getByRole("button", { name: "Remove 1 day" }));
    const confirmStep = within(await screen.findByRole("dialog", { name: "Remove leave" }));
    await userEvent.click(confirmStep.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "New leave" })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("To"));
    await userEvent.type(screen.getByLabelText("To"), "2026-06-15");
    expect(screen.queryByRole("button", { name: /^Remove \d/ })).not.toBeInTheDocument();
    expect(writes()).toBe(0);
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
