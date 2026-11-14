import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { italianHolidays } from "@/platform/holidays/rules";
import { calendar, type LeaveDayView } from "../rules";
import { weekdayInitials } from "./kinds";
import { YearCalendar, type YearCalendarProps } from "./year-calendar";

const onRange = vi.fn();
const onEdit = vi.fn();
const onRemove = vi.fn();

const MINUTES_PER_DAY = 420;
const TODAY = "2026-06-15";
const MILAN = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((h) => h.date));

function vacation(on: string, fraction = 1): LeaveDayView {
  return { on, kind: "vacation", fraction };
}

function renderYear(days: LeaveDayView[], weekStart = 1, props: Partial<YearCalendarProps> = {}) {
  const months = calendar(2026, days, MILAN, weekStart, TODAY, MINUTES_PER_DAY);
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <YearCalendar
        months={months}
        monthNames={MONTHS}
        weekdays={weekdayInitials(weekStart, "en")}
        totals={Array.from({ length: 12 }, () => "")}
        today={TODAY}
        onRange={onRange}
        onEdit={onEdit}
        onRemove={onRemove}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const cell = (date: string) => document.querySelector(`[data-date="${date}"]`) as HTMLElement;

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

  it("makes a free working day a button, and says it is free (M1)", () => {
    renderYear([]);
    expect(screen.queryAllByTestId("leave-cell")).toHaveLength(0);
    // 16 June 2026 is a Tuesday: something can happen to it, so it is a button.
    const free = screen.getByRole("button", { name: "16 Jun 2026: free" });
    expect(free).toHaveAttribute("data-date", "2026-06-16");
  });

  it("leaves a weekend and a holiday out of the tab order, because they cannot be booked", () => {
    renderYear([]);
    // 13 June 2026 is a Saturday; 2 June is Republic Day, a Tuesday.
    expect(screen.queryByRole("button", { name: "13 Jun 2026: free" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2 Jun 2026: free" })).not.toBeInTheDocument();
    // They are still drawn, just not as something to press.
    expect(document.querySelector('[data-date="2026-06-13"]')?.tagName).toBe("SPAN");
  });

  it("offers one tab stop per month, not one per day", () => {
    renderYear([]);
    const tabbable = document.querySelectorAll('button[data-date][tabindex="0"]');
    expect(tabbable).toHaveLength(12);
  });

  it("puts every day of a month in exactly one cell", () => {
    renderYear([]);
    // February 2026 has 28 days, so exactly one cell says "28" in it and none says "29".
    expect(screen.queryAllByText("29").length).toBe(11);
  });
});

describe("picking the first and the last day (rewrite plan N5)", () => {
  it("makes the first click the first day, and writes nothing", async () => {
    renderYear([]);
    await userEvent.click(cell("2026-06-16"));

    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "edge");
    expect(cell("2026-06-16")).toHaveAccessibleName("16 Jun 2026: first day");
    expect(screen.getByRole("status")).toHaveTextContent("From 16 Jun · pick the last day");
    expect(onRange).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("hands the range over on the second click, whichever end came first", async () => {
    renderYear([]);
    await userEvent.click(cell("2026-06-19"));
    await userEvent.click(cell("2026-06-15"));

    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-15", to: "2026-06-19" });
    // The range is the panel's now: the bar goes, and the calendar draws what it is handed.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(cell("2026-06-19")).not.toHaveAttribute("data-selected");
  });

  it("previews the range under the pointer, and strikes through the days it leaves out", async () => {
    renderYear([]);
    await userEvent.click(cell("2026-06-12"));
    await userEvent.hover(cell("2026-06-16"));

    expect(cell("2026-06-12")).toHaveAttribute("data-selected", "edge");
    expect(cell("2026-06-15")).toHaveAttribute("data-selected", "inside");
    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "edge");
    expect(cell("2026-06-16")).toHaveAccessibleName("16 Jun 2026: last day");
    // Saturday the 13th lies inside: it is in the picture and out of the count.
    expect(cell("2026-06-13")).toHaveAttribute("data-selected", "excluded");
    expect(cell("2026-06-13")).toHaveClass("line-through");
    expect(cell("2026-06-17")).not.toHaveAttribute("data-selected");
  });

  it("offers 'This day only' and 'Cancel' as buttons, since neither is a gesture", async () => {
    renderYear([]);
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(screen.getByRole("button", { name: "This day only" }));
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-16", to: "2026-06-16" });

    await userEvent.click(cell("2026-06-17"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(cell("2026-06-17")).not.toHaveAttribute("data-selected");
  });

  it("takes the same day twice as a range of one day", async () => {
    renderYear([]);
    await userEvent.click(cell("2026-06-16"));
    await userEvent.click(cell("2026-06-16"));
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-16", to: "2026-06-16" });
  });

  it("opens a booked day for editing when no range is in progress", async () => {
    renderYear([vacation("2026-06-16")]);
    await userEvent.click(screen.getByTestId("leave-cell"));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("2026-06-16");
    expect(onRange).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lets a range close on a booked day, which keeps its drawing and gets a ring", async () => {
    renderYear([vacation("2026-06-17")]);
    await userEvent.click(cell("2026-06-15"));
    await userEvent.hover(cell("2026-06-18"));
    expect(cell("2026-06-17")).toHaveAttribute("data-selected", "inside");
    expect(cell("2026-06-17")).toHaveClass("ring-2");

    await userEvent.click(cell("2026-06-17"));
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-15", to: "2026-06-17" });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps the panel's range drawn while the panel is open", () => {
    renderYear([], 1, { range: { from: "2026-06-15", to: "2026-06-17" } });
    expect(cell("2026-06-15")).toHaveAttribute("data-selected", "edge");
    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "inside");
    expect(cell("2026-06-17")).toHaveAttribute("data-selected", "edge");
  });

  it("marks today, in the drawing and in the name", () => {
    renderYear([]);
    expect(cell(TODAY)).toHaveAttribute("data-today", "true");
    expect(cell(TODAY)).toHaveAccessibleName("15 Jun 2026: free, today");
    expect(cell("2026-06-16")).not.toHaveAttribute("data-today");
  });

  it("draws a day the server has not answered about paler", () => {
    renderYear([vacation("2026-06-16")], 1, { waiting: new Set(["2026-06-16"]) });
    expect(cell("2026-06-16")).toHaveClass("opacity-60");
    expect(cell("2026-06-17")).not.toHaveClass("opacity-60");
  });
});

describe("no hidden gesture is left (rewrite plan N5, criterion 1)", () => {
  it("leaves the right button to the browser's own menu", () => {
    renderYear([vacation("2026-06-16")]);
    // `fireEvent` answers false when a handler called preventDefault: nobody does any more.
    expect(fireEvent.contextMenu(screen.getByTestId("leave-cell"))).toBe(true);
    expect(fireEvent.contextMenu(cell("2026-06-17"))).toBe(true);
    expect(onRemove).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does nothing more when a day is held down, with either button", async () => {
    renderYear([vacation("2026-06-16")]);
    const booked = screen.getByTestId("leave-cell");
    fireEvent.pointerDown(booked, { button: 0, pointerType: "mouse" });
    fireEvent.pointerDown(booked, { button: 2, pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    fireEvent.pointerUp(booked, { button: 2, pointerType: "mouse" });
    expect(onRemove).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onRange).not.toHaveBeenCalled();
  });

  it("treats a click with Alt or Shift as a click", async () => {
    renderYear([]);
    fireEvent.click(cell("2026-06-16"), { altKey: true });
    fireEvent.click(cell("2026-06-18"), { shiftKey: true });
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-16", to: "2026-06-18" });
  });
});

describe("dragging, with a mouse only", () => {
  it("opens the range where the button is let go", () => {
    renderYear([]);
    fireEvent.pointerDown(cell("2026-06-15"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerOver(cell("2026-06-18"), { pointerType: "mouse" });
    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "inside");
    fireEvent.pointerUp(cell("2026-06-18"), { button: 0, pointerType: "mouse" });
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-15", to: "2026-06-18" });
  });

  it("closes on the nearest working day when the button is let go on a weekend", () => {
    renderYear([]);
    fireEvent.pointerDown(cell("2026-06-10"), { button: 0, pointerType: "mouse" });
    // Sunday the 14th is a position, not an end: the range closes on Friday the 12th.
    fireEvent.pointerUp(cell("2026-06-14"), { button: 0, pointerType: "mouse" });
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-10", to: "2026-06-12" });
  });

  it("is given up when the button is let go off the calendar", () => {
    renderYear([]);
    fireEvent.pointerDown(cell("2026-06-15"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(window);
    expect(cell("2026-06-15")).not.toHaveAttribute("data-selected");
    expect(onRange).not.toHaveBeenCalled();
  });

  it("is not for a finger: a touch that moves is the page scrolling", () => {
    renderYear([]);
    fireEvent.pointerDown(cell("2026-06-15"), { button: 0, pointerType: "touch" });
    fireEvent.pointerUp(cell("2026-06-18"), { button: 0, pointerType: "touch" });
    expect(onRange).not.toHaveBeenCalled();
    expect(cell("2026-06-15")).not.toHaveAttribute("data-selected");
  });
});

describe("the keyboard", () => {
  const focusOn = (date: string) => {
    cell(date).focus();
    return userEvent.setup();
  };

  it("picks the first day with Enter, walks to the last with the arrows, and Enter again", async () => {
    renderYear([]);
    const user = focusOn("2026-06-15");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toBeInTheDocument();

    await user.keyboard("{ArrowRight}{ArrowRight}");
    await vi.waitFor(() => expect(cell("2026-06-17")).toHaveFocus());
    // The preview follows the focus, and a screen reader is told what it covers.
    expect(cell("2026-06-16")).toHaveAttribute("data-selected", "inside");
    expect(screen.getByText("Range from 15 Jun 2026 to 17 Jun 2026: 3 d")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(onRange).toHaveBeenCalledExactlyOnceWith({ from: "2026-06-15", to: "2026-06-17" });
  });

  it("walks from one month into the next, since a range can", async () => {
    renderYear([]);
    const user = focusOn("2026-06-30");
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(cell("2026-07-01")).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(cell("2026-06-30")).toHaveFocus());
    // Down from the last week lands on the same weekday of the month after.
    await user.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(cell("2026-07-07")).toHaveFocus());
  });

  it("goes up and down a column past the days nothing can happen to", async () => {
    renderYear([]);
    // Tuesday 26 May: the Tuesday after is Republic Day, so Down lands on 9 June.
    const user = focusOn("2026-05-26");
    await user.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(cell("2026-06-09")).toHaveFocus());
    await user.keyboard("{ArrowUp}");
    await vi.waitFor(() => expect(cell("2026-05-26")).toHaveFocus());
  });

  it("stops at the ends of the year, and jumps to the ends of the month", async () => {
    renderYear([]);
    const user = focusOn("2026-01-02");
    await user.keyboard("{ArrowLeft}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cell("2026-01-02")).toHaveFocus();
    await user.keyboard("{End}");
    await vi.waitFor(() => expect(cell("2026-01-30")).toHaveFocus());
    await user.keyboard("{Home}");
    await vi.waitFor(() => expect(cell("2026-01-02")).toHaveFocus());
  });

  it("drops the range on Escape and keeps the focus on the day", async () => {
    renderYear([]);
    const user = focusOn("2026-06-15");
    await user.keyboard("{Enter}{ArrowRight}");
    await vi.waitFor(() => expect(cell("2026-06-16")).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(cell("2026-06-15")).not.toHaveAttribute("data-selected");
    expect(cell("2026-06-16")).toHaveFocus();
    expect(onRange).not.toHaveBeenCalled();
  });

  it("removes what a booked day carries on Delete, and does nothing on a free day or during a range", async () => {
    renderYear([vacation("2026-06-16")]);
    let user = focusOn("2026-06-17");
    await user.keyboard("{Delete}{Backspace}");
    expect(onRemove).not.toHaveBeenCalled();

    user = focusOn("2026-06-16");
    await user.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("2026-06-16");

    user = focusOn("2026-06-15");
    await user.keyboard("{Enter}");
    cell("2026-06-16").focus();
    await user.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("where a phone opens (decision Q5)", () => {
  const scrollIntoView = vi.fn();
  const phone = (matches: boolean) => {
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
  };

  it("scrolls to the month it is given, on a narrow screen", () => {
    phone(true);
    renderYear([], 1, { openOnMonth: 6 });
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelector('[data-month="6"]'));
  });

  it("stays at the top on a wide screen, and for a year that is not the current one", () => {
    phone(false);
    renderYear([], 1, { openOnMonth: 6 });
    phone(true);
    renderYear([], 1, { openOnMonth: null });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
