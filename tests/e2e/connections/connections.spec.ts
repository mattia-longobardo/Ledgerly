// tests/e2e/connections/connections.spec.ts — the state of the connections (rewrite plan N2;
// ux/n2-connection-status.md): one row for every connection with one state of five, the history,
// "Advanced" with the schedule, the log and the report, and who can read whose log.
//
// The `connections` user is seeded with a connection in each state (scripts/seed-e2e.ts). Nothing
// here starts a reading: the credentials of that user are not credentials.
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

const INTEGRATIONS = "/settings/integrations";
const ADVANCED = "/settings/integrations/advanced";

/** The words the normal view never shows (criterion 1 of N2; ux §1.2). */
const TECHNICAL = /\b(plugin|sync|synchroni[sz]ation|token|session|job|run|API|HTTP|429|cron|log)\b/i;
const CODES = /auth\b|consent_expired|rate_limited|provider_down|invalid_data/;

// The seed dates the good readings from its own clock (scripts/seed-e2e.ts): 2 hours before it for
// the banks up to date, 26 hours before it for the late one. Before 02:00 in Rome both instants fall
// one day earlier, and the page says them with a day, not with hours: the sentences expected here
// follow the same clock, so the file passes at any time of day.
const HOUR_IN_ROME = Number(
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(
    new Date(),
  ),
);
const AFTER_TWO = HOUR_IN_ROME >= 2;
const UPDATED_TWO_HOURS_AGO = AFTER_TWO ? "Updated 2 hours ago" : "Updated yesterday at ";
const UP_TO_DATE = AFTER_TWO ? /^Updated 2 hours ago$/ : /^Updated yesterday at \d\d:\d\d$/;
const LATE = AFTER_TWO
  ? /^Last update yesterday at \d\d:\d\d\. Next attempt /
  : /^Last update on .+ at \d\d:\d\d\. Next attempt /;

const row = (page: Page, name: string) =>
  page.getByTestId("connection-row").filter({ has: page.getByText(name, { exact: true }) });

test.describe("the rows of the connections", () => {
  test.use({ storageState: sessionState("connectionsJourney") });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 400, height: 860 },
  ]) {
    // One theme: a theme changes colours only, and this test reads none.
    test(`one row per connection, each in its state, at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(INTEGRATIONS);
      const banks = page.getByRole("region", { name: "Banks" });

      await test.step("every state is a word beside the name, with its sentence", async () => {
        const expected: [string, string, string, RegExp][] = [
          ["Alfa Bank", "ok", "Up to date", UP_TO_DATE],
          ["Beta Bank", "late", "Delayed", LATE],
          ["Gamma Bank", "action", "Action needed", /^Access to Gamma Bank has expired\.$/],
          ["Delta Bank", "running", "In progress", /^Update in progress…$/],
          ["Epsilon Bank", "ok", "Up to date", UP_TO_DATE],
          [
            "Zeta Bank",
            "action",
            "Action needed",
            /^You gave access, but you have not chosen the accounts yet\.$/,
          ],
          ["Trek", "paused", "Paused", /^Automatic update is off\.$/],
        ];
        for (const [name, value, word, sentence] of expected) {
          const one = row(page, name);
          await expect(one, name).toHaveAttribute("data-status", value);
          // The word beside the name: the history, closed, has the words of its readings too.
          await expect(one.getByText(word, { exact: true }).first(), name).toBeVisible();
          await expect(one.getByText(sentence).first(), name).toBeVisible();
        }
      });

      await test.step("the banks are in order of name, whatever their state", async () => {
        const names = await banks.getByTestId("bank-row").locator(".font-semibold").allTextContents();
        expect(names).toEqual([
          "Alfa Bank",
          "Beta Bank",
          "Delta Bank",
          "Epsilon Bank",
          "Gamma Bank",
          "Zeta Bank",
        ]);
      });

      await test.step("one action when something has to be done, none when nothing has", async () => {
        await expect(row(page, "Beta Bank").getByRole("button", { name: "Update now" })).toBeVisible();
        await expect(row(page, "Gamma Bank").getByRole("link", { name: "Renew access" })).toHaveAttribute(
          "href",
          /\/banks\/connect\?renew=/,
        );
        await expect(row(page, "Zeta Bank").getByRole("link", { name: "Choose accounts" })).toBeVisible();
        await expect(row(page, "Trek").getByRole("button", { name: "Turn on again" })).toBeVisible();
        for (const name of ["Alfa Bank", "Delta Bank"]) {
          await expect(row(page, name).getByRole("button", { name: "Update now" })).toHaveCount(0);
        }
      });

      await test.step("an access about to end is said under the row, with the way to renew it", async () => {
        const notice = row(page, "Epsilon Bank").getByRole("status");
        await expect(notice).toContainText(/Access to Epsilon Bank expires in 1[12] days\./);
        await expect(notice.getByRole("button", { name: "Renew access" })).toBeVisible();
      });

      await test.step("nothing reaches past the window", async () => {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });

      await test.step("no technical word and no code in the normal view", async () => {
        for (const toggle of await page.getByRole("button", { name: "History", exact: true }).all()) {
          await toggle.click();
        }
        const texts = await page.getByTestId("connection-row").allInnerTexts();
        expect(texts.length).toBeGreaterThanOrEqual(7);
        for (const text of texts) {
          expect(text).not.toMatch(TECHNICAL);
          expect(text).not.toMatch(CODES);
        }
      });
    });
  }

  test("the history opens with the keyboard, shows ten readings and leads to all of them", async ({
    page,
  }) => {
    await page.goto(INTEGRATIONS);
    const alfa = row(page, "Alfa Bank");
    const toggle = alfa.getByRole("button", { name: "History", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = alfa.getByRole("list", { name: "History of Alfa Bank" });
    await expect(list.getByRole("listitem")).toHaveCount(10);
    await expect(list.getByRole("listitem").first()).toContainText("Successful");
    await expect(list.getByRole("listitem").first()).toContainText(
      "12 new transactions · 1 transaction updated",
    );
    await expect(list.getByRole("listitem").nth(1)).toContainText("Nothing new · started by you");
    await expect(alfa.getByRole("link", { name: "All readings in Advanced" })).toHaveAttribute(
      "href",
      /\/settings\/integrations\/advanced\?c=/,
    );
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // A failed reading says why in the fixed sentence of its code.
    const beta = row(page, "Beta Bank");
    await beta.getByRole("button", { name: "History", exact: true }).click();
    await expect(beta.getByRole("listitem").first()).toContainText("Failed");
    await expect(beta.getByRole("listitem").first()).toContainText("Beta Bank is not responding.");
  });

  test("the menu of a row walks with the arrows and opens Advanced on that connection", async ({ page }) => {
    await page.goto(INTEGRATIONS);
    const alfa = row(page, "Alfa Bank");
    await alfa.getByRole("button", { name: "Alfa Bank" }).focus();
    await page.keyboard.press("Enter");
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText(["Update now", "Renew access", "Replace key", "Advanced", "Disconnect"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(alfa.getByRole("button", { name: "Alfa Bank" })).toBeFocused();

    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Advanced" }).click();
    await expect(page).toHaveURL(/\/settings\/integrations\/advanced\?c=[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Connection")).toHaveValue(/[0-9a-f-]{36}/);
  });

  test("a second bank can be connected: the procedure opens with a bank already there", async ({ page }) => {
    await page.goto(INTEGRATIONS);
    const banks = page.getByRole("region", { name: "Banks" });
    await expect(banks.getByTestId("bank-row")).toHaveCount(6);
    await expect(banks.getByText("For now you can connect one bank only.")).toHaveCount(0);
    await banks.getByRole("link", { name: "Connect a bank" }).click();
    // Until N1 a person with a bank was sent back to the settings.
    await expect(page).toHaveURL(/\/banks\/connect$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Advanced: the schedule of each connection, the log with its filter, and the report", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(INTEGRATIONS);
    await page.getByRole("link", { name: /^Advanced/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ADVANCED}$`));

    await test.step("the schedule: fixed for a bank, a control for the others, off where it is off", async () => {
      const schedule = page.getByTestId("schedule-row");
      await expect(schedule.filter({ hasText: "Alfa Bank" })).toContainText(/3 times a day · Next: /);
      await expect(schedule.filter({ hasText: "Zeta Bank" })).toContainText("Automatic update is off");
      await expect(
        schedule.filter({ hasText: "Trek" }).getByRole("button", { name: /schedule/i }),
      ).toBeVisible();
      await expect(
        schedule.filter({ hasText: "Alfa Bank" }).getByRole("button", { name: /schedule/i }),
      ).toHaveCount(0);
    });

    const log = page.getByRole("region", { name: "Log" });
    await test.step("the log has the technical columns, and the code of a failure", async () => {
      await expect(log.getByRole("columnheader")).toHaveText([
        "Started",
        "Connection",
        "Data",
        "Origin",
        "Result",
        "Code",
        "HTTP",
        "Counts",
        "Version",
      ]);
      const failed = log
        .getByRole("row")
        .filter({ hasText: "Beta Bank" })
        .filter({ hasText: "Failed" })
        .first();
      await expect(failed).toContainText("provider_down");
      await expect(failed).toContainText("503");
      await expect(failed).toContainText("Automatic");
    });

    await test.step("the filter is a navigation, and keeps to one connection", async () => {
      await log.getByLabel("Connection").selectOption({ label: "Beta Bank" });
      await log.getByRole("button", { name: "Filter" }).click();
      await expect(page).toHaveURL(/advanced\?c=[0-9a-f-]{36}#log$/);
      // The header and the three readings of that bank.
      await expect(log.getByRole("row")).toHaveCount(4);
      for (const line of await log.getByRole("row").allInnerTexts()) expect(line).not.toContain("Alfa Bank");
    });

    await test.step("the report is plain lines from a closed list of fields", async () => {
      // "Filter" loads the page again: the button is drawn before it answers, and a click in
      // between copies nothing (seen with four workers, 70 ms after the page came).
      await hydrated(log.getByRole("button", { name: "Copy report" }));
      await log.getByRole("button", { name: "Copy report" }).click();
      await expect(log.getByRole("button", { name: "Copied" })).toBeVisible();
      const report = await page.evaluate(() => navigator.clipboard.readText());
      const lines = report.trimEnd().split("\n");
      expect(lines[0]).toMatch(/^Ledgerly \d+\.\d+\.\d+ · \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(lines[1]).toBe("connection: Beta Bank (plugin:enablebanking)");
      expect(lines[2]).toBe("status: late · code: provider_down · failures: 2");
      expect(lines[3]).toMatch(/^last_ok: \S+Z · next: \S+Z$/);
      expect(lines[4]).toBe("schedule: 3 per day");
      expect(lines[5]).toBe("runs (last 3):");
      expect(lines[6]).toMatch(/^\S+Z transactions auto failed 4s provider_down http=503 ve2e$/);
      expect(lines).toHaveLength(9);
      expect(report).not.toMatch(/e2e-not-a|connections@example\.test|current account|stable/);
    });
  });

  test("an account that comes from a connection says the connection's state on its page", async ({
    page,
  }) => {
    await page.goto("/accounts");
    await page
      .getByRole("link", { name: /Alfa Bank current account/ })
      .first()
      .click();
    const status = page.getByTestId("connection-status");
    await expect(status).toHaveAttribute("data-status", "ok");
    await expect(status).toContainText("Up to date");
    await expect(status).toContainText(UPDATED_TWO_HOURS_AGO);
  });

  test("a plugin turned off keeps its connections in sight, paused, with the way to turn it on", async ({
    page,
  }) => {
    await page.goto(INTEGRATIONS);
    const plugin = page.locator('[data-testid="plugin-row"][data-plugin="enablebanking"]');
    await plugin.getByRole("button", { name: "Enable Banking" }).click();
    await page.getByRole("menuitem", { name: "Turn off" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Turn off" }).click();
    await expect(plugin).toHaveAttribute("data-state", "paused");
    await expect(page.getByRole("region", { name: "Banks" })).toHaveCount(0);

    // Every connection of the plugin is "Paused": no warning, no reading, the history still there.
    const rows = page.getByTestId("connection-row").filter({ hasText: "Enable Banking is not active." });
    await expect(rows).toHaveCount(6);
    for (const one of await rows.all()) {
      await expect(one).toHaveAttribute("data-status", "paused");
      await expect(one.getByRole("button", { name: "Turn on", exact: true })).toBeVisible();
      await expect(one.getByRole("status")).toHaveCount(0);
    }
    await row(page, "Gamma Bank").getByRole("button", { name: "Gamma Bank" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Advanced"]);
    await page.keyboard.press("Escape");

    // The account's page says the same thing (decision Q3).
    await page.goto("/accounts");
    await page
      .getByRole("link", { name: /Alfa Bank current account/ })
      .first()
      .click();
    const status = page.getByTestId("connection-status");
    await expect(status).toHaveAttribute("data-status", "paused");
    await expect(status).toContainText("Enable Banking is not active.");

    // Turned on again from the plugin's own entry, which starts no reading by itself.
    await page.goto(INTEGRATIONS);
    await plugin.getByRole("button", { name: "Turn on" }).click();
    await expect(plugin).toHaveAttribute("data-state", "active");
    await expect(page.getByRole("region", { name: "Banks" }).getByTestId("bank-row")).toHaveCount(6);
  });
});

test.describe("whose log it is", () => {
  test("another person, an admin included, does not reach the log of a connection", async ({ browser }) => {
    const owner = await browser.newContext({ storageState: sessionState("connectionsJourney") });
    const page = await owner.newPage();
    await page.goto(INTEGRATIONS);
    await page
      .getByTestId("connection-row")
      .filter({ hasText: "Beta Bank" })
      .getByRole("button", { name: "Beta Bank" })
      .click();
    await page.getByRole("menuitem", { name: "Advanced" }).click();
    await expect(page).toHaveURL(/advanced\?c=/);
    const address = new URL(page.url());
    await expect(page.getByRole("region", { name: "Log" }).getByRole("row")).toHaveCount(4);
    await owner.close();

    for (const session of ["pockets", "admin"] as const) {
      const context = await browser.newContext({ storageState: sessionState(session) });
      const other = await context.newPage();
      // The connection of somebody else is a connection that does not exist.
      expect((await other.goto(`${address.pathname}${address.search}`))?.status(), session).toBe(404);
      // Their own page has nothing of the other person's.
      await other.goto(ADVANCED);
      await expect(other.getByText("Beta Bank")).toHaveCount(0);
      await expect(other.getByText("provider_down")).toHaveCount(0);
      await context.close();
    }
  });

  test("the admin sees the state of the plugins, and nothing of a person", async ({ browser }) => {
    const context = await browser.newContext({ storageState: sessionState("admin") });
    const page = await context.newPage();
    await page.goto("/settings/server");
    const diagnostics = page.getByRole("region", { name: "Diagnostics" });
    const plugin = diagnostics.getByTestId("plugin-diagnostic").filter({ hasText: "Enable Banking" });
    await expect(plugin).toHaveAttribute("data-state", "up");
    await expect(plugin).toContainText("Responding");
    await expect(plugin).toContainText(/v\d+\.\d+\.\d+ · contract v1/);
    await expect(plugin).toContainText(/Last check /);
    await expect(diagnostics.getByRole("button")).toHaveCount(0);
    await expect(diagnostics).not.toContainText(/Bank\b|connections@|provider_down/);
    await context.close();

    // The page is the admin's only.
    const person = await browser.newContext({ storageState: sessionState("connectionsJourney") });
    expect((await (await person.newPage()).goto("/settings/server"))?.status()).toBe(404);
    await person.close();
  });
});
