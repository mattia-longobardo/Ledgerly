import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { RangePicker } from "./range-picker";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function renderPicker() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <RangePicker
        range={{ from: "2026-09-01", to: "2026-09-30" }}
        text="September 2026"
        params={{ cat: "cat-1" }}
        locale="en"
        label="Date range"
      />
    </NextIntlClientProvider>,
  );
}

describe("RangePicker", () => {
  it("is the period label itself, as in the design", () => {
    renderPicker();
    expect(screen.getByTitle("Date range")).toHaveTextContent("September 2026");
  });

  it("shows two months, ending on the one the range ends in", () => {
    renderPicker();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    // The summary carries the same month name, so the calendar heading is the second one.
    expect(screen.getAllByText("September 2026").length).toBe(2);
  });

  it("opens on the current range and offers to submit it as a form", () => {
    renderPicker();
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
    // The form carries the other filters along, so applying a range keeps them.
    expect(document.querySelector("input[name='cat']")).toHaveValue("cat-1");
  });

  it("builds a range from two clicks, the way the prototype does", async () => {
    renderPicker();
    const september = (day: string) => screen.getAllByRole("button", { name: day })[1];
    await userEvent.click(september("4"));
    expect(screen.getByText("Pick the end date")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-04");
    await userEvent.click(september("9"));
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-09");
    expect(screen.getByText("4 Sep 2026 – 9 Sep 2026 · 6 days")).toBeInTheDocument();
  });

  it("orders the ends whichever one was clicked first", async () => {
    renderPicker();
    const september = (day: string) => screen.getAllByRole("button", { name: day })[1];
    await userEvent.click(september("9"));
    await userEvent.click(september("4"));
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-04");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-09");
  });

  it("applies the range as a navigation, dropping the preset it replaces", async () => {
    renderPicker();
    const september = (day: string) => screen.getAllByRole("button", { name: day })[1];
    await userEvent.click(september("4"));
    await userEvent.click(september("9"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledWith("/expenses?cat=cat-1&from=2026-09-04&to=2026-09-09");
  });

  it("walks the calendars back a month", async () => {
    renderPicker();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });

  it("puts the range back when the panel is cancelled", async () => {
    renderPicker();
    await userEvent.click(screen.getAllByRole("button", { name: "4" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
  });
});
