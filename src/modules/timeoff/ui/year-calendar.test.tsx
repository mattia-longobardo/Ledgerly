import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";

const refresh = vi.fn();
const cycle = vi.fn();
const clear = vi.fn();
const halve = vi.fn();
const split = vi.fn();

// The calendar acts on a click, so it needs a router and its two Server Actions; neither belongs
// in a test of what it draws.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../day-actions", () => ({
  cycleDayAction: (...args: unknown[]) => cycle(...args),
  clearDayAction: (...args: unknown[]) => clear(...args),
  halveDayAction: (...args: unknown[]) => halve(...args),
  splitDayAction: (...args: unknown[]) => split(...args),
}));
import { italianHolidays } from "@/platform/holidays/rules";
import { calendar, type LeaveDayView } from "../rules";
import type { LeaveSummary } from "./leave-actions";
import { weekdayInitials } from "./kinds";
import { YearCalendar } from "./year-calendar";

const MINUTES_PER_DAY = 420;
const TODAY = "2026-06-15";
const MILAN = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((h) => h.date));

function vacation(on: string, fraction = 1): LeaveDayView {
  return { on, kind: "vacation", fraction };
}

function renderYear(days: LeaveDayView[], weekStart = 1, booked: Record<string, LeaveSummary[]> = {}) {
  const months = calendar(2026, days, MILAN, weekStart, TODAY, MINUTES_PER_DAY);
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <YearCalendar
        months={months}
        monthNames={MONTHS}
        weekdays={weekdayInitials(weekStart, "en")}
        totals={Array.from({ length: 12 }, () => "")}
        booked={booked}
        today={TODAY}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

describe("weekdayInitials", () => {
  it("starts on the day the preferences name", () => {
    expect(weekdayInitials(1, "en")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(weekdayInitials(0, "en")).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });
});

describe("YearCalendar", () => {
  it("draws the twelve months", () => {
    renderYear([]);
    for (const month of MONTHS) expect(screen.getByText(month)).toBeInTheDocument();
  });

  it("marks only the days with leave on them, and names each one", () => {
    renderYear([vacation("2026-06-16")]);
    const cells = screen.getAllByTestId("leave-cell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("data-date", "2026-06-16");
    expect(cells[0]).toHaveAccessibleName("16 Jun 2026: Vacation");
  });

  it("marks a half day as partial and a whole one as not", () => {
    renderYear([vacation("2026-06-16", 0.5), vacation("2026-06-17", 1)]);
    const byDate = Object.fromEntries(
      screen.getAllByTestId("leave-cell").map((cell) => [cell.getAttribute("data-date"), cell]),
    );
    expect(byDate["2026-06-16"]).toHaveAttribute("data-partial", "true");
    expect(byDate["2026-06-17"]).not.toHaveAttribute("data-partial");
  });

  it("says which days a payslip has counted and which are still only planned (N8)", () => {
    // Drawn differently — hollow against filled — because "already gone" and "still mine to move"
    // are not the same fact, and the old rendering said both the same way.
    renderYear([vacation("2026-06-16"), vacation("2026-08-18")]);
    const byDate = Object.fromEntries(
      screen.getAllByTestId("leave-cell").map((cell) => [cell.getAttribute("data-date"), cell]),
    );
    expect(byDate["2026-06-16"]).toHaveAttribute("data-status", "taken");
    expect(byDate["2026-08-18"]).toHaveAttribute("data-status", "planned");
  });

  it("draws the second kind of a planned day, which has no fill to cut into (N10)", () => {
    // Half vacation and half ROL, still to come: with only the first kind drawn it looked exactly
    // like a day of plain vacation, which is a whole gesture rendered invisible.
    renderYear([
      { on: "2026-08-18", kind: "vacation", fraction: 0.5 },
      { on: "2026-08-18", kind: "rol", fraction: 0.5 },
    ]);
    const cell = screen.getByTestId("leave-cell");
    expect(cell).toHaveAccessibleName("18 Aug 2026: Vacation, ROL");
    // The first kind is the outline itself, so the second gets the one drawn mark — and there is
    // no half-day wedge, because two halves are a whole day off.
    expect(cell.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
    expect(cell).not.toHaveAttribute("data-partial");
  });

  it("makes a free working day a button that offers to book it (M1)", () => {
    renderYear([]);
    expect(screen.queryAllByTestId("leave-cell")).toHaveLength(0);
    // 16 June 2026 is a Tuesday: something can happen to it, so it is a button.
    const free = screen.getByRole("button", { name: "Book 16 Jun 2026" });
    expect(free).toHaveAttribute("data-date", "2026-06-16");
  });

  it("leaves a weekend and a holiday out of the tab order, because they cannot be booked", () => {
    renderYear([]);
    // 13 June 2026 is a Saturday; 2 June is Republic Day, a Tuesday.
    expect(screen.queryByRole("button", { name: "Book 13 Jun 2026" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book 2 Jun 2026" })).not.toBeInTheDocument();
    // They are still drawn, just not as something to press.
    expect(document.querySelector('[data-date="2026-06-13"]')?.tagName).toBe("SPAN");
  });

  it("offers one tab stop per month, not one per day", () => {
    renderYear([]);
    const tabbable = document.querySelectorAll('button[data-date][tabindex="0"]');
    expect(tabbable).toHaveLength(12);
  });

  it("books a day with one click, without a dialog in the way (N3)", async () => {
    cycle.mockResolvedValueOnce({ ok: true });
    renderYear([]);
    await userEvent.click(screen.getByRole("button", { name: "Book 16 Jun 2026" }));
    expect(cycle).toHaveBeenCalledWith("2026-06-16");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears a booked day on the right button", async () => {
    clear.mockResolvedValueOnce({ ok: true, removed: 1, pending: 0 });
    renderYear([vacation("2026-06-16")], 1, {
      "2026-06-16": [
        { id: "a", on: "2026-06-16", kind: "vacation", fraction: 1, note: null, origin: "manual" },
      ],
    });

    fireEvent.contextMenu(screen.getByTestId("leave-cell"));
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith("2026-06-16"));
  });

  it("asks the server even for a day it believes is empty, and does not go quiet", async () => {
    // The regression this guards: the handler used to check its own `booked` prop first, which is
    // whatever the last server render said. A day booked a moment earlier looked empty, the right
    // button did nothing at all, and only some later action made it go.
    clear.mockResolvedValueOnce({ ok: true, removed: 0 });
    renderYear([]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Book 17 Jun 2026" }));
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith("2026-06-17"));
  });

  it("opens the dialog for a day the cycle cannot speak for", async () => {
    // Sickness, a recovery day, two halves: a shortcut must not overwrite what was stated.
    cycle.mockResolvedValueOnce({ ok: false, error: "not_cyclable" });
    renderYear([vacation("2026-06-16")], 1, {
      "2026-06-16": [{ id: "a", on: "2026-06-16", kind: "sick", fraction: 1, note: null, origin: "manual" }],
    });
    await userEvent.click(screen.getByTestId("leave-cell"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the dialog on a held click, which is the way to half a day", async () => {
    renderYear([]);
    fireEvent.click(screen.getByRole("button", { name: "Book 16 Jun 2026" }), { altKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(cycle).not.toHaveBeenCalled();
  });

  it("makes a booked day half a day when it is held down (N3)", async () => {
    halve.mockResolvedValueOnce({ ok: true });
    renderYear([vacation("2026-06-16")], 1, {
      "2026-06-16": [
        { id: "a", on: "2026-06-16", kind: "vacation", fraction: 1, note: null, origin: "manual" },
      ],
    });
    const cell = screen.getByTestId("leave-cell");

    fireEvent.pointerDown(cell, { button: 0 });
    await vi.waitFor(() => expect(halve).toHaveBeenCalledWith("2026-06-16"), { timeout: 2000 });

    // Letting go must not then walk the day on to the next kind: the click is the hold's.
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);
    expect(cycle).not.toHaveBeenCalled();
  });

  it("splits a day into half vacation and half ROL when the right button is held (N10)", async () => {
    split.mockResolvedValueOnce({ ok: true });
    renderYear([]);
    const cell = screen.getByRole("button", { name: "Book 16 Jun 2026" });

    fireEvent.pointerDown(cell, { button: 2 });
    await vi.waitFor(() => expect(split).toHaveBeenCalledWith("2026-06-16"), { timeout: 2000 });

    // Letting go must not then clear the day: the release belongs to the hold.
    fireEvent.pointerUp(cell, { button: 2 });
    expect(clear).not.toHaveBeenCalled();
  });

  it("still clears on a right button let go quickly, and only once (N10)", async () => {
    clear.mockResolvedValueOnce({ ok: true, removed: 1, pending: 0 });
    renderYear([vacation("2026-06-16")], 1, {
      "2026-06-16": [
        { id: "a", on: "2026-06-16", kind: "vacation", fraction: 1, note: null, origin: "manual" },
      ],
    });
    const cell = screen.getByTestId("leave-cell");

    // The order a browser uses under X11: the menu event on the way down, the decision on the
    // way up. Under Windows they arrive the other way about, and neither may act twice.
    fireEvent.pointerDown(cell, { button: 2 });
    fireEvent.contextMenu(cell);
    fireEvent.pointerUp(cell, { button: 2 });
    fireEvent.contextMenu(cell);
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith("2026-06-16"));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(split).not.toHaveBeenCalled();
  });

  it("is an ordinary click when the press is let go quickly", async () => {
    cycle.mockResolvedValueOnce({ ok: true });
    renderYear([vacation("2026-06-16")], 1, {
      "2026-06-16": [
        { id: "a", on: "2026-06-16", kind: "vacation", fraction: 1, note: null, origin: "manual" },
      ],
    });
    const cell = screen.getByTestId("leave-cell");

    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);
    await vi.waitFor(() => expect(cycle).toHaveBeenCalledWith("2026-06-16"));
    expect(halve).not.toHaveBeenCalled();
  });

  it("does not start a hold on a day with nothing to halve", () => {
    renderYear([]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Book 16 Jun 2026" }), { button: 0 });
    expect(halve).not.toHaveBeenCalled();
  });

  it("puts every day of a month in exactly one cell", () => {
    renderYear([]);
    // February 2026 has 28 days, so exactly one cell says "28" in it and none says "29".
    expect(screen.queryAllByText("29").length).toBe(11);
  });
});
