import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { calendarCells, DateRangePicker, yearCells } from "./date-range-picker";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const LABELS = {
  label: "Chart range",
  from: "From",
  to: "To",
  previous: "Previous year",
  next: "Next year",
  pickEnd: "Pick the end month",
  apply: "Apply",
  cancel: "Cancel",
};

/** The month picker of Overview and Account detail (F2.5), with the hint written out by hand. */
function renderMonths() {
  push.mockClear();
  render(
    <DateRangePicker
      grain="month"
      range={{ from: "2025-10-01", to: "2026-09-30" }}
      text="Oct 2025 – Sep 2026"
      path="/"
      params={{ mode: "bars" }}
      locale="en"
      labels={LABELS}
      describe={(from, to) => `${from} → ${to}`}
    />,
  );
}

describe("DateRangePicker at month grain", () => {
  it("shows two years of months, ending on the year the range ends in", () => {
    renderMonths();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    // Each cell is a month, named in full for assistive technology.
    expect(screen.getByRole("button", { name: "September 2026" })).toHaveTextContent("Sep");
    expect(screen.getAllByRole("button", { name: /^\w+ 202[56]$/ })).toHaveLength(24);
  });

  it("opens on the current range as two month fields that carry the other parameters", () => {
    renderMonths();
    expect(screen.getByLabelText("From")).toHaveValue("2025-10");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09");
    expect(document.querySelector("input[name='mode']")).toHaveValue("bars");
    expect(screen.getByRole("button", { name: "October 2025" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "September 2025" })).toHaveAttribute("aria-pressed", "false");
  });

  it("builds a range of months from two clicks and applies it as AAAA-MM", async () => {
    renderMonths();
    await userEvent.click(screen.getByRole("button", { name: "March 2026" }));
    expect(screen.getByText("Pick the end month")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "January 2025" }));
    expect(screen.getByLabelText("From")).toHaveValue("2025-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-03");
    expect(screen.getByText("2025-01-01 → 2026-03-01")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledWith("/?mode=bars&from=2025-01&to=2026-03");
  });

  it("walks the grids a year at a time", async () => {
    renderMonths();
    await userEvent.click(screen.getByRole("button", { name: "Previous year" }));
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.queryByText("2026")).not.toBeInTheDocument();
  });
});

describe("yearCells", () => {
  it("gives the twelve months of a year as month keys", () => {
    expect(yearCells(2026)).toHaveLength(12);
    expect(yearCells(2026)[0]).toBe("2026-01-01");
    expect(yearCells(2026)[11]).toBe("2026-12-01");
  });
});

describe("calendarCells", () => {
  it("pads the grid to the Monday the month starts after", () => {
    // 1 September 2026 is a Tuesday: one blank before it.
    const cells = calendarCells("2026-09-01");
    expect(cells.length).toBe(30 + 1);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2026-09-01");
    expect(cells.at(-1)).toBe("2026-09-30");
  });

  it("needs no padding for a month that starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(calendarCells("2026-06-01")[0]).toBe("2026-06-01");
  });

  it("counts the days of February in a leap year", () => {
    expect(calendarCells("2028-02-01").filter((day) => day !== null).length).toBe(29);
  });
});
