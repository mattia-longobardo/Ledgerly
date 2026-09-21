import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { LabelsCard, type LabelRow } from "./labels-card";

const create = vi.fn();
const save = vi.fn();
const remove = vi.fn();

vi.mock("./actions", () => ({
  createLabelAction: (...args: unknown[]) => create(...args),
  saveLabelAction: (...args: unknown[]) => save(...args),
  deleteLabelAction: (...args: unknown[]) => remove(...args),
}));

const HOLIDAY: LabelRow = {
  id: "33333333-3333-7333-8333-333333333333",
  name: "Holiday",
  color: "#f59e0b",
  usage: 3,
};

function renderCard(rows: LabelRow[] = [HOLIDAY]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <LabelsCard rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("LabelsCard", () => {
  it("lists a label with how many movements carry it", () => {
    renderCard();
    expect(screen.getByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("3 transactions")).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    renderCard([]);
    expect(screen.getByText(messages.settings.labels.empty)).toBeInTheDocument();
  });

  it("creates a label with the name and colour chosen", async () => {
    create.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add label" }));
    await userEvent.type(screen.getByLabelText("Name"), "Work");
    await userEvent.click(screen.getByRole("button", { name: "#8b5cf6" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(create).toHaveBeenCalledWith({ name: "Work", color: "#8b5cf6" });
  });

  it("renames the label the row's menu points at", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Holiday" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Trip");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledWith(HOLIDAY.id, { name: "Trip", color: "#f59e0b" });
  });

  it("asks before deleting, saying how many movements lose the label", async () => {
    remove.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Holiday" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: messages.settings.labels.remove_confirm.title });
    expect(dialog).toHaveTextContent("It is removed from 3 transactions.");
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith(HOLIDAY.id);
  });

  it("keeps the label when the confirmation is dismissed", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Holiday" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the catalogued message when the name is already taken", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "duplicate" });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add label" }));
    await userEvent.type(screen.getByLabelText("Name"), "Holiday");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.labels.errors.duplicate);
  });

  it("shows a catalogued error instead of crashing when the action rejects", async () => {
    create.mockRejectedValueOnce(new Error("network down"));
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add label" }));
    await userEvent.type(screen.getByLabelText("Name"), "Work");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.settings.labels.errors.failed);
  });
});
