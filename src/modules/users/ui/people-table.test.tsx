import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { PeopleTable, type PersonView } from "./people-table";

const notify = vi.fn();
vi.mock("@/ui/toast", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const setRole = vi.fn();
const setBlocked = vi.fn();
const sendReset = vi.fn();
const remove = vi.fn();
const revoke = vi.fn();
vi.mock("../actions", () => ({
  setPersonRoleAction: (...a: unknown[]) => setRole(...a),
  setPersonBlockedAction: (...a: unknown[]) => setBlocked(...a),
  sendPersonResetAction: (...a: unknown[]) => sendReset(...a),
  removePersonAction: (...a: unknown[]) => remove(...a),
  revokeInvitationAction: (...a: unknown[]) => revoke(...a),
}));

const ME: PersonView = {
  kind: "user",
  id: "me",
  name: "Ada Lovelace",
  initials: "AL",
  email: "ada@example.test",
  method: "password",
  role: "admin",
  lastSignIn: "20 Sep 2026",
  status: "active",
  self: true,
};

const OTHER: PersonView = {
  kind: "user",
  id: "other",
  name: "Grace Hopper",
  initials: "GH",
  email: "grace@example.test",
  method: "sso",
  role: "user",
  lastSignIn: "—",
  status: "active",
  self: false,
};

const INVITED: PersonView = {
  kind: "invitation",
  id: "inv",
  name: "",
  initials: "NE",
  email: "new@example.test",
  method: "invited",
  role: "user",
  lastSignIn: "—",
  status: "pending",
  self: false,
};

function renderTable(people: PersonView[] = [ME, OTHER, INVITED]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <PeopleTable people={people} />
    </NextIntlClientProvider>,
  );
}

describe("PeopleTable", () => {
  it("offers no block and no remove on the reader's own row", () => {
    renderTable([ME]);
    expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("changes a role from the row's own selector", async () => {
    setRole.mockResolvedValueOnce({ ok: true, outcome: undefined });
    renderTable([OTHER]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role of Grace Hopper" }), "admin");
    expect(setRole).toHaveBeenCalledWith("other", "admin");
  });

  it("asks before removing, and only then removes", async () => {
    remove.mockResolvedValueOnce({ ok: true, outcome: undefined });
    renderTable([OTHER]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByText("grace@example.test and everything they own will be deleted."),
    ).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(remove).toHaveBeenCalledWith("other");
  });

  it("offers an invitation only its withdrawal", async () => {
    revoke.mockResolvedValueOnce({ ok: true, outcome: undefined });
    renderTable([INVITED]);
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revoke).toHaveBeenCalledWith("inv");
  });

  it("says what happened when a reset has nowhere to go", async () => {
    sendReset.mockResolvedValueOnce({ ok: true, outcome: "sso_only" });
    renderTable([OTHER]);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(notify).toHaveBeenCalledWith("Nothing sent: this account signs in with Authentik only.", "error");
  });

  it("reports a refusal in the reader's own words", async () => {
    remove.mockResolvedValueOnce({ ok: false, error: "last_admin" });
    renderTable([OTHER]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(notify).toHaveBeenCalledWith(
      "This is the last admin: the instance would have nobody to administer it.",
      "error",
    );
  });
});
