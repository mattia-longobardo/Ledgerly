import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./menu";
import { Modal } from "./modal";
import { Segmented } from "./segmented";
import { TabLinks } from "./tab-links";
import { notify, Toaster } from "./toast";

function ModalHarness() {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Add pocket" description="Earmark money">
      <p>Body</p>
    </Modal>
  );
}

describe("overlays", () => {
  it("shows a titled modal and closes it with Escape", async () => {
    render(<ModalHarness />);
    expect(screen.getByRole("dialog", { name: "Add pocket" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps exactly one segment selected", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Period"
        value="month"
        onChange={onChange}
        options={[
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(onChange).toHaveBeenCalledWith("year");
  });

  it("runs the chosen menu action", async () => {
    const onSelect = vi.fn();
    render(<ActionMenu label="Row actions" items={[{ label: "Edit", onSelect }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows a toast from anywhere", async () => {
    render(<Toaster closeLabel="Close" />);
    act(() => notify("Preferences saved"));
    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
  });

  it("gives an error toast the error tone and announces it assertively", async () => {
    render(<Toaster closeLabel="Close" />);
    act(() => notify("Couldn't save your theme. Try again.", "error"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your theme. Try again.");
    const toast = document.querySelector('[role="alertdialog"][data-type="error"]');
    expect(toast).toHaveTextContent("Couldn't save your theme. Try again.");
    expect(toast?.querySelector(".text-neg")).not.toBeNull();
  });

  it("names the tab navigation", () => {
    render(
      <TabLinks
        label="Settings sections"
        tabs={[{ href: "/settings/profile", label: "Profile", active: true }]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
  });
});
