// tests/e2e/connections/connections.spec.ts — the state of the connections (rewrite plan N2;
// ux/n2-connection-status.md): one row for every connection with one state of five, the history,
// "Advanced" with the schedule, the log and the report, and who can read whose log.
//
// The `connections` user is seeded with a connection in each state (scripts/seed-e2e.ts). Nothing
// here starts a reading: the credentials of that user are not credentials.
import { expect, type Page, test } from "@playwright/test";
import { relativePast } from "@ledgerly/format/dates";
import { sessionState } from "../_shared/env";
import { hydrated } from "../_shared/helpers";

// The tests of this file change the data of one user, each from what the one before left: they run
// in order, on one worker, while the other files run beside them (playwright.preview.config.ts).
test.describe.configure({ mode: "default" });

const INTEGRATIONS = "/settings/plugins";
const ADVANCED = "/settings/plugins/advanced";
// The pages of the sources (rewrite plan N7.2): every connection of a source is on its page.
const BANKS = "/settings/plugins/enablebanking";
const TREK = "/settings/plugins/trek";
const WALLET = "/settings/plugins/wallet";

/** The words the normal view never shows (criterion 1 of N2; ux §1.2). */
const TECHNICAL = /\b(plugin|sync|synchroni[sz]ation|token|session|job|run|API|HTTP|429|cron|log)\b/i;
const CODES = /auth\b|consent_expired|rate_limited|provider_down|invalid_data/;

// The seed dates the good readings from its own clock (scripts/seed-e2e/connections.ts): 2 hours
// before it for the banks up to date, 26 hours before it for the late one. The page says them from the
// server's clock at the time of the test, by `relativePast`: «2 hours ago», «yesterday at 23:50» when
// the seed ran before 02:00, more hours when the run came later. The words expected here come from
// the same two instants by the same rule, so the file passes at any hour and however late after the
// seed (PERS-599).
async function lastReads(page: Page) {
  const answer = await page.request.get("/api/v1/connections");
  expect(answer.status()).toBe(200);
  const { connections }: { connections: { name: string; lastOkAt: string | null }[] } = await answer.json();
  return (name: string): string => {
    const at = connections.find((one) => one.name === name)?.lastOkAt;
    if (!at) throw new Error(`${name}: no last good reading`);
    const when = relativePast(new Date(at), new Date(), "Europe/Rome");
    if (when.key === "hours") return `${when.count} hours? ago`;
    if (when.key === "yesterday") return `yesterday at ${when.time}`;
    if (when.key === "date") return `on .+ at ${when.time}`;
    throw new Error(`${name}: read ${when.key === "now" ? "just now" : "minutes ago"}, not by the seed`);
  };
}
const upToDate = (when: string) => new RegExp(`^Updated ${when}$`);

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

      await test.step("the list: one row per plugin, its state in a word, its name a link (PERS-615 §3)", async () => {
        const plugins = page.getByTestId("plugin-row");
        // Read only by hand: «On demand only», not «Paused» nor «Manual only» (PERS-615 §6).
        await expect(plugins.filter({ hasText: "Trek" })).toHaveAttribute("data-status", "on_demand");
        await expect(plugins.filter({ hasText: "Wallet" })).toHaveAttribute("data-status", "on_demand");
        // What each plugin reads and writes, from `capabilities` of `GET /plugins`.
        await expect(
          plugins.filter({ hasText: "Trek" }).getByTestId("plugin-chips").locator("span"),
        ).toHaveText(["Reads days off", "Writes days off"]);
        await expect(
          plugins.filter({ hasText: "Enable Banking" }).getByTestId("plugin-chips").locator("span"),
        ).toHaveText(["Reads accounts and balances", "Reads transactions"]);
        // The worst of the banks: one needs an action.
        const banks = plugins.filter({ hasText: "Enable Banking" });
        await expect(banks).toHaveAttribute("data-status", "action_needed");
        await expect(banks.getByRole("link", { name: "Enable Banking", exact: true })).toHaveAttribute(
          "href",
          BANKS,
        );
        await expect(page.getByTestId("bank-row")).toHaveCount(0);
      });

      await page.goto(TREK);
      await test.step("the source's page has the row of its connection", async () => {
        const one = row(page, "Trek");
        await expect(one).toHaveAttribute("data-status", "manual");
        await expect(one.getByText("On demand only", { exact: true }).first()).toBeVisible();
        await expect(one.getByText(/^Automatic update is off\.$/).first()).toBeVisible();
        await expect(one.getByRole("button", { name: "Turn on automatic update" })).toBeVisible();
        // The state beside the page's title too (point 10).
        await expect(page.getByTestId("source-heading")).toHaveAttribute("data-status", "on_demand");
        await expect(
          page.getByTestId("source-heading").getByText("On demand only", { exact: true }),
        ).toBeVisible();
      });

      await page.goto(BANKS);
      const banks = page.getByRole("region", { name: "Connection" });
      await test.step("every state is a word beside the name, with its sentence", async () => {
        const lastRead = await lastReads(page);
        const expected: [string, string, string, RegExp][] = [
          ["Alfa Bank", "ok", "Up to date", upToDate(lastRead("Alfa Bank"))],
          [
            "Beta Bank",
            "late",
            "Delayed",
            new RegExp(`^Last update ${lastRead("Beta Bank")}\\. Next attempt `),
          ],
          ["Gamma Bank", "action", "Action needed", /^Access to Gamma Bank has expired\.$/],
          ["Delta Bank", "running", "In progress", /^Update in progress…$/],
          ["Epsilon Bank", "ok", "Up to date", upToDate(lastRead("Epsilon Bank"))],
          [
            "Zeta Bank",
            "action",
            "Action needed",
            /^You gave access, but you have not chosen the accounts yet\.$/,
          ],
        ];
        for (const [name, value, word, sentence] of expected) {
          const one = row(page, name);
          await expect(one, name).toHaveAttribute("data-status", value);
          // The word beside the name: the history, closed, has the words of its readings too.
          await expect(one.getByText(word, { exact: true }).first(), name).toBeVisible();
          await expect(one.getByText(sentence).first(), name).toBeVisible();
        }
      });

      await test.step("the banks that need the person come first, then by name (point 7)", async () => {
        const names = await banks.getByTestId("bank-row").locator(".font-semibold").allTextContents();
        expect(names).toEqual([
          "Gamma Bank",
          "Zeta Bank",
          "Beta Bank",
          "Delta Bank",
          "Alfa Bank",
          "Epsilon Bank",
        ]);
      });

      if (width === 400) {
        await test.step("on a phone the menu of a row is on the line of its name (point 9)", async () => {
          const one = row(page, "Alfa Bank");
          const name = await one.getByText("Alfa Bank", { exact: true }).first().boundingBox();
          const menu = await one.getByRole("button", { name: "Alfa Bank" }).boundingBox();
          const centre = (box: { y: number; height: number } | null) => (box ? box.y + box.height / 2 : NaN);
          expect(Math.abs(centre(name) - centre(menu))).toBeLessThan(8);
        });
      }

      await test.step("one action when something has to be done, none when nothing has", async () => {
        await expect(row(page, "Beta Bank").getByRole("button", { name: "Update now" })).toBeVisible();
        await expect(row(page, "Gamma Bank").getByRole("link", { name: "Renew access" })).toHaveAttribute(
          "href",
          /\/banks\/connect\?renew=/,
        );
        await expect(row(page, "Zeta Bank").getByRole("link", { name: "Choose accounts" })).toBeVisible();
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
        expect(texts.length).toBeGreaterThanOrEqual(6);
        for (const text of texts) {
          expect(text).not.toMatch(TECHNICAL);
          expect(text).not.toMatch(CODES);
        }
      });
    });
  }

  test("the list leads to a source's page and back with the keyboard", async ({ page }) => {
    await page.goto(INTEGRATIONS);
    const trek = page
      .getByTestId("plugin-row")
      .filter({ hasText: "Trek" })
      .getByRole("link", { name: "Trek", exact: true });
    await hydrated(trek);
    await trek.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${TREK}$`));
    await expect(page.getByRole("heading", { level: 2, name: "Trek", exact: true })).toBeVisible();
    const back = page.getByRole("link", { name: "← Plugins", exact: true });
    await hydrated(back);
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${INTEGRATIONS}$`));
  });

  test("a source's page has every setting of the source, each in its section", async ({ page }) => {
    // plugin-settings.md §2.2: connection, accounts, schedule, history, writing, advanced.
    await page.goto(WALLET);
    // The log of the readings is under each connection's history, not a card (point 12).
    for (const name of ["Connection", "Accounts", "Schedule", "History"]) {
      await expect(page.getByRole("region", { name, exact: true }), name).toBeVisible();
    }
    const writes = page.getByRole("region", { name: /^Writing to / });
    await expect(writes).toContainText("Nothing to write now.");
    await expect(
      page.getByRole("region", { name: "Accounts" }).getByRole("button", { name: "Choose accounts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: /schedule/i }),
    ).toBeVisible();
    // The choice of the accounts is a section, not an entry of the row's menu.
    const wallet = page.getByTestId("connection-row");
    await wallet
      .getByRole("button", { name: /Wallet/ })
      .first()
      .click();
    await expect(page.getByRole("menuitem", { name: "Choose accounts" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A bank: one line per bank leads to the choice of its accounts.
    await page.goto(BANKS);
    await expect(
      page
        .getByRole("region", { name: "Accounts" })
        .getByRole("link", { name: "Choose accounts of Alfa Bank" }),
    ).toHaveAttribute("href", /\/banks\/connect\?step=accounts&c=[0-9a-f-]{36}&all=1$/);
    // Trek: the days waiting to reach it.
    await page.goto(TREK);
    await expect(page.getByRole("region", { name: /^Writing to / })).toContainText("Nothing to write now.");
  });

  test("the history opens with the keyboard, shows ten readings and leads to all of them", async ({
    page,
  }) => {
    await page.goto(BANKS);
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
      /\/settings\/plugins\/advanced\?c=/,
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
    await page.goto(BANKS);
    const alfa = row(page, "Alfa Bank");
    await alfa.getByRole("button", { name: "Alfa Bank" }).focus();
    await page.keyboard.press("Enter");
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText([
      "Update now",
      "Renew access",
      "Replace key",
      "Choose accounts",
      "Advanced",
      "Disconnect",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(alfa.getByRole("button", { name: "Alfa Bank" })).toBeFocused();

    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Advanced" }).click();
    await expect(page).toHaveURL(/\/settings\/plugins\/advanced\?c=[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Connection")).toHaveValue(/[0-9a-f-]{36}/);
  });

  test("a second bank can be connected: the procedure opens with a bank already there", async ({ page }) => {
    await page.goto(BANKS);
    const banks = page.getByRole("region", { name: "Connection" });
    await expect(banks.getByTestId("bank-row")).toHaveCount(6);
    await expect(banks.getByText("For now you can connect one bank only.")).toHaveCount(0);
    await banks.getByRole("link", { name: "Connect a bank" }).click();
    // Until N1 a person with a bank was sent back to the settings.
    await expect(page).toHaveURL(/\/banks\/connect$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the schedule is on the source's page: the same control for a bank and for the others", async ({
    page,
  }) => {
    await page.goto(BANKS);
    const banks = page.getByRole("region", { name: "Schedule" }).getByTestId("schedule-row");
    // A bank's schedule can be changed since PERS-667 (at most 4 passes a day, bank-schedule.spec.ts).
    await expect(banks.filter({ hasText: "Alfa Bank" })).toContainText("At 07:10, 13:10, 19:10");
    await expect(banks.filter({ hasText: "Alfa Bank" })).toContainText(/Next: /);
    await expect(banks.filter({ hasText: "Zeta Bank" })).toContainText("On demand only");
    await expect(
      banks.filter({ hasText: "Alfa Bank" }).getByRole("button", { name: /schedule/i }),
    ).toHaveCount(1);
    // Each connection leads to its own log, under its history (point 12).
    const alfa = row(page, "Alfa Bank");
    await alfa.getByRole("button", { name: "History", exact: true }).click();
    await expect(alfa.getByRole("link", { name: "All readings in Advanced" })).toHaveAttribute(
      "href",
      /\/settings\/plugins\/advanced\?c=[0-9a-f-]{36}#log$/,
    );

    await page.goto(TREK);
    const trek = page.getByRole("region", { name: "Schedule" }).getByTestId("schedule-row");
    await expect(trek.filter({ hasText: "Trek" }).getByRole("button", { name: /schedule/i })).toBeVisible();

    // "Advanced" keeps the log; the schedule of a source is not there any more (plugin-settings.md §2.2).
    await page.goto(ADVANCED);
    await expect(page.getByTestId("schedule-row")).toHaveCount(0);
  });

  test("Advanced: the log with its filter, and the report", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(INTEGRATIONS);
    await page.getByRole("link", { name: /^Reading log/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ADVANCED}$`));

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
    await expect(status).toContainText(new RegExp(`Updated ${(await lastReads(page))("Alfa Bank")}`));
  });

  test("Deactivate: the dialog says what changes, opens on Cancel, and Esc changes nothing", async ({
    page,
  }) => {
    // plugin-settings.md §3.3, §5. Not confirmed here: the last reading would call the bank.
    await page.goto(BANKS);
    const zone = page.getByRole("region", { name: "Deactivate Enable Banking" });
    const open = zone.getByRole("button", { name: "Deactivate Enable Banking" });
    await hydrated(open);
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Deactivate Enable Banking?" });
    await expect(dialog).toContainText("The numbers do not change.");
    const lines = dialog.getByTestId("deactivate-lines").getByRole("listitem");
    await expect(lines.first()).toHaveText(/^\d+ accounts? becomes? manual, with the same balance\.$/);
    // Saved credentials: the dialog says they go (PERS-615 §5, defect 12 of PERS-614).
    await expect(lines.last()).toHaveText("The Enable Banking credentials and settings are deleted.");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await expect(page.getByRole("region", { name: "Connection" }).getByTestId("bank-row")).toHaveCount(6);
  });

  test("disconnecting a bank keeps its account tied to it, shown as disconnected", async ({ page }) => {
    await page.goto(BANKS);
    const epsilon = row(page, "Epsilon Bank");
    await epsilon.getByRole("button", { name: "Epsilon Bank" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    const dialog = page.getByRole("dialog", { name: "Disconnect Epsilon Bank?" });
    await expect(dialog).toContainText("each account goes back to its place by itself");
    // The way to stop for good is the source's page (plugin-settings.md §4.2).
    await expect(
      dialog.getByRole("link", { name: "Want to stop using Enable Banking? Turn it off" }),
    ).toHaveAttribute("href", `${BANKS}#deactivate`);
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("region", { name: "Connection" }).getByTestId("bank-row")).toHaveCount(5);

    // Not an account kept by hand: still the bank's, waiting for the bank to be connected again.
    await page.goto("/accounts");
    await page
      .getByRole("link", { name: /Epsilon Bank current account/ })
      .first()
      .click();
    // In the header and in the account's source of data.
    await expect(page.getByText("Disconnected from Enable Banking", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Manual", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("connection-status")).toHaveCount(0);
  });

  test("Wallet's Disconnect says no account moves to a bank; a bank offers an archived account (H58)", async ({
    page,
  }) => {
    await page.goto(WALLET);
    const wallet = page.getByTestId("connection-row").first();
    await hydrated(wallet.getByRole("button").first());
    await wallet
      .getByRole("button", { name: /Wallet/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    const dialog = page.getByRole("dialog", { name: /^Disconnect .*Wallet\?$/ });
    await expect(dialog).toContainText("with its balance and transactions, and stops updating");
    await expect(dialog).toContainText("It does not move to a bank by itself");
    await dialog.getByRole("button", { name: "Keep connected" }).click();
    await expect(dialog).toBeHidden();

    // Zeta Bank's accounts are not chosen yet. Nothing is imported here: a reading would call the bank.
    await page.goto(BANKS);
    await page
      .getByRole("region", { name: "Accounts" })
      .getByRole("link", { name: "Choose accounts of Zeta Bank" })
      .click();
    const target = page.getByRole("combobox", { name: "In Ledgerly" }).first();
    await hydrated(target);
    await expect(target.getByRole("option", { name: 'Use "Old savings" (archived)' })).toHaveCount(1);
    await target.selectOption({ label: 'Use "Old savings" (archived)' });
    await expect(page.getByText('"Old savings" is archived: it comes back to the lists')).toBeVisible();
  });

  test("Trek deactivated: its page is «Not active», with the day and «Activate»", async ({ page }) => {
    // Disconnected first, so the last reading of §3.2 calls nobody.
    await page.goto(TREK);
    const trek = page.getByTestId("connection-row").first();
    await hydrated(trek.getByRole("button").first());
    await trek.getByRole("button", { name: /Trek/ }).first().click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    const disconnect = page.getByRole("dialog", { name: "Disconnect Trek?" });
    await disconnect.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(disconnect).toBeHidden();

    await page.getByRole("button", { name: "Deactivate Trek" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Trek?" });
    // No credential is left after «Disconnect»: no line says one goes (defect 12 of PERS-614).
    await expect(dialog.getByTestId("deactivate-lines")).not.toContainText("credentials");
    await dialog.getByRole("button", { name: "Deactivate Trek" }).click();
    await expect(page.getByText("Trek deactivated: no account to convert")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${INTEGRATIONS}$`));
    // The list keeps a trace: «Not active», and the day (defect 10 of PERS-614).
    const listed = page.getByTestId("plugin-row").filter({ hasText: "Trek" });
    await expect(listed).toHaveAttribute("data-status", "not_active");
    await expect(listed.getByTestId("plugin-text")).toContainText("deactivated on");

    await page.goto(TREK);
    for (const name of ["Schedule", "Advanced", "Writing to Trek"]) {
      await expect(page.getByRole("region", { name, exact: true })).toHaveCount(0);
    }
    // Nothing left to deactivate: the plugin is off with nothing here; «Activate» is the step.
    await expect(page.getByRole("region", { name: "Deactivate Trek" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Activate Trek" })).toBeVisible();
  });
});

test.describe("whose log it is", () => {
  test("another person, an admin included, does not reach the log of a connection", async ({ browser }) => {
    const owner = await browser.newContext({ storageState: sessionState("connectionsJourney") });
    const page = await owner.newPage();
    await page.goto(BANKS);
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
