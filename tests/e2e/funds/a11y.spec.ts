// tests/e2e/funds/a11y.spec.ts — the screens of the flow `funds` in the layout and
// accessibility check: what is measured, and why, is in tests/e2e/_shared/a11y.ts.
import { expect, test } from "@playwright/test";
import {
  audit,
  follow,
  fundForm,
  go,
  layoutFund,
  type Screen,
  settled,
  settledDialog,
} from "../_shared/a11y";
import { THIS_YEAR } from "../_shared/helpers";

const PAGES: Screen[] = [
  { name: "/funds", session: "layout", smoke: true, open: go("/funds"), everyWidth: true },
  // The form "Add pension fund" (release N6), at each of its four steps.
  ...(["fund", "sources", "fees", "review"] as const).map((step): Screen => ({
    name: `/funds/new?step=${step}`,
    session: "layout",
    open: (page) => fundForm(page, step),
    everyWidth: step === "fund",
  })),
  // The seeded `layout` has years of its own: one measured and one with money and no value.
  ...(
    [
      ["last year", `?off=1`],
      ["a year with money and no value", `?off=2`],
      ["All", "?preset=all"],
    ] as const
  ).map(([what, query]): Screen => ({
    name: `/funds, as \`layout\`, ${what}`,
    session: "layout",
    open: go(`/funds${query}`),
  })),
  ...(
    [
      ["the year running", ""],
      ["the value chart", "?view=value"],
      ["All, with the years", "?preset=all"],
      ["All, the value chart", "?preset=all&view=value"],
      ["a measured year", `?off=3`],
      ["a year with money and no value", `?off=2`],
      ["a year with nothing", `?off=1`],
      ["a year with payslips alone", `?off=4`],
      ["a year before the data", `?off=9`],
      ["a custom period", `?from=${THIS_YEAR - 3}-01-01&to=${THIS_YEAR - 3}-03-31`],
    ] as const
  ).map(([what, query]): Screen => ({
    name: `/funds, ${what}`,
    session: "fundsHome",
    open: go(`/funds${query}`),
  })),
  ...(["Piano Uno", "Pensione Beta"] as const).flatMap((fund) =>
    (
      [
        ["the year running", ""],
        ["the value chart", "?view=value"],
        ["a past year", `?off=1`],
        ["All", "?preset=all"],
        ["a year before the data", `?off=9`],
        ["a custom period", `?from=${THIS_YEAR - 1}-01-01&to=${THIS_YEAR - 1}-03-31`],
        ["Values", "?tab=valuations&preset=all"],
        ["Values, a past year", `?tab=valuations&off=1`],
        ["Values, a year with none", `?tab=valuations&off=9`],
        // One set of tabs for every fund (release N6): the debits are contributions like the others.
        ["Contributions", "?tab=contributions&preset=all"],
        ["Contributions, a past year", `?tab=contributions&off=1`],
        ["Settings", "?tab=settings"],
      ] as const
    ).map(([what, query]): Screen => ({
      name: `/funds/[id], ${fund}, ${what}`,
      session: "fundsDetail",
      open: async (page) => {
        await follow(page, "/funds", new RegExp(`^${fund}$`));
        await page.goto(`${new URL(page.url()).pathname}${query}`);
        await settled(page);
      },
    })),
  ),
  ...(
    [
      ["no value in the year running", ""],
      ["a year of payslips alone", `?off=4`],
      ["Contributions, a year of payslips alone", `?tab=contributions&off=4`],
      ["Values, a year of payslips alone", `?tab=valuations&off=4`],
    ] as const
  ).map(([what, query]): Screen => ({
    name: `/funds/[id], ${what}`,
    session: "fundsHome",
    open: async (page) => {
      await follow(page, "/funds", /^Pensione Alfa$/);
      await page.goto(`${new URL(page.url()).pathname}${query}`);
      await settled(page);
    },
  })),
  // The four tabs of `layout`'s own funds (release N6). "Cometa" is fed by the payslip, with an active
  // source, its payslips and what two documents left before N6 — the statements already read are on
  // nobody else's page. "Fideuram…" has a debit on an account, its two fees and the estimated cost.
  ...(
    [
      ["Cometa, fed by the payslip", /^Cometa$/],
      ["Fideuram, with a debit", /^Fideuram Master Selection$/],
    ] as const
  ).flatMap(([what, fund]) =>
    (
      [
        ["Overview", "?preset=all"],
        ["Contributions", "?tab=contributions&preset=all"],
        ["Values", "?tab=valuations&preset=all"],
        ["Settings", "?tab=settings"],
      ] as const
    ).map(([tab, query]): Screen => ({
      name: `/funds/[id], ${what}, ${tab}`,
      session: "layout",
      open: (page) => layoutFund(page, fund, query),
      everyWidth: what === "Cometa, fed by the payslip" && tab === "Overview",
    })),
  ),
  // The fund of `fundsSetup` with no source, no contribution and no value: every empty state at once.
  ...(
    [
      ["Overview", ""],
      ["Contributions", "?tab=contributions"],
      ["Values", "?tab=valuations"],
      ["Settings", "?tab=settings"],
    ] as const
  ).map(([tab, query]): Screen => ({
    name: `/funds/[id], a fund with no source, ${tab}`,
    session: "fundsSetup",
    open: async (page) => {
      await follow(page, "/funds?preset=all", /^Fondo Vuoto$/);
      await page.goto(`${new URL(page.url()).pathname}${query}`);
      await settled(page);
    },
  })),
];

const OVERLAYS: Screen[] = [
  // The four dialogs of a fund (release N6): a contribution, a value, a source, a fee.
  {
    // On the fund fed by the payslip: the three components and the period of the source.
    name: "the record contribution dialog, from the payslip",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Cometa$/, "?tab=contributions&preset=all");
      await page
        .getByTestId("fund-contributions")
        .getByRole("button", { name: "Record contribution" })
        .click();
      await settledDialog(page);
      await expect(page.getByRole("dialog").getByLabel("Period")).toBeVisible();
    },
  },
  {
    // On the fund with a debit: the amount, the fee proposed and the movement to link.
    name: "the record contribution dialog, voluntary",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "?tab=contributions&preset=all");
      await page
        .getByTestId("fund-contributions")
        .getByRole("button", { name: "Record contribution" })
        .click();
      await settledDialog(page);
      await expect(page.getByRole("dialog").getByLabel("Linked movement")).toBeVisible();
    },
  },
  {
    name: "the record contribution dialog, another operation",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "?tab=contributions&preset=all");
      await page
        .getByTestId("fund-contributions")
        .getByRole("button", { name: "Record contribution" })
        .click();
      await settledDialog(page);
      await page.getByRole("dialog").getByRole("button", { name: "Other operation" }).click();
      await expect(page.getByRole("dialog").getByLabel("Operation")).toBeVisible();
    },
  },
  {
    name: "the update value dialog of a fund",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "");
      await page.getByRole("banner").getByRole("button", { name: "Update value" }).click();
      await settledDialog(page);
    },
  },
  {
    // The payslip source of "Cometa": its components, its period, its due date and its note.
    name: "the source dialog, payslip",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Cometa$/, "?tab=settings");
      await page.getByRole("button", { name: "Edit Payslip" }).click();
      await settledDialog(page);
    },
  },
  {
    // A second payslip source on the fund with a debit: every component is held by "Cometa".
    name: "the source dialog, payslip components already taken",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "?tab=settings");
      await page.getByTestId("fund-sources").getByRole("button", { name: "Add source" }).click();
      await page.getByRole("menuitem", { name: "Payslip" }).click();
      await settledDialog(page);
      await expect(page.getByRole("dialog").getByText("Already assigned to “Cometa”").first()).toBeVisible();
    },
  },
  {
    name: "the source dialog, recurring debit",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "?tab=settings");
      await page.getByRole("button", { name: "Edit Recurring debit" }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the fee dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await layoutFund(page, /^Fideuram Master Selection$/, "?tab=settings");
      await page.getByTestId("fund-fees").getByRole("button", { name: "Add fee" }).click();
      await settledDialog(page);
      // "Recurring" shows every field the dialog can have: the mode, the period and what it applies to.
      await page.getByRole("dialog").getByLabel("Type").selectOption({ label: "Recurring" });
      await page.getByRole("dialog").locator("summary").click();
    },
  },
];

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
