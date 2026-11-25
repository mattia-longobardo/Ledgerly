// tests/e2e/connections/plugin-states.spec.ts — the plugins' section of H56 (PERS-615, PERS-619): one
// test per cell of the matrix of PERS-614 — Wallet, Trek and Enable Banking in each of their states —
// on the list, on the plugin's page and on the other pages a plugin leaves something on (§4). The
// users are scripts/seed-e2e/plugins.ts, one per column; `pluginsJourney` is the one that changes.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type SESSIONS, sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

const LIST = "/settings/plugins";
const pageOf = (slug: string) => `${LIST}/${slug}`;
const NAMES = { wallet: "Wallet", trek: "Trek", enablebanking: "Enable Banking" } as const;
type Slug = keyof typeof NAMES;

/** One cell: a plugin of a user, its state on the list and on its page. */
interface Cell {
  session: keyof typeof SESSIONS;
  slug: Slug;
  /** `data-status` of the row and of the page's heading. */
  status: string;
  /** Its word, beside the name. */
  word: string;
  /** The main action of the row, or null when the state asks for nothing. */
  action: string | null;
  /** What else the cell shows on the plugin's page. */
  page?: (page: Page, name: string) => Promise<void>;
}

const row = (page: Page, slug: Slug) => page.locator(`[data-testid="plugin-row"][data-plugin="${slug}"]`);

/** The menu «⋯» of a row: «Open», and «Deactivate…» for any plugin but one off with nothing left. */
async function menuOf(page: Page, slug: Slug): Promise<string[]> {
  const trigger = row(page, slug).getByRole("button", { name: `More actions for ${NAMES[slug]}` });
  await hydrated(trigger);
  await trigger.click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  const items = await page.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  return items;
}

const aboutPage = async (page: Page, name: string) => {
  // «Not active» has a page (defect 9): what it does, and «Activate» — never «Connect» (defect 14).
  await expect(page.getByTestId("plugin-about")).toBeVisible();
  await expect(page.getByRole("button", { name: `Activate ${name}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Connect/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: `Deactivate ${name}` })).toHaveCount(0);
};

const goneAbout = async (page: Page, name: string) => {
  await aboutPage(page, name);
  // A trace of «Deactivate» (defect 10).
  await expect(page.getByText(/Deactivated on /)).toBeVisible();
};

const notConnected = async (page: Page, name: string) => {
  await expect(page.getByRole("region", { name: "Connection" })).toBeVisible();
  await expect(page.getByRole("region", { name: `Deactivate ${name}` })).toContainText("Nothing to convert");
  await expect(page.getByRole("button", { name: `Activate ${name}`, exact: true })).toHaveCount(0);
};

const onPage = async (page: Page, name: string) => {
  await expect(page.getByRole("region", { name: "Connection" })).toBeVisible();
  await expect(page.getByRole("region", { name: `Deactivate ${name}` })).toBeVisible();
  await expect(page.getByTestId("plugin-alert")).toHaveCount(0);
};

/** An error or an action needed is a banner `role="alert"` on top of the page, with its action (§5). */
const alerting = (title: RegExp, action: RegExp) => async (page: Page) => {
  const banner = page.getByTestId("plugin-alert");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toContainText(title);
  await expect(
    banner
      .getByRole("button", { name: action })
      .or(banner.getByRole("link", { name: action }))
      .first(),
  ).toBeVisible();
};

/** «Needs cleanup» (D1 = A): what is left, «Activate» and «Deactivate…», nothing to change (defects 1, 2, 5). */
const cleanup = (left: string[]) => async (page: Page, name: string) => {
  await expect(page.getByTestId("cleanup-leftovers").getByRole("listitem")).toHaveText(left);
  await expect(page.getByRole("button", { name: `Activate ${name}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Deactivate ${name}…` })).toBeVisible();
  for (const section of ["Connection", "Schedule", `${name} categories`, "Accounts"])
    await expect(page.getByRole("region", { name: section, exact: true })).toHaveCount(0);
};

const CELLS: Cell[] = [
  // Never turned on (defects 3, 9, 14).
  ...(["wallet", "trek", "enablebanking"] as const).map((slug): Cell => ({
    session: "pluginsOff",
    slug,
    status: "not_active",
    word: "Not active",
    action: "Activate",
    page: aboutPage,
  })),
  // Turned off with «Deactivate» (defect 10).
  ...(["wallet", "trek", "enablebanking"] as const).map((slug): Cell => ({
    session: "pluginsGone",
    slug,
    status: "not_active",
    word: "Not active",
    action: "Activate",
    page: goneAbout,
  })),
  // On, with nothing yet (defect 3: «Not connected», not «Not active»).
  ...(["wallet", "trek", "enablebanking"] as const).map((slug): Cell => ({
    session: "pluginsOn",
    slug,
    status: "not_connected",
    word: "Not connected",
    action: "Connect",
    page: notConnected,
  })),
  {
    session: "pluginsLive",
    slug: "wallet",
    status: "up_to_date",
    word: "Up to date",
    action: null,
    page: onPage,
  },
  { session: "pluginsLive", slug: "trek", status: "late", word: "Late", action: "Update now", page: onPage },
  {
    session: "pluginsLive",
    slug: "enablebanking",
    status: "reading",
    word: "Reading",
    action: null,
    page: onPage,
  },
  // An error is never hidden behind «On demand only» (defect 4).
  {
    session: "pluginsErrors",
    slug: "wallet",
    status: "error",
    word: "Error",
    action: "Try again",
    page: alerting(/The last reading did not work/, /^Try again$/),
  },
  {
    session: "pluginsErrors",
    slug: "trek",
    status: "error",
    word: "Error",
    action: "Try again",
    page: alerting(/The last reading did not work/, /^Try again$/),
  },
  {
    session: "pluginsErrors",
    slug: "enablebanking",
    status: "action_needed",
    word: "Action needed",
    action: "Renew access",
    page: alerting(/Enable Banking needs you/, /^Renew access$/),
  },
  {
    session: "pluginsMixed",
    slug: "wallet",
    status: "action_needed",
    word: "Action needed",
    action: "Replace key",
    page: alerting(/Wallet needs you/, /^Replace key$/),
  },
  {
    session: "pluginsMixed",
    slug: "trek",
    status: "up_to_date",
    word: "Up to date",
    action: null,
    page: onPage,
  },
  {
    session: "pluginsMixed",
    slug: "enablebanking",
    status: "not_connected",
    word: "Not connected",
    action: "Connect",
  },
  {
    session: "pluginsDisconnected",
    slug: "wallet",
    status: "disconnected",
    word: "Disconnected",
    action: "Reconnect",
    page: async (page) => {
      await expect(page.getByText("Disconnected. The settings stay.")).toBeVisible();
    },
  },
  {
    session: "pluginsDisconnected",
    slug: "trek",
    status: "on_demand",
    word: "On demand only",
    action: "Update now",
    page: onPage,
  },
  {
    session: "pluginsDisconnected",
    slug: "enablebanking",
    status: "disconnected",
    word: "Disconnected",
    action: "Reconnect",
  },
  // «Read only» is not a state: an action, with the reason (PERS-615 §6).
  {
    session: "connections",
    slug: "trek",
    status: "action_needed",
    word: "Action needed",
    action: "Replace key",
    page: alerting(/Trek needs you/, /^Replace key$/),
  },
  {
    session: "connections",
    slug: "wallet",
    status: "on_demand",
    word: "On demand only",
    action: "Update now",
  },
  // Off with data that still depend on it: the case of PERS-614 (defects 1, 2, 5, 9).
  {
    session: "pluginsCleanup",
    slug: "wallet",
    status: "needs_cleanup",
    word: "Needs cleanup",
    action: "Clean up",
    page: cleanup(["1 account", "4 Wallet categories", "2 transactions to send"]),
  },
  {
    session: "pluginsCleanup",
    slug: "trek",
    status: "needs_cleanup",
    word: "Needs cleanup",
    action: "Clean up",
    page: cleanup(["3 days to send"]),
  },
  {
    session: "pluginsCleanup",
    slug: "enablebanking",
    status: "needs_cleanup",
    word: "Needs cleanup",
    action: "Clean up",
    page: cleanup(["1 account"]),
  },
];

for (const cell of CELLS) {
  const name = NAMES[cell.slug];
  test.describe(`${cell.session}: ${name} ${cell.status}`, () => {
    test.use({ storageState: sessionState(cell.session) });

    test("the row and the page say the state, with its action @plugins", async ({ page }) => {
      await page.goto(LIST);
      const one = row(page, cell.slug);
      await test.step("the list: one model, the state in a word, the main action (§3)", async () => {
        await expect(one).toHaveAttribute("data-status", cell.status);
        await expect(one.getByText(cell.word, { exact: true })).toBeVisible();
        // The row is not a link as a whole: the name is (defect 3).
        await expect(one.getByRole("link", { name, exact: true })).toHaveAttribute("href", pageOf(cell.slug));
        const action = one
          .getByRole("button", { name: cell.action ?? "none" })
          .or(one.getByRole("link", { name: cell.action ?? "none", exact: true }));
        if (cell.action === null) await expect(action).toHaveCount(0);
        else await expect(action.first()).toBeVisible();
        const menu = await menuOf(page, cell.slug);
        expect(menu[0]).toBe("Open");
        expect(menu.includes("Deactivate…")).toBe(cell.status !== "not_active");
      });
      await test.step("the page: the same state, and what the state offers (§2)", async () => {
        await page.goto(pageOf(cell.slug));
        await expect(page.getByTestId("source-heading")).toHaveAttribute("data-status", cell.status);
        await expect(page.getByTestId("source-heading").getByText(cell.word, { exact: true })).toBeVisible();
        await cell.page?.(page, name);
      });
    });
  });
}

test.describe("the other pages of a plugin that is off (§4)", () => {
  test.use({ storageState: sessionState("pluginsCleanup") });

  test("an account of Wallet off is «Stopped», with the way to clean it up (defect 7)", async ({ page }) => {
    await page.goto("/accounts");
    // «Stopped since», never «Last synced».
    await expect(page.getByText(/Stopped since /).first()).toBeVisible();
    const link = page.locator('main a[href^="/accounts/"]').filter({ hasText: "Conto corrente app" }).first();
    await page.goto((await link.getAttribute("href")) ?? "");
    const banner = page.getByTestId("account-stopped");
    await expect(banner).toContainText("This account does not update: Wallet is not active");
    await expect(banner.getByRole("link", { name: "Clean up in Wallet" })).toHaveAttribute(
      "href",
      pageOf("wallet"),
    );
    await expect(page.getByText(/Disconnected from/)).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Account sections" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(page.getByText(/Connected through/)).toHaveCount(0);
    await expect(page.getByText(/which is not active: it stopped on/)).toBeVisible();
  });

  test("a movement waiting for Wallet off is «Not sent», and says why", async ({ page }) => {
    await page.goto("/expenses?preset=last3Months");
    const off = page.getByTestId("send-off").first();
    await expect(off).toContainText("Not sent");
    await expect(off).toHaveAttribute("title", "Wallet is not active");
    await expect(page.getByText("To send", { exact: true })).toHaveCount(0);
  });

  test("Wallet off leaves no category to match (defect 2)", async ({ page }) => {
    await page.goto("/settings/finance");
    await expect(page.getByText(/Wallet categories are matched/)).toHaveCount(0);
    await page.goto("/expenses/categories");
    await expect(page.getByText(/^From Wallet:/)).toHaveCount(0);
  });

  test("Time off: the days that wait for Trek off are said once, and no day says «To send» (defects 6, 15)", async ({
    page,
  }) => {
    await page.goto("/timeoff");
    const banner = page.getByTestId("calendar-off");
    await expect(banner).toContainText("3 days wait for Trek, which is not active");
    await expect(banner.getByRole("link", { name: "Clean up in Trek" })).toHaveAttribute(
      "href",
      pageOf("trek"),
    );
    await expect(page.getByText("To send", { exact: true })).toHaveCount(0);
    await page.goto("/timeoff/settings");
    const trek = page.getByTestId("calendar-plugin");
    await expect(trek).toHaveAttribute("data-state", "needs_cleanup");
    await expect(trek.getByRole("link", { name: "Clean up" })).toBeVisible();
  });
});

test.describe("Time off › Settings with Trek never on (defect 15)", () => {
  test.use({ storageState: sessionState("pluginsOff") });

  test("the row of Trek says «Not active» and offers «Activate»", async ({ page }) => {
    await page.goto("/timeoff/settings");
    const trek = page.getByTestId("calendar-plugin");
    await expect(trek).toHaveAttribute("data-state", "not_active");
    await expect(trek).toContainText("Not active");
    await expect(trek.getByRole("button", { name: "Activate" })).toBeVisible();
  });
});

test.describe("one name, one place (D2 = A, defects 11, 13)", () => {
  test.use({ storageState: sessionState("connections") });

  test("Settings › Finance has no block of banks, and the section is «Plugins»", async ({ page }) => {
    await page.goto("/settings/finance");
    await expect(page.getByRole("region", { name: "Banks" })).toHaveCount(0);
    await page.goto(LIST);
    await expect(page.getByRole("region", { name: "Plugins" })).toBeVisible();
    await expect(page.getByText(/Data sources/)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Plugins" }).getByRole("link", { name: "Addons" }),
    ).toHaveAttribute("href", "/settings/addons");
  });
});

test.describe("the journey: out of «Needs cleanup», and a refusal with its cause", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: sessionState("pluginsJourney") });

  async function deactivateFromMenu(page: Page, slug: Slug): Promise<Locator> {
    await page.goto(LIST);
    const trigger = row(page, slug).getByRole("button", { name: `More actions for ${NAMES[slug]}` });
    await hydrated(trigger);
    await trigger.click();
    await page.getByRole("menuitem", { name: "Deactivate…" }).click();
    return page.getByRole("dialog", { name: `Deactivate ${NAMES[slug]}?` });
  }

  test("Wallet: «Deactivate» converts with the true counts, and no word of credentials (defects 1, 12)", async ({
    page,
  }) => {
    const dialog = await deactivateFromMenu(page, "wallet");
    const lines = dialog.getByTestId("deactivate-lines").getByRole("listitem");
    await expect(lines.first()).toHaveText("1 account becomes manual, with the same balance.");
    await expect(dialog).toContainText("4 Wallet categories are deleted.");
    await expect(dialog).toContainText("2 transactions to send stay as manual transactions.");
    await expect(dialog).not.toContainText("credentials");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Deactivate Wallet" }).click();
    await expect(page.getByText("Wallet deactivated: 1 account is now manual")).toBeVisible();
    await expect(row(page, "wallet")).toHaveAttribute("data-status", "not_active");
    await expect(row(page, "wallet").getByTestId("plugin-text")).toContainText("deactivated on");
  });

  test("Trek: «Activate» from «Needs cleanup» turns it on, with its data", async ({ page }) => {
    await page.goto(pageOf("trek"));
    await page.getByRole("button", { name: "Activate Trek", exact: true }).click();
    await expect(page.getByText("Trek activated")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/plugins\/trek\?step=connect$/);
    await expect(page.getByTestId("source-heading")).not.toHaveAttribute("data-status", "needs_cleanup");
    await expect(page.getByRole("region", { name: "Deactivate Trek" })).toBeVisible();
  });

  test("Enable Banking: a reading in progress refuses with its cause, then stops after 15 minutes (defect 8)", async ({
    page,
  }) => {
    const dialog = await deactivateFromMenu(page, "enablebanking");
    await dialog.getByRole("button", { name: "Deactivate Enable Banking" }).click();
    const refusal = page.getByRole("dialog", { name: "Enable Banking cannot be deactivated now" });
    await expect(refusal.getByRole("alert")).toContainText("A reading is in progress");
    await expect(refusal.getByRole("alert")).toContainText(
      /It started at \d{1,2}:\d{2}( [AP]M)?\. Nothing changed\./,
    );
    await refusal.getByRole("button", { name: "Stop the reading and deactivate" }).click();
    // The bank plugin of a preview cannot close a forged access: «Deactivate anyway» (§5), when it says so.
    const down = page.getByRole("dialog", { name: "Enable Banking cannot be deactivated now" });
    const done = page.getByText(/Enable Banking deactivated: /);
    await expect(done.or(down.getByRole("button", { name: "Deactivate anyway" }))).toBeVisible();
    if (await down.getByRole("button", { name: "Deactivate anyway" }).isVisible()) {
      await expect(down.getByRole("alert")).toContainText("Enable Banking does not answer");
      await down.getByRole("button", { name: "Deactivate anyway" }).click();
    }
    await expect(done).toBeVisible();
    await expect(row(page, "enablebanking")).toHaveAttribute("data-status", "not_active");
  });
});
