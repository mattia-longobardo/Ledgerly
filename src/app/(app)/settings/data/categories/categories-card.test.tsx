import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { CategoriesCard, type CategoryRow } from "./categories-card";

const create = vi.fn();
const save = vi.fn();
const archive = vi.fn();
const restore = vi.fn();

vi.mock("./actions", () => ({
  createCategoryAction: (...args: unknown[]) => create(...args),
  saveCategoryAction: (...args: unknown[]) => save(...args),
  archiveCategoryAction: (...args: unknown[]) => archive(...args),
  restoreCategoryAction: (...args: unknown[]) => restore(...args),
}));

const GROCERIES: CategoryRow = {
  id: "11111111-1111-7111-8111-111111111111",
  name: "Groceries",
  group: "Living",
  type: "expense",
  color: "#2563eb",
  archived: false,
  usage: 2,
};

const OLD: CategoryRow = {
  id: "22222222-2222-7222-8222-222222222222",
  name: "Old habit",
  group: null,
  type: "expense",
  color: null,
  archived: true,
  usage: 0,
};

function renderCard(rows: CategoryRow[] = [GROCERIES]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <CategoriesCard rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("CategoriesCard", () => {
  it("lists a category with its group, type and usage", () => {
    renderCard();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Living")).toBeInTheDocument();
    expect(screen.getByText("Expense")).toBeInTheDocument();
    expect(screen.getByText("2 transactions")).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    renderCard([]);
    expect(screen.getByText(messages.settings.data.categories.empty)).toBeInTheDocument();
  });

  it("hides the archived categories until they are asked for", async () => {
    renderCard([GROCERIES, OLD]);
    expect(screen.queryByText("Old habit")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Show archived"));
    expect(screen.getByText("Old habit")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("No group")).toBeInTheDocument();
  });

  it("creates a category with the name, group, type and colour chosen", async () => {
    create.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.type(screen.getByLabelText("Name"), "Fuel");
    await userEvent.type(screen.getByLabelText("Group"), "Car");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "transfer");
    await userEvent.click(screen.getByRole("button", { name: "#10b981" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(create).toHaveBeenCalledWith({
      name: "Fuel",
      group: "Car",
      type: "transfer",
      color: "#10b981",
    });
  });

  it("edits the category the row's menu points at, colour and all", async () => {
    save.mockResolvedValueOnce({ ok: true });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Food");
    await userEvent.click(screen.getByRole("button", { name: "No colour" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledWith(GROCERIES.id, {
      name: "Food",
      group: "Living",
      type: "expense",
      color: null,
    });
  });

  it("shows the catalogued message when the name is already taken", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "duplicate" });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.type(screen.getByLabelText("Name"), "Groceries");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.settings.data.categories.errors.duplicate,
    );
  });

  it("fills in the length the service enforces when it refuses the name", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "invalid" });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("between 1 and 60 characters");
  });

  it("shows a catalogued error instead of crashing when the action rejects", async () => {
    create.mockRejectedValueOnce(new Error("network down"));
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.type(screen.getByLabelText("Name"), "Fuel");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.settings.data.categories.errors.failed,
    );
  });

  it("archives an active category and restores an archived one", async () => {
    archive.mockResolvedValueOnce({ ok: true });
    restore.mockResolvedValueOnce({ ok: true });
    renderCard([GROCERIES, OLD]);
    await userEvent.click(screen.getByLabelText("Show archived"));

    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(archive).toHaveBeenCalledWith(GROCERIES.id);

    await userEvent.click(screen.getByRole("button", { name: "Old habit" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    expect(restore).toHaveBeenCalledWith(OLD.id);
  });
});
