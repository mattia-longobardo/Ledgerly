import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { NotificationsScreen } from "./notifications-screen";

const EVENTS = [
  {
    event: "connection_failed",
    category: "action",
    addon: null,
    addonActive: true,
    channels: { inApp: true, email: true, device: true },
    locked: ["inApp"],
  },
  {
    event: "payslips_to_review",
    category: "action",
    addon: "payroll",
    addonActive: true,
    channels: { inApp: true, email: false, device: true },
    locked: ["inApp", "email"],
  },
  {
    event: "budget_threshold",
    category: "reminder",
    addon: "budgets",
    addonActive: false,
    channels: { inApp: true, email: true, device: false },
    locked: [],
  },
];

const writes: { url: string; body: unknown }[] = [];

beforeEach(() => {
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") writes.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ events: EVENTS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderScreen() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <NotificationsScreen />
    </NextIntlClientProvider>,
  );
}

describe("Settings › Alerts", () => {
  it("shows the three channels of each event, with a locked channel that cannot change", async () => {
    renderScreen();
    expect(await screen.findByRole("switch", { name: "Connection in error In the app" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("switch", { name: "Connection in error Email" })).not.toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("switch", { name: "Payslips to review Email" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("switch", { name: "Payslips to review Email" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("greys the events of an addon that is off, and none of their channels changes", async () => {
    renderScreen();
    const row = await screen.findByTestId("event-budget_threshold");
    expect(row).toHaveClass("opacity-60");
    expect(row).toHaveTextContent("Budgets is off: this event sends nothing.");
    for (const name of ["In the app", "Email", "Device"])
      expect(screen.getByRole("switch", { name: `Budget threshold ${name}` })).toHaveAttribute(
        "data-disabled",
      );
  });

  it("writes only the channel the person changed", async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole("switch", { name: "Connection in error Device" }));
    await vi.waitFor(() =>
      expect(writes).toEqual([
        { url: "/api/v1/notification-preferences/connection_failed", body: { device: false } },
      ]),
    );
  });
});
