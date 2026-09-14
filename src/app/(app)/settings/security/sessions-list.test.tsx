import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SessionsList } from "./sessions-list";

const revokeSession = vi.fn();
const revokeOtherSessions = vi.fn();
vi.mock("@/modules/users/actions", () => ({
  revokeSessionAction: (...a: unknown[]) => revokeSession(...a),
  revokeOtherSessionsAction: (...a: unknown[]) => revokeOtherSessions(...a),
}));

const SESSIONS = [
  {
    id: "s1",
    device: "Chrome · macOS",
    detail: "192.0.2.1 · this device",
    status: "Active now",
    current: true,
  },
  { id: "s2", device: "Safari · iOS", detail: "192.0.2.2", status: "since 2 Jan 2026", current: false },
];

function renderList() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SessionsList sessions={SESSIONS} />
    </NextIntlClientProvider>,
  );
}

describe("SessionsList", () => {
  it("shows this device as active now, with no sign-out of its own", () => {
    renderList();
    expect(screen.getByText("Active now")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out Chrome · macOS" })).not.toBeInTheDocument();
  });

  it("signs out one session, from a button that names its device", async () => {
    revokeSession.mockResolvedValueOnce({ ok: true });
    renderList();
    await userEvent.click(screen.getByRole("button", { name: "Sign out Safari · iOS" }));
    expect(revokeSession).toHaveBeenCalledWith("s2");
  });

  it("shows a catalogued error instead of crashing when the action reports failure", async () => {
    revokeSession.mockResolvedValueOnce({ ok: false, error: "failed" });
    renderList();
    await userEvent.click(screen.getByRole("button", { name: "Sign out Safari · iOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.sessions.errors.failed);
  });

  it("shows a catalogued error instead of crashing when the action rejects unexpectedly", async () => {
    revokeSession.mockRejectedValueOnce(new Error("network down"));
    renderList();
    await userEvent.click(screen.getByRole("button", { name: "Sign out Safari · iOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.sessions.errors.failed);
  });

  it("signs out other sessions", async () => {
    revokeOtherSessions.mockResolvedValueOnce({ ok: true });
    renderList();
    await userEvent.click(screen.getByRole("button", { name: "Sign out other sessions" }));
    expect(revokeOtherSessions).toHaveBeenCalled();
  });
});
