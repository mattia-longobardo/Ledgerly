import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/en.json";
import { Gallery } from "./gallery";

describe("Gallery", () => {
  it("shows every section of the design system", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <Gallery />
      </NextIntlClientProvider>,
    );
    for (const title of [
      "Colour tokens",
      "Type scale",
      "Buttons",
      "Inputs",
      "Segmented control and tabs",
      "Badges and tags",
      "Table",
      "KPI, progress and skeleton",
      "Avatars and shortcuts",
      "Overlays",
      "Page states",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("shows the components no product page uses yet", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <Gallery />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Recent expenses" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Monthly limit")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
