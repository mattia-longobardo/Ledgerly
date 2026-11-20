import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useDismiss } from "./dismissable-details";

/** A `<details>` closed by {@link useDismiss}, as the date range picker binds it. */
function DismissableDetails({ children, ...props }: { children: React.ReactNode; "data-testid": string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, open, () => {
    if (ref.current) ref.current.open = false;
  });
  return (
    <details {...props} ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)}>
      {children}
    </details>
  );
}

function renderMenu() {
  render(
    <div>
      <button type="button">Outside</button>
      <DismissableDetails data-testid="menu">
        <summary>Categories</summary>
        <a href="#groceries">Groceries</a>
      </DismissableDetails>
    </div>,
  );
  return screen.getByTestId("menu") as HTMLDetailsElement;
}

describe("useDismiss (the date range picker)", () => {
  it("closes when the pointer goes down outside it, and stays open for a click inside", async () => {
    const user = userEvent.setup();
    const menu = renderMenu();
    await user.click(screen.getByText("Categories"));
    expect(menu.open).toBe(true);
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByText("Groceries") });
    expect(menu.open).toBe(true);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(menu.open).toBe(false);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const menu = renderMenu();
    await user.click(screen.getByText("Categories"));
    await user.keyboard("{Escape}");
    expect(menu.open).toBe(false);
  });
});
