import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { ShellProvider } from "@/ui/shell/shell-context";
import { Gallery } from "./gallery";

vi.mock("next/navigation", () => ({
  usePathname: () => "/components",
  useRouter: () => ({ push: vi.fn() }),
}));

// The gallery reads only setPaletteOpen from the shell, so the shell's labels are never shown.
function renderGallery() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ShellProvider initialSidebar="expanded" labels={{} as never} saveTheme={async () => undefined}>
        <Gallery />
      </ShellProvider>
    </NextIntlClientProvider>,
  );
}

describe("Gallery", () => {
  it("shows every section of the design system", () => {
    renderGallery();
    for (const title of [
      "Color tokens",
      "Type scale · Inter, tabular-nums",
      "Buttons",
      "Inputs",
      "Segmented control, tabs and chips",
      "Badges and tags",
      "Table · sort, hover, selected",
      "KPI, progress and skeleton",
      "Avatars and shortcuts",
      "Overlays",
      "Sidebar nav item states",
      "Page states",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("shows all 23 design tokens and every type size", () => {
    renderGallery();
    for (const token of [
      "--side",
      "--faint",
      "--border2",
      "--accent",
      "--primary-fg",
      "--track",
      "--skel",
      "--shadow",
    ])
      expect(screen.getByText(token)).toBeInTheDocument();
    expect(screen.getAllByText(/^--/)).toHaveLength(23);
    for (const size of ["36 / 600", "22 / 600", "17 / 600", "14 / 400", "10 / 500"])
      expect(screen.getByText(size)).toBeInTheDocument();
  });

  it("shows the states no product page uses yet", () => {
    renderGallery();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Monthly limit")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primary lg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus ring" })).toHaveClass("outline-accent");
    expect(screen.getByText("Active + focus")).toHaveClass("outline-accent");
    expect(screen.getByRole("rowheader", { name: "Total" })).toBeInTheDocument();
  });

  it("toggles the sample chips", async () => {
    renderGallery();
    await userEvent.click(screen.getByRole("button", { name: "Casa" }));
    expect(screen.getByRole("button", { name: "Casa" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Spesa" })).toHaveAttribute("aria-pressed", "false");
  });
});
