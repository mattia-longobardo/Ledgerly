import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { notify, Toaster } from "./toast";

describe("a toast with an action", () => {
  it("offers the action as a button beside the message, and runs it once", async () => {
    const onClick = vi.fn();
    render(<Toaster closeLabel="Close" />);
    act(() => notify("Leave removed", "success", { label: "Undo", onClick }));

    expect(await screen.findByText("Leave removed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledOnce();
    // Used, the offer is withdrawn.
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
  });

  it("has no action button when none is given", async () => {
    render(<Toaster closeLabel="Close" />);
    act(() => notify("Preferences saved"));
    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
    // Only the cross that closes it: a toast with nothing to offer has no second button.
    const buttons = screen.getAllByRole("button", { hidden: true });
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Close"]);
  });

  it("keeps one action on offer at a time: a new one closes the one before it", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<Toaster closeLabel="Close" />);
    act(() => notify("First removed", "success", { label: "Undo", onClick: first }));
    act(() => notify("Second removed", "success", { label: "Undo", onClick: second }));

    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("stays eight seconds, where a plain toast stays three", async () => {
    vi.useFakeTimers();
    try {
      render(<Toaster closeLabel="Close" />);
      act(() => notify("Plain"));
      act(() => notify("With an action", "success", { label: "Undo", onClick: vi.fn() }));
      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(screen.queryByText("Plain")).not.toBeInTheDocument();
      expect(screen.getByText("With an action")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(screen.queryByText("With an action")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
