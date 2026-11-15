import { render, screen } from "@testing-library/react";
import type { Route } from "next";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { StepIndicator } from "./step-indicator";
import { Switch } from "./switch";

function Row({ disabled }: { disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <span id="question">Do you make one-off payments?</span>
      <Switch
        checked={on}
        onCheckedChange={setOn}
        labelledBy="question"
        controls="fields"
        disabled={disabled}
      />
      <div id="fields">{on && <input aria-label="Amount" />}</div>
    </>
  );
}

describe("Switch", () => {
  it("is a switch named by the row's label, off at first", () => {
    render(<Row />);
    const control = screen.getByRole("switch", { name: "Do you make one-off payments?" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("aria-controls", "fields");
    expect(control).toHaveClass("focus-ring", "h-6", "w-11");
  });

  it("changes with a click and with Space, and keeps the focus", async () => {
    render(<Row />);
    const control = screen.getByRole("switch");
    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
    control.focus();
    await userEvent.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveFocus();
  });

  it("does not change while disabled", async () => {
    render(<Row disabled />);
    const control = screen.getByRole("switch");
    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "false");
  });
});

describe("StepIndicator", () => {
  const steps = [
    { id: "fund", label: "The fund", href: "/funds/new?step=fund" as Route },
    { id: "sources", label: "How you pay in", href: "/funds/new?step=sources" as Route },
    { id: "fees", label: "Fees", href: "/funds/new?step=fees" as Route },
  ];

  it("marks the current step, and makes the ones before it links back", () => {
    render(<StepIndicator label="Steps" doneLabel="done" steps={steps} current="sources" />);
    const list = screen.getByRole("list", { name: "Steps" });
    const items = Array.from(list.querySelectorAll("li"));
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "1 The fund done" })).toHaveAttribute(
      "href",
      "/funds/new?step=fund",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
