import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Avatar, initials } from "./avatar";
import { Badge } from "./badge";
import { Button, IconButton, LinkButton } from "./button";
import { cn } from "./cn";
import { Field } from "./field";
import { Input } from "./input";
import { KpiTile } from "./kpi-tile";
import { ProgressBar } from "./progress-bar";
import { toneOfSign } from "./tone";

describe("cn", () => {
  it("keeps a font size and a colour together, and resolves conflicts", () => {
    expect(cn("text-fg", "text-kpi")).toBe("text-fg text-kpi");
    expect(cn("text-muted", "text-pos")).toBe("text-pos");
    expect(cn("rounded-ctl", "rounded-card")).toBe("rounded-card");
  });
});

describe("Button", () => {
  it("is a non-submitting button by default and fires clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives icon buttons an accessible name and a tooltip", () => {
    render(<IconButton label="Toggle sidebar">x</IconButton>);
    const button = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(button).toHaveAttribute("title", "Toggle sidebar");
  });

  it("gives link buttons the same focus-visible outline as other buttons", () => {
    render(<LinkButton>Undo</LinkButton>);
    expect(screen.getByRole("button", { name: "Undo" }).className).toContain("focus-visible:outline-accent");
  });
});

describe("form controls", () => {
  it("links a field label to its input and marks errors", () => {
    render(
      <Field label="Email" htmlFor="email" error="Required">
        <Input id="email" invalid />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("associates the field's error text via aria-describedby without an explicit invalid prop", () => {
    render(
      <Field label="Amount" htmlFor="amount" error="Must be positive">
        <Input id="amount" />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    const error = screen.getByText("Must be positive");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("associates the field's hint text via aria-describedby and leaves aria-invalid absent", () => {
    render(
      <Field label="Notes" htmlFor="notes" hint="Optional">
        <Input id="notes" />
      </Field>,
    );
    const input = screen.getByLabelText("Notes");
    const hint = screen.getByText("Optional");
    expect(input).toHaveAttribute("aria-describedby", hint.id);
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("display", () => {
  it("renders badges, KPI tiles and progress", () => {
    render(
      <>
        <Badge tone="pos">On track</Badge>
        <KpiTile label="Cash" value="7.135,95 €" delta="+120,00 €" deltaTone="pos" note="2 accounts" />
        <ProgressBar value={1.4} label="Budget" />
      </>,
    );
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("7.135,95 €")).toBeInTheDocument();
    expect(screen.getByText("+120,00 €")).toHaveClass("text-pos");
    expect(screen.getByRole("progressbar", { name: "Budget" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("derives initials and sign tones", () => {
    expect(initials("Mattia Longobardo")).toBe("ML");
    expect(initials("  giulia ")).toBe("G");
    expect(toneOfSign(-3n)).toBe("neg");
    expect(toneOfSign(0)).toBe("muted");
    expect(toneOfSign(null)).toBe("muted");
    render(<Avatar name="Mattia Longobardo" />);
    expect(screen.getByText("ML")).toBeInTheDocument();
  });

  it("gives the avatar an accessible name by default, and hides it when decorative", () => {
    const { unmount } = render(<Avatar name="Mattia Longobardo" />);
    expect(screen.getByRole("img", { name: "Mattia Longobardo" })).toHaveTextContent("ML");
    unmount();

    render(<Avatar name="Giulia Rossi" decorative />);
    const decorativeAvatar = screen.getByText("GR");
    expect(decorativeAvatar).toHaveAttribute("aria-hidden", "true");
    expect(decorativeAvatar).not.toHaveAttribute("role");
  });
});
