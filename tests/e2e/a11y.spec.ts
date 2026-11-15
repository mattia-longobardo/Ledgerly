// tests/e2e/a11y.spec.ts — what a screen has to be before it is called done (owner, 2026-09-20,
// widened in F9): at 1440 and at 400 px, in both themes, no WCAG 2.1 A/AA violation, nothing
// reaching past the viewport, no scrollbar nobody asked for, no control too small to hit, and no
// text spilling out of its container. axe-core is injected from `node_modules`, so nothing is
// fetched from a CDN and the check runs against the deployed site like every other spec here.
//
// Every screen of the application is in the list below, and almost all of them are opened as the
// seeded `layout` user, who has something on every page (scripts/seed-e2e.ts): a layout check run
// against an empty state measures an empty state, which is how F8's regression on
// /settings/integrations went unseen until F9 looked at that page as an admin.
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { type SESSIONS, sessionState } from "./env";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

const WIDTHS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 400, height: 860, name: "phone" },
] as const;

type Size = (typeof WIDTHS)[number]["name"];

const THIS_YEAR = new Date().getFullYear();

/** What the Funds pages are also measured at (funds-ux §6): the phone of the design, and a tablet. */
const EVERY_WIDTH = [
  ...WIDTHS,
  { width: 768, height: 1024, name: "tablet" },
  { width: 375, height: 812, name: "small phone" },
] as const;

interface Screen {
  /** What the failure message calls it. */
  name: string;
  /** Which seeded session opens it; `null` signs nobody in. */
  session: keyof typeof SESSIONS | null;
  /** Where to go and what to open once there. */
  open: (page: Page) => Promise<void>;
  /** What to measure, when it is not the page's `<main>` — an open dialog, the mobile bar. */
  roots?: string[];
  /** A screen that only exists at one width: the mobile bar has no desktop, and vice versa. */
  only?: Size;
  /** Measured at the design's four widths and not the usual two. */
  everyWidth?: boolean;
}

// ——— Getting to a screen ———————————————————————————————————————————————————————————————————

/** The page fades in: colours read while `<main>` is transparent are not the page's colours. */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  // A skeleton is a `<main>` too, and it does not fade in: measured, it says nothing about the page.
  await page
    .locator(
      '[data-testid="funds-home-loading"], [data-testid="fund-detail-loading"], [data-testid="fund-wizard-loading"]',
    )
    .first()
    .waitFor({ state: "detached", timeout: 15_000 });
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  await finished(page);
}

/**
 * Whatever is still moving, a shimmer aside. Against a fast server, the opacity above can be read
 * before the fade starts, and axe then reports the contrast of a page half faded in.
 */
async function finished(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.race([
      // A popover's own animation can stay pending while nothing moves: never wait for it for long.
      new Promise((resolve) => setTimeout(resolve, 1_000)),
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    ]),
  );
}

/**
 * An overlay fades and slides in: colours read while its popup is half transparent are the
 * colours of whatever is behind it, and axe reports contrast that the finished dialog does not
 * have. Waits for the popup to come to rest.
 */
async function settledDialog(page: Page): Promise<void> {
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await page
    .waitForFunction(
      () => {
        const popup = document.querySelector('[role="dialog"]');
        if (!popup) return false;
        const style = getComputedStyle(popup);
        return style.opacity === "1" && (style.transform === "none" || !style.transform.includes("matrix("));
      },
      null,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  // Base UI animates with CSS: one more frame after opacity lands, so nothing is still moving.
  await page.waitForTimeout(250);
}

/** Goes to a list and follows the first link on it named `name`: detail ids are never written down. */
async function follow(page: Page, from: string, name: string | RegExp): Promise<void> {
  await page.goto(from);
  await settled(page);
  const link = page.getByRole("link", { name }).filter({ visible: true }).first();
  await expect(link, `no link named ${String(name)} on ${from}`).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  expect(href, `the link named ${String(name)} on ${from} has no href`).toBeTruthy();
  await page.goto(href!);
  await settled(page);
}

/** The same, for a link a name cannot pick out: the Returns card's, one of two "Details". */
async function followLink(page: Page, selector: string): Promise<void> {
  // Lists are drawn twice — a table from `md` up, cards below — so only the shown copy counts.
  const link = page.locator(selector).filter({ visible: true }).first();
  await expect(link, `no link matching ${selector} on ${page.url()}`).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  expect(href, `the link matching ${selector} has no href`).toBeTruthy();
  await page.goto(href!);
  await settled(page);
}

/** A page's tab, by the query the LinkTabs write: `?tab=…` on the page already open. */
async function openTab(page: Page, tab: string): Promise<void> {
  const url = new URL(page.url());
  url.searchParams.set("tab", tab);
  await page.goto(url.toString());
  await settled(page);
}

/** A service's tab (docs/design/investments-ux.md §1.1): a route of its own under the service. */
async function serviceTab(page: Page, service: string, tab: "" | "positions" | "activity" | "connection") {
  // The exact name: the home's alert link names the service too, and opens its Connection tab.
  await follow(page, "/investments", new RegExp(`^${service}$`));
  if (tab === "") return;
  const url = new URL(page.url());
  url.pathname = `${url.pathname}/${tab}`;
  await page.goto(url.toString());
  await settled(page);
}

/** A command of a service's `⋯` menu (§3.2), then the item. */
async function headerCommand(page: Page, menu: "More actions", item: string) {
  await page.getByRole("button", { name: menu }).first().click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

const go = (path: string) => async (page: Page) => {
  await page.goto(path);
  await settled(page);
};

type FundFormStep = "fund" | "sources" | "fees" | "review";

/**
 * The form "Add pension fund" at one of its four steps (release N6). A step past the first is only
 * reached with the first one filled in, so each is walked to; and every step is filled with what
 * makes it worth measuring: a value with its date, the three sources with all their fields, two
 * fees. `layout` already has a fund fed by the payslip, so the components carry their long note.
 */
async function fundForm(page: Page, step: FundFormStep): Promise<void> {
  await page.goto("/funds/new");
  await settled(page);
  const form = page.getByTestId("fund-wizard");
  const card = (name: FundFormStep) => page.getByTestId(`wizard-step-${name}`);
  // A step changes the address, and the page's title is streamed again with it: for an instant the
  // document has none. The screen is measured at rest, with its title back.
  const atRest = async () => {
    await expect(page).toHaveTitle(/\S/);
    await finished(page);
  };
  await form.getByLabel("Name").fill("Fondo Pensione Complementare Gamma");
  await form.getByLabel("Provider").fill("Esempio Previdenza");
  await form.getByLabel("Line or compartment").fill("Bilanciata");
  await form.getByLabel("Member since").fill(`${THIS_YEAR - 1}-03-01`);
  await form.getByLabel("Value today").fill("1200");
  if (step === "fund") {
    await card("fund").locator("summary").click();
    await atRest();
    return;
  }
  await card("fund").getByRole("button", { name: "Continue" }).click();
  await expect(card("sources")).toBeVisible();
  await page.getByTestId("source-switch-payroll").click();
  await card("sources").getByRole("switch", { name: "The transfer has a due date" }).click();
  await card("sources").getByLabel("Due day").fill("20");
  await page.getByTestId("source-switch-bank_debit").click();
  await card("sources").getByLabel("Expected amount").fill("100");
  await card("sources").getByLabel("Debit day").fill("5");
  await page.getByTestId("source-switch-manual").click();
  if (step === "sources") {
    await atRest();
    return;
  }
  // `layout`'s payslip already feeds "Cometa": with no component left to choose, the step goes on
  // without that source.
  await page.getByTestId("source-switch-payroll").click();
  await card("sources").getByRole("button", { name: "Continue" }).click();
  await expect(card("fees")).toBeVisible();
  for (const [name, type, value] of [
    ["Quota associativa", "Recurring", "12"],
    ["Gestione", "On assets", "0,45"],
  ] as const) {
    await card("fees").getByRole("button", { name: "Add fee" }).click();
    const dialog = page.getByRole("dialog", { name: "Add fee" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Type").selectOption({ label: type });
    await dialog.getByLabel("Value").fill(value);
    await dialog.getByRole("button", { name: "Save fee" }).click();
    await expect(dialog).toBeHidden();
  }
  if (step === "fees") {
    await atRest();
    return;
  }
  await card("fees").getByRole("button", { name: "Continue" }).click();
  await expect(card("review")).toBeVisible();
  await atRest();
}

/** A tab of one of `layout`'s two funds: "Cometa", fed by the payslip, and "Fideuram…", with a debit. */
async function layoutFund(page: Page, fund: RegExp, query: string): Promise<void> {
  await follow(page, "/funds", fund);
  await page.goto(`${new URL(page.url()).pathname}${query}`);
  await settled(page);
}

// ——— The screens ———————————————————————————————————————————————————————————————————————————

const PAGES: Screen[] = [
  { name: "/", session: "layout", open: go("/") },
  { name: "/accounts", session: "layout", open: go("/accounts") },
  { name: "/accounts/new", session: "layout", open: go("/accounts/new") },
  {
    name: "/accounts/[id]",
    session: "layout",
    open: (page) => follow(page, "/accounts", "ING Conto Arancio"),
  },
  // A page's tabs are screens of their own: the widest tables of the app live on them, and a tab
  // nobody opens is a tab nobody measures.
  ...(["transactions", "entries", "settings"] as const).map((tab) => ({
    name: `/accounts/[id]?tab=${tab}`,
    session: "layout" as const,
    open: async (page: Page) => {
      await follow(page, "/accounts", "ING Conto Arancio");
      await openTab(page, tab);
    },
  })),
  { name: "/expenses", session: "layout", open: go("/expenses") },
  { name: "/budgets", session: "layout", open: go("/budgets") },
  {
    name: "/budgets/[id]",
    session: "layout",
    open: (page) => follow(page, "/budgets", "Spesa"),
  },
  { name: "/pockets", session: "layout", open: go("/pockets") },
  {
    name: "/pockets/[id] (on an account)",
    session: "layout",
    open: (page) => follow(page, "/pockets", "Holidays"),
  },
  {
    name: "/pockets/[id] (standalone)",
    session: "layout",
    open: (page) => follow(page, "/pockets", "Gifts"),
  },
  { name: "/subscriptions", session: "layout", open: go("/subscriptions") },
  { name: "/interests", session: "layout", open: go("/interests") },
  {
    name: "/interests/[id]",
    session: "layout",
    open: (page) => follow(page, "/interests", "Revolut Saving"),
  },
  { name: "/funds", session: "layout", open: go("/funds"), everyWidth: true },
  // The form "Add pension fund" (release N6), at each of its four steps.
  ...(["fund", "sources", "fees", "review"] as const).map((step): Screen => ({
    name: `/funds/new?step=${step}`,
    session: "layout",
    open: (page) => fundForm(page, step),
    everyWidth: true,
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
    everyWidth: true,
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
    everyWidth: true,
  })),
  ...(["PAC Piano", "Pensione Beta"] as const).flatMap((fund) =>
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
      everyWidth: true,
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
    everyWidth: true,
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
      everyWidth: true,
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
    everyWidth: true,
  })),
  { name: "/investments", session: "layout", open: go("/investments") },
  {
    name: "/investments · All, the value chart, by class",
    session: "layout",
    open: go("/investments?preset=all&view=value&by=class"),
  },
  { name: "/investments/catalog", session: "layout", open: go("/investments/catalog") },
  // The tabs of a service (§3.2–§3.6, U3): the three of the two manual accounts, which keep no
  // positions (PERS-335), and the four of the two connected ones.
  ...(
    [
      ["Directa", "a manual account typed by hand", false],
      ["Fineco Conto Deposito", "a manual account Wallet reads", false],
      ["eToro", "synced with eToro", true],
      ["Binance", "synced with Binance", true],
    ] as const
  ).flatMap(([service, what, positions]) =>
    (positions
      ? (["", "positions", "activity", "connection"] as const)
      : (["", "activity", "connection"] as const)
    ).map((tab) => ({
      name: `/investments/[accountId]${tab ? `/${tab}` : ""}, ${what}`,
      session: "layout" as const,
      open: (page: Page) => serviceTab(page, service, tab),
    })),
  ),
  // The closed positions of Positions (§3.4, U4): in the period and ever, of a synced service.
  ...(["closed", "all"] as const).map((status) => ({
    name: `/investments/[accountId]/positions?status=${status}, synced with eToro`,
    session: "layout" as const,
    open: async (page: Page) => {
      await serviceTab(page, "eToro", "positions");
      const url = new URL(page.url());
      url.searchParams.set("period", "all");
      url.searchParams.set("status", status);
      await page.goto(url.toString());
      await settled(page);
    },
  })),
  {
    name: "/investments/[accountId]/positions?by=class, synced with eToro",
    session: "layout",
    open: async (page: Page) => {
      await serviceTab(page, "eToro", "positions");
      const url = new URL(page.url());
      url.searchParams.set("by", "class");
      await page.goto(url.toString());
      await settled(page);
    },
  },
  { name: "/payroll", session: "layout", open: go("/payroll") },
  {
    name: "/payroll/[id]",
    session: "layout",
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      // Not `…/original`, which is the stored PDF and starts a download rather than a page.
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
    },
  },
  { name: "/timeoff", session: "layout", open: go("/timeoff") },
  { name: "/timeoff/settings", session: "layout", open: go("/timeoff/settings") },
  {
    // A range with its first day chosen: the preview under the pointer and the bar (rewrite plan N5).
    name: "/timeoff, a range in progress",
    session: "layout",
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      const free = page.locator('[data-month="3"] [data-testid="free-cell"]');
      await free.nth(0).click();
      await free.nth(6).hover();
      await expect(page.getByTestId("selection-bar")).toBeVisible();
      await finished(page);
    },
  },
  { name: "/payroll/settings", session: "layout", open: go("/payroll/settings") },
  { name: "/settings/profile", session: "layout", open: go("/settings/profile") },
  { name: "/settings/security", session: "layout", open: go("/settings/security") },
  { name: "/settings/categories", session: "layout", open: go("/settings/categories") },
  { name: "/settings/data", session: "layout", open: go("/settings/data") },
  { name: "/settings/integrations", session: "layout", open: go("/settings/integrations") },
  // Release N1: the layout user has the bank plugin on with nothing saved, so the page above has
  // the plugin's row "Active" and the section "Banks" on its guide; the admin's has "Not active".
  // The procedure, for the same user, stops at its guard.
  { name: "/banks/connect (no credentials)", session: "layout", open: go("/banks/connect") },

  // Admin. For anybody else Users and Server answer 404, which is the point of them; Integrations
  // answers for everybody but shows the jobs card only here — the page F8 broke and F9 found.
  { name: "/settings/users (admin)", session: "admin", open: go("/settings/users") },
  { name: "/settings/server (admin)", session: "admin", open: go("/settings/server") },
  {
    name: "/settings/integrations (admin)",
    session: "admin",
    open: go("/settings/integrations"),
  },

  // Signed out.
  { name: "/sign-in", session: null, open: go("/sign-in") },
  { name: "/forgot-password", session: null, open: go("/forgot-password") },
  { name: "/sign-in/two-factor", session: null, open: go("/sign-in/two-factor") },
  { name: "/privacy", session: null, open: go("/privacy") },
  { name: "/terms", session: null, open: go("/terms?lang=it") },

  // TOTP setup (docs/auth-design.md D2): a seeded password user who has not set it up yet.
  { name: "/sign-in/two-factor/setup", session: "pending", open: go("/sign-in/two-factor/setup") },
];

/** Overlays: they live in a portal, outside `<main>`, so each says what to measure. */
const OVERLAYS: Screen[] = [
  {
    // Release N1: the credentials of the bank plugin, on the layout user (plugin on, nothing saved).
    name: "the bank credentials dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/integrations");
      await settled(page);
      await page.getByRole("button", { name: /Enter credentials|Inserisci credenziali/ }).click();
      await settledDialog(page);
    },
  },
  {
    // The sync schedule of the layout user's Trek link (seeded on manual only).
    name: "the sync schedule dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/integrations");
      await settled(page);
      // The first control is Trek's; the seeded eToro link has one too, further down.
      await page
        .getByRole("button", { name: /Change the sync schedule|Cambia l'orario di sincronizzazione/ })
        .first()
        .click();
      await settledDialog(page);
    },
  },
  {
    // The same dialog with something in it: a preset, a second rule in cron, and the preview.
    name: "the sync schedule dialog, with rules",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/settings/integrations");
      await settled(page);
      // The first control is Trek's; the seeded eToro link has one too, further down.
      await page
        .getByRole("button", { name: /Change the sync schedule|Cambia l'orario di sincronizzazione/ })
        .first()
        .click();
      await settledDialog(page);
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Custom rules|Regole personalizzate/ }).check();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByRole("button", { name: /Add a rule|Aggiungi una regola/ }).click();
      await dialog.getByLabel(/Kind of rule 3|Tipo della regola 3/).selectOption("cron");
      await dialog
        .getByLabel(/Days$|Giorni$/)
        .nth(1)
        .selectOption("monthDays");
    },
  },
  {
    // The leave panel on a range that crosses a weekend, so the summary has every kind of line.
    name: "the leave panel, a new range",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      const free = page.locator('[data-month="3"] [data-testid="free-cell"]');
      await free.nth(0).click();
      await free.nth(6).click();
      await settledDialog(page);
    },
  },
  {
    // The same panel on a booked day: the row's badges, Remove, and the residual of an edit.
    name: "the leave panel, a booked day",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/timeoff");
      await settled(page);
      await page.getByTestId("leave-cell").first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the command palette",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
      await page.keyboard.press("Control+k");
      await settledDialog(page);
    },
  },
  {
    name: "the mobile navigation bar",
    session: "layout",
    only: "phone",
    roots: ['nav[class*="fixed"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
    },
  },
  {
    name: "the mobile More sheet",
    session: "layout",
    only: "phone",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
      await page.getByRole("button", { name: /More|Altro/ }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the new account dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/pockets");
      await settled(page);
      await page
        .getByRole("button", { name: /Add pocket|New pocket|Aggiungi/ })
        .first()
        .click();
      await settledDialog(page);
    },
  },
  {
    name: "the rename payslip dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/payroll");
      await settled(page);
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"]):not([href$="/settings"])');
      await page.getByRole("button", { name: /^(Rename|Rinomina)$/ }).click();
      await settledDialog(page);
    },
  },
  {
    name: "the period picker of Investments",
    session: "layout",
    open: async (page) => {
      await page.goto("/investments?from=2026-01-01&to=2026-06-30");
      await settled(page);
      await page.locator('summary[title="Date range"]').click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "the add manual account dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/investments/catalog");
      await settled(page);
      await page.getByRole("button", { name: "Add manual account" }).first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the update value dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^Directa$/);
      await page.getByRole("button", { name: "Update value" }).first().click();
      await settledDialog(page);
    },
  },
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
  {
    name: "the connect eToro dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/investments/catalog");
      await settled(page);
      await page.getByRole("button", { name: "Connect", exact: true }).first().click();
      await settledDialog(page);
    },
  },
  {
    name: "the connect Binance dialog",
    session: "admin",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/investments/catalog");
      await settled(page);
      await page
        .getByTestId("catalog-card")
        .filter({ hasText: "Binance" })
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await settledDialog(page);
    },
  },
  {
    name: "the replace key dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await follow(page, "/investments", /^eToro$/);
      await headerCommand(page, "More actions", "Replace key");
      await settledDialog(page);
    },
  },
  {
    name: "the disconnect dialog",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await serviceTab(page, "eToro", "connection");
      await page.getByRole("button", { name: "Disconnect", exact: true }).first().click();
      await settledDialog(page);
    },
  },
];

// ——— The five rules ————————————————————————————————————————————————————————————————————————

interface AxeViolation {
  id: string;
  impact: string;
  nodes: number;
  html: string;
}

/**
 * `roots` scopes the run: a whole page answers for its sidebar and topbar too, while an overlay
 * answers for itself — reporting the page behind it would blame the dialog for the page's faults.
 */
async function violationsOf(page: Page, roots?: readonly string[]): Promise<AxeViolation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async (include) => {
      const result = await (
        window as unknown as {
          axe: {
            run: (
              root: Document,
              options: unknown,
            ) => Promise<{
              violations: { id: string; impact: string | null; nodes: { html: string }[] }[];
            }>;
          };
        }
      ).axe.run((include === null ? document : { include: include.map((one) => [one]) }) as Document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? "",
        nodes: violation.nodes.length,
        html: violation.nodes[0]?.html.replace(/\s+/g, " ").slice(0, 100) ?? "",
      }));
    },
    roots === undefined ? null : [...roots],
  );
}

/**
 * What sticks out of the window, what scrolls sideways, what is too small to press, and what
 * spills out of its own box. The fifth rule is F9's (plan §3.3): the owner described it as "text
 * coming out of divs", and it is different from deliberate truncation, which is `overflow: hidden`
 * and stays legitimate.
 *
 * A table inside an `overflow-x-auto` container is not an exception to the first rule: the
 * container clips the picture, not the position, and a column 147 px past the edge stays out of
 * reach on a phone. Where a table does not fit, the answer is the one `funds` and `users` already
 * give — a table from `md` up, a list below, with the same commands in both.
 */
async function layoutFaults(page: Page, roots: readonly string[]): Promise<string[]> {
  return page.evaluate(
    (selectors) => {
      const scopes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
      if (scopes.length === 0) return [`nothing matching ${selectors.join(", ")}`];
      const visible = (element: Element) => element.checkVisibility?.({ visibilityProperty: true }) ?? true;
      const faults: string[] = [];
      const within = (selector: string) => scopes.flatMap((scope) => [...scope.querySelectorAll(selector)]);
      const label = (element: Element) =>
        (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

      // 1. The page itself does not scroll sideways.
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      if (overflow > 0) faults.push(`the page scrolls sideways by ${overflow}px`);

      // 2. Nothing reaches past the window.
      const past = within("*").filter((element) => {
        if (!visible(element)) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > window.innerWidth + 1;
      });
      // Only the innermost: a parent is wide because its child is.
      for (const element of past.filter(
        (one) => !past.some((other) => other !== one && one.contains(other)),
      )) {
        const box = element.getBoundingClientRect();
        faults.push(
          `${element.tagName.toLowerCase()} reaches ${Math.round(box.right - window.innerWidth)}px past the window · ${label(element)}`,
        );
      }

      // 3. No horizontal scrollbar nobody asked for.
      for (const element of within("*")) {
        if (!visible(element) || element.classList.contains("sr-only")) continue;
        const style = getComputedStyle(element);
        // `hidden` is how this app truncates text on purpose; a real scrollbar is `auto` or `scroll`.
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          (style.overflowX === "auto" || style.overflowX === "scroll")
        ) {
          if (element.querySelector("table") === null) {
            faults.push(
              `${element.tagName.toLowerCase()} scrolls sideways inside the page · ${label(element)}`,
            );
          }
        }
      }

      // 4. Every target is at least 24×24 px — except a link sitting inside a run of text, which
      //    WCAG 2.2 §2.5.8 excludes because enlarging it would break the line around it (plan §3.4).
      const inlineLink = (element: Element) => {
        if (element.tagName !== "A") return false;
        const parent = element.parentElement;
        if (!parent) return false;
        const around = [...parent.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        return around !== "";
      };
      for (const element of within("button, a[href], input, select")) {
        if (!visible(element) || inlineLink(element)) continue;
        // A checkbox or radio inside its own label is pressed by the whole label: the box is 14 px
        // by design, and measuring it instead of what the finger lands on flags a phantom.
        const target = element.closest("label") ?? element;
        const box = target.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.height < 24 || box.width < 24) {
          const name = (element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 30);
          faults.push(
            `${element.tagName.toLowerCase()} "${name}" is ${Math.round(box.width)}×${Math.round(box.height)}, under 24px`,
          );
        }
      }

      // 5. No text spills out of its container (plan §3.3): a leaf with `overflow-x: visible` whose
      //    content is wider than its box. `hidden` is deliberate truncation and `auto` is rule 3.
      for (const element of within("*")) {
        if (!visible(element) || element.children.length > 0) continue;
        if ((element.textContent ?? "").trim() === "") continue;
        const style = getComputedStyle(element);
        if (style.overflowX !== "visible") continue;
        // An inline box has no box of its own to spill out of; its block parent answers for it.
        if (style.display === "inline" || style.display === "contents") continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          faults.push(
            `${element.tagName.toLowerCase()} spills ${element.scrollWidth - element.clientWidth}px out of its box · ${label(element)}`,
          );
        }
      }
      return faults;
    },
    [...roots],
  );
}

/** The app reads the theme off `<html data-theme>`; both are checked, because contrast is a colour. */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

// ——— The run ———————————————————————————————————————————————————————————————————————————————

function audit(screens: readonly Screen[]): void {
  const sessions = [...new Set(screens.map((screen) => screen.session))];
  for (const session of sessions) {
    test.describe(session === null ? "signed out" : `as ${session}`, () => {
      if (session !== null) test.use({ storageState: sessionState(session) });
      else test.use({ storageState: { cookies: [], origins: [] } });

      for (const screen of screens.filter((one) => one.session === session)) {
        for (const { width, height, name: size } of screen.everyWidth ? EVERY_WIDTH : WIDTHS) {
          if (screen.only !== undefined && screen.only !== size) continue;
          test(`${screen.name} at ${size} width`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await setTheme(page, "light");
            await screen.open(page);
            await setTheme(page, "light");
            await finished(page);

            // One assertion for all four answers rather than four in a row: a screen that fails
            // its layout would otherwise never be put in front of axe, and the run would report
            // half of what it measured.
            const roots = screen.roots ?? ["main"];
            const layout = await layoutFaults(page, roots);
            const scope = screen.roots === undefined ? undefined : roots;
            const light = await violationsOf(page, scope);
            await setTheme(page, "dark");
            await finished(page);
            const dark = await violationsOf(page, scope);
            expect({ layout, light, dark }, `${screen.name} at ${width}px`).toEqual({
              layout: [],
              light: [],
              dark: [],
            });
          });
        }
      }
    });
  }
}

test.describe("every screen", () => audit(PAGES));
test.describe("every overlay", () => audit(OVERLAYS));
