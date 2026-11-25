// tests/e2e/categories/a11y.spec.ts — the screens of the flow `categories` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { test } from "@playwright/test";
import { audit, go, type Screen, settled, settledDialog } from "../_shared/a11y";

const PAGES: Screen[] = [
  { name: "/settings/finance", session: "layout", open: go("/settings/finance") },
  {
    name: "/settings/finance (categories of a source)",
    session: "sources",
    open: go("/settings/finance"),
  },
  // Release N7.2: the section of a source's categories is on the source's page.
  {
    name: "/settings/plugins/[source] (categories of a source)",
    session: "sources",
    open: go("/settings/plugins/wallet"),
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
  { name: "/settings/finance (a merge proposal)", session: "review", open: go("/settings/finance") },

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

  // Release N3.4 (categories-and-rules.md §4): the `rules` user has two rules, one off; the
  // `layout` user has none.
  { name: "/settings/finance/rules", session: "rules", open: go("/settings/finance/rules") },
  { name: "/settings/finance/rules (no rule)", session: "layout", open: go("/settings/finance/rules") },

  // Decision 14A: the import of another app's history. The answer is the route's, given here, so a
  // check at every width writes nothing; history.spec.ts imports for real.
  {
    name: "/settings/finance (the import of a history, its result)",
    session: "history",
    open: async (page) => {
      await page.route("**/api/v1/categories/labels", (route) =>
        route.fulfill({
          json: { imported: 3, transfers: 1, unknown: 1, unreadable: 1, unmapped: 1, duplicates: 1 },
        }),
      );
      await page.goto("/settings/finance");
      await settled(page);
      const section = page.getByRole("region", { name: "Learn from your history" });
      await section.getByLabel("Wallet export (CSV)").setInputFiles({
        name: "records.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("category;amount;type;note;date;transfer;payee\n"),
      });
      await section.getByRole("button", { name: "Import" }).click();
      await section.getByTestId("history-result").waitFor();
    },
  },
];

const OVERLAYS: Screen[] = [
  {
    // Decision 14A: the selector with the three likeliest on top (the route's answer given here).
    name: "the category selector with the likeliest on top",
    session: "history",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      const { categories } = await (await page.request.get("/api/v1/categories")).json();
      const top = categories.slice(1, 4).map((one: { id: string }) => one.id);
      await page.route("**/api/v1/transactions/*/category-suggestions", (route) =>
        route.fulfill({ json: { categoryId: null, top } }),
      );
      await page.goto("/expenses?preset=last3Months");
      await settled(page);
      await page.getByRole("button", { name: "Edit category" }).locator("visible=true").first().click();
      await page.getByRole("group", { name: "Most likely" }).waitFor();
      await settledDialog(page);
    },
  },
  {
    name: "a group suggestion and its reason",
    session: "history",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/expenses?preset=last3Months");
      await settled(page);
      await page.getByTestId("suggestion-chip").locator("visible=true").first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the editor of a rule, with its preview",
    session: "rules",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/finance/rules");
      await settled(page);
      await page.getByRole("button", { name: "Actions for Newsstand" }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await settledDialog(page);
      await page.getByTestId("rule-preview").getByText("1 transaction matches.").waitFor();
    },
  },
  {
    name: "the dialog Apply of a rule",
    session: "rules",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/finance/rules");
      await settled(page);
      await page.getByRole("button", { name: "Actions for Newsstand" }).click();
      await page.getByRole("menuitem", { name: "Apply to existing transactions…" }).click();
      await settledDialog(page);
      await page.getByTestId("rule-apply").getByText("1 transaction moves").waitFor();
    },
  },
  {
    // Release N3.1: the chooser of a source's category, open on its list.
    name: "the category chooser of a source's category",
    session: "sources",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/plugins/wallet");
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
      await page.goto("/settings/finance");
      await settled(page);
      await page.getByTestId("merge-proposal").getByRole("button").last().click();
      await settledDialog(page);
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
