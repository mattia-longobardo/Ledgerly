import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { type CategoryGroup, CategoryTree } from "./category-tree";

const notify = vi.fn();
vi.mock("@/ui/toast", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const createCategory = vi.fn();
const saveCategory = vi.fn();
const archiveCategory = vi.fn();
const restoreCategory = vi.fn();
const deleteCategory = vi.fn();
vi.mock("./actions", () => ({
  createCategoryAction: (...a: unknown[]) => createCategory(...a),
  saveCategoryAction: (...a: unknown[]) => saveCategory(...a),
  archiveCategoryAction: (...a: unknown[]) => archiveCategory(...a),
  restoreCategoryAction: (...a: unknown[]) => restoreCategory(...a),
  deleteCategoryAction: (...a: unknown[]) => deleteCategory(...a),
}));

const LIVING: CategoryGroup = {
  group: {
    id: "g1",
    name: "Living",
    parentId: null,
    type: "expense",
    color: "#2563eb",
    chosenColor: "#2563eb",
    archived: false,
    usage: 12,
  },
  children: [
    {
      id: "c1",
      name: "Rent",
      parentId: "g1",
      type: "expense",
      color: "#2563eb",
      chosenColor: null,
      archived: false,
      usage: 3,
    },
  ],
};

function renderTree(groups: CategoryGroup[] = [LIVING]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <CategoryTree groups={groups} />
    </NextIntlClientProvider>,
  );
}

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole("button", { name }));
}

describe("CategoryTree", () => {
  it("draws a group with its sub-categories under it", () => {
    renderTree();
    expect(screen.getByText("Living")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add sub-category" })).toBeInTheDocument();
  });

  it("offers a colour on a group and says where a sub-category's comes from", async () => {
    renderTree();
    await openMenu("Living");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit category" }));
    expect(await screen.findByLabelText("Colour")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await openMenu("Rent");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit category" }));
    expect(await screen.findByText("It is drawn in Living's colour.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Colour")).not.toBeInTheDocument();
  });

  it("never sends a colour for a sub-category: it is the group's", async () => {
    createCategory.mockResolvedValueOnce({ ok: true });
    renderTree();
    await userEvent.click(screen.getByRole("button", { name: "Add sub-category" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Water");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(createCategory).toHaveBeenCalledWith({
      name: "Water",
      parentId: "g1",
      type: "expense",
      color: null,
    });
  });

  it("spells out everything a deletion takes, Wallet included, before it happens", async () => {
    renderTree();
    await openMenu("Living");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this category?" });
    expect(dialog).toHaveTextContent("Living is removed for good. This cannot be undone.");
    expect(dialog).toHaveTextContent("12 transactions lose their category.");
    expect(dialog).toHaveTextContent("Its sub-categories are deleted with it.");
    expect(dialog).toHaveTextContent("It is deleted in Wallet too, if it came from there.");
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it("deletes only once the dialog is confirmed, and reports what Wallet did", async () => {
    deleteCategory.mockResolvedValueOnce({
      ok: true,
      removed: 2,
      uncategorised: 12,
      wallet: { state: "deleted", count: 2 },
    });
    renderTree();
    await openMenu("Living");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this category?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteCategory).toHaveBeenCalledWith("g1");
    expect(notify).toHaveBeenCalledWith("2 categories deleted in Wallet too");
  });

  it("says so, as an error, when Wallet refused the deletion", async () => {
    deleteCategory.mockResolvedValueOnce({
      ok: true,
      removed: 1,
      uncategorised: 0,
      wallet: { state: "refused", reasons: ["still referenced by 3 records"] },
    });
    renderTree();
    await openMenu("Rent");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this category?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(notify).toHaveBeenCalledWith("Wallet did not delete it: still referenced by 3 records", "error");
  });
});
