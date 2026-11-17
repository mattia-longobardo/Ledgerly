// tests/e2e/accounts/accounts.spec.ts — the F1 journey at 1440 px (spec §11).
import { expect, test } from "@playwright/test";
import { sessionState } from "../_shared/env";
import { LAST_YEAR } from "../_shared/helpers";

// Starts already signed in, from the session the seed prepared: the run's rate-limited sign-ins
// belong to the auth specs (tests/e2e/_shared/env.ts). This user is this spec's own, so the accounts it
// creates belong to no other test.
test.use({ storageState: sessionState("accounts") });

// The four journeys are one story on one user: each starts from what the one before left.
test.describe.configure({ mode: "serial" });

// The balances of the story: January and February of last year, in the past whatever today is.
const JANUARY_START = `${LAST_YEAR}-01-01`;
const JANUARY_END = `${LAST_YEAR}-01-31`;
const FEBRUARY_END = `${LAST_YEAR}-02-28`;

test("an account is created, kept up to date, summarised and snapshotted", async ({ page }) => {
  await test.step("a new user is told there is nothing to show yet", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No accounts yet" })).toBeVisible();
  });

  await test.step("creating an account with an opening balance opens it", async () => {
    await page.getByRole("link", { name: "Add account" }).first().click();
    await expect(page).toHaveURL("/accounts/new");
    await page.getByLabel("Name").fill("ING Conto Arancio");
    await page.getByLabel("Type").selectOption("checking");
    await page.getByLabel("Opening balance").fill("1.500,00");
    await page.getByLabel("Balance date").fill(JANUARY_END);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "ING Conto Arancio" })).toBeVisible();
    await expect(page.getByText("1.500,00 €").first()).toBeVisible();
  });

  const account = page.url();

  await test.step("a later balance is added and listed with its change", async () => {
    await page.goto(`${account}?tab=entries`);
    await page.getByLabel("Date").fill(FEBRUARY_END);
    await page.getByLabel("Balance", { exact: true }).fill("1.750,50");
    await page.getByLabel("Note").fill("Statement Feb");
    await page.getByRole("button", { name: "Save balance" }).click();

    const rows = page.getByRole("row").filter({ hasText: "Statement Feb" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("1.750,50 €");
    await expect(rows.first()).toContainText("+250,50 €");
  });

  await test.step("the accounts page totals what the account holds", async () => {
    await page.getByRole("link", { name: "Accounts", exact: true }).first().click();
    await expect(page).toHaveURL("/accounts");
    await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "ING Conto Arancio" });
    await expect(row).toContainText("1.750,50 €");
    await expect(page.getByRole("row").filter({ hasText: "Total" })).toContainText("1.750,50 €");
  });

  await test.step("the period control of Expenses drives the table and the chart (PERS-342)", async () => {
    await page.goto("/accounts");
    const columns = page.getByRole("columnheader");
    // No Month / Year any more: the presets and the stepper of Expenses.
    await expect(page.getByRole("group", { name: "Granularity" })).toHaveCount(0);
    await page.getByRole("link", { name: "Last 3 months" }).first().click();
    await expect(page).toHaveURL(/preset=last3Months/);
    await expect(page.getByRole("heading", { name: "Net worth over time" })).toBeVisible();
    // The chart's day grain is `chart=` here, and keeps the period.
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/chart=day/);
    await expect(page).toHaveURL(/preset=last3Months/);
    await expect(page.getByRole("list", { name: "Accounts in the chart" })).toContainText(
      "ING Conto Arancio",
    );

    await page.getByRole("link", { name: "Previous period" }).click();
    await expect(page).toHaveURL(/off=1/);
    await expect(page).toHaveURL(/preset=last3Months/);
    await expect(columns.filter({ hasText: /^Balance · / })).toBeVisible();
    await page.getByRole("link", { name: "Latest" }).click();
    await expect(page).not.toHaveURL(/off=/);

    await page.goto(`${account}?preset=last3Months`);
    await expect(page.getByRole("heading", { name: "Balance · 3 months" })).toBeVisible();
    await page.getByRole("group", { name: "Chart type" }).getByRole("link", { name: "Bars" }).click();
    await expect(page).toHaveURL(/mode=bars/);
    await expect(page).toHaveURL(/preset=last3Months/);
  });

  await test.step("a past range moves the chart and leaves the header on today (F2.5)", async () => {
    await page.goto(account);
    await page.getByTitle("Date range").click();
    await page.getByLabel("From", { exact: true }).fill(JANUARY_START);
    await page.getByLabel("To", { exact: true }).fill(JANUARY_END);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`from=${JANUARY_START}&to=${JANUARY_END}`));
    await expect(page.getByRole("heading", { name: "Balance · 1 month" })).toBeVisible();
    // January ended at 1.500,00 €; the header is about today, and today is 1.750,50 €.
    await expect(page.getByText("1.750,50 €").first()).toBeVisible();
    await expect(page.getByText("1.500,00 €").first()).toBeVisible();

    // A preset drops the range again.
    await page.getByRole("link", { name: "Year to date" }).first().click();
    await expect(page).not.toHaveURL(/from=/);
    await expect(page).toHaveURL(/preset=ytd/);
  });

  await test.step("the account chart goes down to the day, and keeps it across its other controls (F2.5)", async () => {
    await page.goto(account);
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await page.getByRole("group", { name: "Chart type" }).getByRole("link", { name: "Bars" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await expect(page).toHaveURL(/mode=bars/);
    await expect(page.getByRole("figure")).toContainText("Day-by-day change");
  });

  await test.step("settings rename the account and set a balance warning", async () => {
    await page.goto(`${account}?tab=settings`);
    await page.getByLabel("Name").fill("ING main");
    await page.getByLabel("Warn below").fill("2.000,00");
    // The banner opens the tab, above the connections, not between them and the form.
    await expect(page.getByTestId("unsaved-banner")).toBeVisible();
    // Measured from the top of the page: the form is taller than the window from N4 (the IBAN field),
    // and a sticky banner over a heading already scrolled away says nothing about the order.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const element of document.querySelectorAll("*")) if (element.scrollTop > 0) element.scrollTop = 0;
    });
    const banner = await page.getByTestId("unsaved-banner").boundingBox();
    const connections = await page.getByRole("heading", { name: "Connections" }).boundingBox();
    expect(banner!.y).toBeLessThan(connections!.y);
    await page.getByTestId("unsaved-banner").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Account saved")).toBeVisible();

    await page.goto("/accounts");
    await expect(page.getByRole("row").filter({ hasText: "ING main" })).toBeVisible();
  });

  await test.step("overview shows the net worth the account makes up", async () => {
    await page.getByRole("link", { name: "Overview" }).first().click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("1.750,50 €").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Net worth over time" })).toBeVisible();

    // Overview has the period control of Expenses (PERS-342); a range ending in February keeps
    // the hero on today.
    await expect(page.getByRole("link", { name: "Last 3 months" }).first()).toBeVisible();
    await page.getByTitle("Date range").click();
    await page.getByLabel("From", { exact: true }).fill(JANUARY_START);
    await page.getByLabel("To", { exact: true }).fill(FEBRUARY_END);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`from=${JANUARY_START}&to=${FEBRUARY_END}`));
    await expect(page.locator("p.text-hero")).toHaveText("1.750,50 €");
    // The stacked chart names each account under it, with its share of the total.
    const legend = page.getByRole("list", { name: "Accounts in the chart" });
    await expect(legend).toContainText("ING main");
    await expect(legend).toContainText("100");

    // Day by day too, keeping the range.
    await page.getByRole("group", { name: "Chart detail" }).getByRole("link", { name: "Day" }).click();
    await expect(page).toHaveURL(/grain=day/);
    await expect(page).toHaveURL(new RegExp(`from=${JANUARY_START}`));
    await expect(legend).toContainText("ING main");
  });

  await test.step("a snapshot can be taken at once and lands in the log", async () => {
    await page.goto("/settings/data");
    await page.getByRole("button", { name: "Take snapshot now" }).click();
    await expect(page.getByText("Snapshot taken")).toBeVisible();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  });
});

/**
 * The Danger zone (spec §7.1, PERS-419). "Delete account" deletes, always: it never archives in
 * secret. The dialog asks first, lists what uses the account (nothing, here), and the toast says
 * the account was deleted.
 */
test("deleting an account asks first, then deletes it and says so", async ({ page }) => {
  await page.goto("/accounts/new");
  await page.getByLabel("Name").fill("Conto di prova F9");
  await page
    .getByRole("button", { name: /Save|Create|Add/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/);
  const url = page.url().split("?")[0];

  await page.goto(`${url}?tab=settings`);
  await page.getByRole("button", { name: "Delete account" }).first().click();

  // The dialog says what happens, and closing it leaves the account alone.
  const dialog = page.getByRole("dialog", { name: "Delete Conto di prova F9?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("deleted for good");
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.goto(url))?.status()).toBe(200);

  // Confirming deletes it.
  await page.goto(`${url}?tab=settings`);
  await page.getByRole("button", { name: "Delete account" }).first().click();
  await page
    .getByRole("dialog", { name: "Delete Conto di prova F9?" })
    .getByRole("button", { name: "Delete for good" })
    .click();
  await expect(page).toHaveURL(/\/accounts$/);
  const toast = page.getByRole("region", { name: "Notifications" });
  await expect(toast).toContainText("Conto di prova F9");
  await expect(toast).toContainText("deleted");
  expect((await page.goto(url))?.status()).toBe(404);
});

/** An archived account is restored or deleted, with the same dialog as an open one (PERS-421). */
test("an archived account can be deleted from its Danger zone", async ({ page }) => {
  await page.goto("/accounts/new");
  await page.getByLabel("Name").fill("Conto archiviato F9");
  await page
    .getByRole("button", { name: /Save|Create|Add/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/);
  const url = page.url().split("?")[0];

  await page.goto(`${url}?tab=settings`);
  await page.getByRole("button", { name: "Archive account" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Conto archiviato F9");
  await page.goto(`${url}?tab=settings`);
  await expect(page.getByRole("button", { name: "Restore account" })).toBeVisible();

  await page.getByRole("button", { name: "Delete account" }).first().click();
  await page
    .getByRole("dialog", { name: "Delete Conto archiviato F9?" })
    .getByRole("button", { name: "Delete for good" })
    .click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("deleted");
  expect((await page.goto(url))?.status()).toBe(404);
});

/**
 * Connections (owner, 2026-09-21): the table the owner kept outside the app, brought inside. The
 * journey is the one that matters — add one, see it where you consult it, rename it, move it to
 * the other channel, remove it — and that the app refuses the same name twice on one channel.
 */
test("what hangs off an account is added, read on Overview, changed and removed", async ({ page }) => {
  await page.goto("/accounts/new");
  await page.getByLabel("Name").fill("Conto collegamenti");
  await page
    .getByRole("button", { name: /Save|Create|Add/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}/);
  const url = page.url().split("?")[0];

  await test.step("a connection is added on the IBAN", async () => {
    await page.goto(`${url}?tab=settings`);
    const section = page.getByRole("region", { name: "Connections" });
    await expect(section).toContainText("Nothing yet.");
    await section.getByRole("button", { name: "Add" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a connection" });
    await dialog.getByLabel("Name").fill("Paypal");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole("button", { name: "Paypal" })).toBeVisible();
  });

  await test.step("the same name on the same channel is refused, and on the other is not", async () => {
    const section = page.getByRole("region", { name: "Connections" });
    await section.getByRole("button", { name: "Add" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a connection" });
    await dialog.getByLabel("Name").fill("paypal");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("already on this channel");
    // The card is a different way to the same account, so the name is free there.
    await dialog.getByLabel("Reaches the account through").selectOption("card");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("Overview shows both lists without opening Settings", async () => {
    await page.goto(url);
    const details = page.getByRole("main");
    await expect(details).toContainText("Paypal");
    await expect(details.getByText("Card", { exact: true })).toBeVisible();
  });

  await test.step("a connection is renamed and then removed", async () => {
    await page.goto(`${url}?tab=settings`);
    const section = page.getByRole("region", { name: "Connections" });
    await section.getByRole("button", { name: "Paypal", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit connection" });
    await dialog.getByLabel("Name").fill("PayPal Europe");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole("button", { name: "PayPal Europe" })).toBeVisible();

    // The dialog by its name, not `getByRole("dialog")`: the toast that confirms the removal is a
    // dialog to the accessibility tree too, and the two would be ambiguous for a moment.
    await section.getByRole("button", { name: "PayPal Europe" }).click();
    const editing = page.getByRole("dialog", { name: "Edit connection" });
    await editing.getByRole("button", { name: "Remove" }).click();
    await expect(editing).toBeHidden();
    await expect(section.getByRole("button", { name: "PayPal Europe" })).toBeHidden();
  });
});

/**
 * Archiving (owner, 2026-09-21): an account you stopped using leaves the list without taking its
 * history with it. The point of the journey is the number: the total must be the same whether the
 * archived account is shown or hidden, or the page would give two net worths for one day.
 */
test("an account is archived, found again behind a checkbox, and restored", async ({ page }) => {
  // The list is drawn twice — a table from `md` up, cards below — so only the shown copy counts.
  const rowFor = (name: string) => page.getByRole("link", { name }).filter({ visible: true }).first();

  await page.goto("/accounts/new");
  await page.getByLabel("Name").fill("Conto da archiviare");
  await page.getByLabel("Type").selectOption("checking");
  await page.getByLabel("Opening balance").fill("2.000,00");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  const url = page.url().split("?")[0];

  await page.goto("/accounts");
  // The headline by its test id, not by a pattern: its wording changes with the count ("no
  // accounts", "1 account"), and a regex that misses is a timeout rather than a failure.
  const headline = page.getByTestId("accounts-summary");
  await expect(rowFor("Conto da archiviare")).toBeVisible();
  // `toHaveText` below and not `textContent()`: the first retries while the page settles, the
  // second reads once and turns any wait into a failure.
  const withIt = (await headline.textContent()) ?? "";

  await test.step("archiving takes it off the list, and off the total", async () => {
    await page.goto(`${url}?tab=settings`);
    await page.getByRole("button", { name: "Archive account" }).click();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Conto da archiviare");
    await page.goto("/accounts");
    await expect(page.getByRole("link", { name: "Conto da archiviare" })).toHaveCount(0);
    await expect(headline, "the total did not drop when it was archived").not.toHaveText(withIt);
  });

  await test.step("the checkbox brings it back into view, and the total stays put", async () => {
    const without = (await headline.textContent()) ?? "";
    await page.getByRole("link", { name: "Show archived" }).click();
    await expect(page).toHaveURL(/archived=1/);
    await expect(rowFor("Conto da archiviare")).toBeVisible();
    // It is marked, it is out of the total, and the headline still counts only the live ones.
    await expect(page.getByRole("main")).toContainText("Archived");
    await expect(headline, "showing an archived account moved the total").toHaveText(without);
  });

  await test.step("restoring gives it back, balance and all", async () => {
    await page.goto(`${url}?tab=settings`);
    await page.getByRole("button", { name: "Restore account" }).click();
    // Wait for the action to say it is done, as the archive step does: navigating on the click
    // races the Server Action, and the list is then read from before it landed.
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Account restored");
    await page.goto("/accounts");
    await expect(rowFor("Conto da archiviare")).toBeVisible();
    await expect(headline).toHaveText(withIt);
  });
});
