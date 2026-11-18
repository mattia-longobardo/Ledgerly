// tests/e2e/categories/a11y.spec.ts — the screens of the flow `categories` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/categories", session: "layout", open: go("/settings/categories") },
  {
    name: "/settings/categories (categories of a source)",
    session: "sources",
    open: go("/settings/categories"),
  },
  // Release N7.2: the section of a source's categories is on the source's page.
  {
    name: "/settings/integrations/[source] (categories of a source)",
    session: "sources",
    open: go("/settings/integrations/wallet"),
  },

  // Release N3, second part (ux/n3-categories-manual.md §12, §13): the `review` user has movements
  // in every state of a category; `reviewNew` has movements and no category.
  { name: "/expenses (automatic categories)", session: "review", open: go("/expenses?preset=last3Months") },
  { name: "/expenses/review (groups)", session: "review", open: go("/expenses/review") },
  {
    name: "/expenses/review (a group open)",
    session: "review",
    open: async (page) => {
      await page.goto("/expenses/review");
      await settled(page);
      await page
        .getByRole("button", { name: /^(Show all|Mostra tutti)/ })
        .first()
        .click();
    },
  },
  {
    name: "/expenses/review (nothing in the period)",
    session: "review",
    open: go("/expenses/review?from=2020-01-01&to=2020-01-31"),
  },
  {
    name: "/expenses/review (guided, the groups)",
    session: "reviewNew",
    open: go("/expenses/review?guide=1&bank=Zeta%20Bank"),
  },
  { name: "/settings/categories (a merge proposal)", session: "review", open: go("/settings/categories") },

  // Release N3.2 (categories-and-rules.md §5): the `review` user has the default groups and movements.
  { name: "/expenses/categories", session: "review", open: go("/expenses/categories?preset=last3Months") },
  {
    name: "/expenses/categories (every group open)",
    session: "review",
    open: async (page) => {
      await page.goto("/expenses/categories?preset=last3Months");
      await settled(page);
      await page.getByRole("button", { name: "Expand all" }).click();
    },
  },
  { name: "/expenses/categories (Income)", session: "review", open: go("/expenses/categories?macro=income") },
  {
    name: "/expenses/categories (Transfers)",
    session: "review",
    open: go("/expenses/categories?macro=transfer"),
  },
  {
    name: "/expenses/categories/[id]",
    session: "review",
    open: async (page) => {
      await page.goto("/expenses/categories?preset=last3Months");
      await settled(page);
      await page
        .locator("main")
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Open the group" }).click();
      await page.waitForURL(/\/expenses\/categories\/[0-9a-f-]{36}/);
    },
  },
];

const OVERLAYS: Screen[] = [
  {
    // Release N3.1: the chooser of a source's category, open on its list.
    name: "the category chooser of a source's category",
    session: "sources",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/integrations/wallet");
      await settled(page);
      await page
        .getByTestId("source-category-row")
        .locator("visible=true")
        .first()
        .getByRole("button")
        .last()
        .click();
      await settledDialog(page);
    },
  },
  {
    name: "the reason of an automatic category",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses?preset=last3Months");
      await settled(page);
      await page.getByTestId("auto-mark").locator("visible=true").first().click();
      await settledDialog(page);
    },
  },
  {
    name: "a suggestion and its reason",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses?preset=last3Months");
      await settled(page);
      await page.getByTestId("suggestion-chip").locator("visible=true").first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the new group dialog",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses/categories");
      await settled(page);
      await page.getByRole("button", { name: "New group" }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the archive dialog of a group",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses/categories");
      await settled(page);
      await page
        .locator("main")
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      await settledDialog(page);
    },
  },
  {
    // Release N3.3 (categories-and-rules.md §5.6): what the move changes, said before it.
    name: "the move to another section dialog",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses/categories?preset=last3Months");
      await settled(page);
      await page
        .locator("main")
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Move to another section…" }).click();
      await settledDialog(page);
      await page
        .getByRole("dialog")
        .getByText(/no longer count|counts differently/)
        .waitFor();
    },
  },
  {
    name: "the merge categories dialog",
    session: "review",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/categories");
      await settled(page);
      await page.getByTestId("merge-proposal").getByRole("button").last().click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
