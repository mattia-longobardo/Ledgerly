import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/en.json";
import { SourceCategories, type SourceCategoryCommands, type SourceCategoryRow } from "./source-categories";

// "Categories of {source}" (ux/n3-categories-manual.md §6.4): match, add, "New", "Undo".

const notify = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/ui/toast", () => ({ notify: (...args: unknown[]) => notify(...args) }));

const OPTIONS = [
  { id: "cat-food", name: "Food", color: "#2563eb", depth: 0 as const },
  { id: "cat-vices", name: "Vices", color: "#b45309", depth: 0 as const },
];

const ROWS: SourceCategoryRow[] = [
  {
    id: "sc-groceries",
    name: "Groceries",
    nested: false,
    count: 310,
    isNew: false,
    choice: "matched",
    category: { id: "cat-food", name: "Food", color: "#2563eb" },
    options: OPTIONS,
  },
  {
    id: "sc-tobacco",
    name: "Tobacco",
    nested: true,
    count: 1,
    isNew: false,
    choice: "added",
    category: null,
    options: OPTIONS,
  },
  {
    id: "sc-pets",
    name: "Pets",
    nested: false,
    count: 0,
    isNew: true,
    choice: "added",
    category: null,
    options: OPTIONS,
  },
];

function commandsWith(overrides: Partial<SourceCategoryCommands> = {}): SourceCategoryCommands {
  return {
    set: vi.fn(async () => ({
      ok: true as const,
      name: "Tobacco",
      categoryName: "Vices",
      choice: "matched" as const,
      moved: 12,
      undoId: "undo-1",
    })),
    undo: vi.fn(async () => ({ ok: true })),
    keep: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function renderSection(commands: SourceCategoryCommands, rows: SourceCategoryRow[] = ROWS) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SourceCategories source="Pursely" rows={rows} commands={commands} />
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("table"));
}

beforeEach(() => {
  notify.mockClear();
  refresh.mockClear();
});

describe("SourceCategories", () => {
  it("lists each category of the source with its movements and the category it counts under", () => {
    const table = renderSection(commandsWith());
    expect(table.getByText("On Pursely")).toBeInTheDocument();
    expect(table.getByText("Groceries · 310 transactions")).toBeInTheDocument();
    expect(table.getByText("Tobacco · 1 transaction")).toBeInTheDocument();
    expect(table.getByText("Pets · no transactions")).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Ledgerly category for “Groceries”" })).toHaveTextContent(
      "Food",
    );
    expect(table.getByRole("button", { name: "Ledgerly category for “Tobacco”" })).toHaveTextContent(
      "Added as “Tobacco”",
    );
  });

  it("matches a category, says how many movements count there now, and offers to undo", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    const table = renderSection(commands);
    await user.click(table.getByRole("button", { name: "Ledgerly category for “Tobacco”" }));
    await user.click(await screen.findByRole("option", { name: "Vices" }));

    await waitFor(() => expect(commands.set).toHaveBeenCalledWith("sc-tobacco", "cat-vices"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Tobacco now matches Vices: 12 transactions",
        "success",
        expect.objectContaining({ label: "Undo" }),
      ),
    );
    expect(refresh).toHaveBeenCalled();

    const [, , action] = notify.mock.calls[0] as [string, string, { onClick: () => void }];
    action.onClick();
    await waitFor(() => expect(commands.undo).toHaveBeenCalledWith("undo-1"));
  });

  it("adds a matched category back as its own: the first choice of the list", async () => {
    const user = userEvent.setup();
    const commands = commandsWith({
      set: vi.fn(async () => ({
        ok: true as const,
        name: "Groceries",
        categoryName: "Groceries",
        choice: "added" as const,
        moved: 310,
        undoId: "undo-2",
      })),
    });
    const table = renderSection(commands);
    await user.click(table.getByRole("button", { name: "Ledgerly category for “Groceries”" }));
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Add as a new category");
    await user.click(options[0]);

    await waitFor(() => expect(commands.set).toHaveBeenCalledWith("sc-groceries", null));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Groceries added as a category: 310 transactions",
        "success",
        expect.objectContaining({ label: "Undo" }),
      ),
    );
  });

  it("says under the row when a change could not be saved, with no toast", async () => {
    const user = userEvent.setup();
    const table = renderSection(commandsWith({ set: vi.fn(async () => ({ ok: false as const })) }));
    await user.click(table.getByRole("button", { name: "Ledgerly category for “Tobacco”" }));
    await user.click(await screen.findByRole("option", { name: "Vices" }));
    expect(await table.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(notify).not.toHaveBeenCalled();
  });

  it("marks a category that arrived from the source, and keeps it as it is on request", async () => {
    const user = userEvent.setup();
    const commands = commandsWith();
    const table = renderSection(commands);
    expect(table.getByText("New")).toBeInTheDocument();
    await user.click(table.getByRole("button", { name: "Keep as it is" }));
    await waitFor(() => expect(commands.keep).toHaveBeenCalledWith("sc-pets"));
  });

  it("shows only the new ones on request, with their number", async () => {
    const user = userEvent.setup();
    renderSection(commandsWith());
    await user.click(screen.getByRole("button", { name: "New (1)" }));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Pets · no transactions")).toBeInTheDocument();
    expect(table.queryByText("Groceries · 310 transactions")).toBeNull();
  });

  it("says so when the source has given no category yet", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <SourceCategories source="Pursely" rows={[]} commands={commandsWith()} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("No categories from Pursely yet. They appear after the first update."),
    ).toBeInTheDocument();
  });
});
