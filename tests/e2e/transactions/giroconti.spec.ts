// tests/e2e/transactions/giroconti.spec.ts — the giroconti as Wallet shows them (decisions 6A–10A of
// 2026-11-25) and the time of a movement (11A–12A): one test for each state, on the `giroconti` user,
// whose data are all last month (scripts/seed-e2e/transactions.ts, `seedGiroconti`).
import { expect, type Page, test } from "@playwright/test";
import { focusOn } from "../_shared/keyboard";
import { sessionState } from "../_shared/env";

test.use({ storageState: sessionState("giroconti") });
// One story on one user: a choice made here changes the rows the next test reads.
test.describe.configure({ mode: "serial" });

const LAST_MONTH = "/expenses?off=1";

/** The table's row of a payee (the phone's list is hidden at 1440 px). */
const row = (page: Page, payee: string) => page.getByRole("row").filter({ hasText: payee });

async function open(page: Page) {
  await page.goto(LAST_MONTH);
  await expect(row(page, "Pair out")).toHaveCount(1);
}

/** Chooses the other account of a row in the dialog its cell opens, and saves. */
async function choose(page: Page, payee: string, account: string) {
  await row(page, payee).getByTestId("transfer-choose").click();
  const dialog = page.getByRole("dialog", { name: "Other account" });
  await dialog.getByLabel("Other account").selectOption({ label: account });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Transfer saved").last()).toBeVisible();
  await expect(dialog).toBeHidden();
}

test("a pair says where the money went, on both legs, with no category", async ({ page }) => {
  await open(page);
  for (const payee of ["Pair out", "Pair in"]) {
    const route = row(page, payee).getByTestId("transfer-route");
    await expect(route).toHaveAttribute("data-state", "paired");
    await expect(route).toHaveText("From Conto Uno → to Conto Due");
  }
  await expect(row(page, "Pair out").getByRole("button", { name: "Edit category" })).toHaveCount(0);
});

test("a leg with an account outside Ledgerly says so", async ({ page }) => {
  await open(page);
  const route = row(page, "Gift out").getByTestId("transfer-route");
  await expect(route).toHaveAttribute("data-state", "outside");
  await expect(route).toHaveText("From Conto Uno → to Outside account");
});

test("a leg whose account is chosen waits for the other side", async ({ page }) => {
  await open(page);
  const waiting = row(page, "Wait out");
  await expect(waiting.getByTestId("transfer-route")).toHaveText("From Conto Uno → to Conto Tre");
  await expect(waiting).toContainText("Waiting for the other side");
});

test("a leg with no account asks the person to choose it", async ({ page }) => {
  await open(page);
  await expect(row(page, "Choose out").getByTestId("transfer-choose")).toHaveText("Choose the account");
  await expect(page.getByText(/wait for you to choose the account/)).toBeVisible();
});

test("the account chosen makes the leg wait for its other side", async ({ page }) => {
  await open(page);
  await choose(page, "Pick out", "Conto Tre");
  const route = row(page, "Pick out").getByTestId("transfer-route");
  await expect(route).toHaveAttribute("data-state", "waiting");
  await expect(route).toHaveText("From Conto Due → to Conto Tre");
});

test("«Outside account» takes the leg out of the ones to choose", async ({ page }) => {
  await open(page);
  await choose(page, "Leave out", "Outside account");
  await expect(row(page, "Leave out").getByTestId("transfer-route")).toHaveText(
    "From Conto Due → to Outside account",
  );
});

test("a proposal rejected is gone, a proposal confirmed pairs the two", async ({ page }) => {
  await open(page);
  const proposals = page.getByTestId("transfer-proposals");
  await expect(proposals).toContainText("4 transfers to confirm");

  await proposals.getByRole("button", { name: "Reject: From Conto Due → to Conto Tre" }).click();
  await expect(page.getByText("Proposal rejected").last()).toBeVisible();
  await expect(proposals.getByText("From Conto Due → to Conto Tre")).toHaveCount(0);

  await proposals.getByRole("button", { name: "Confirm: From Conto Uno → to Conto Due" }).click();
  await expect(page.getByText("Transfer paired").last()).toBeVisible();
  // Its other proposal goes with it: the money out is paired.
  await expect(proposals.getByText("From Conto Uno → to Conto Tre")).toHaveCount(0);
  const route = row(page, "Proposal out").getByTestId("transfer-route");
  await expect(route).toHaveAttribute("data-state", "paired");
  await expect(route).toHaveText("From Conto Uno → to Conto Due");
});

test("two movements are paired by hand from the selection", async ({ page }) => {
  await open(page);
  await row(page, "Hand out").getByRole("checkbox").check();
  await row(page, "Hand in").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Pair as a transfer" }).click();
  await expect(page.getByText("Transfer paired").last()).toBeVisible();
  const route = row(page, "Hand out").getByTestId("transfer-route");
  await expect(route).toHaveAttribute("data-state", "paired");
  await expect(route).toHaveText("From Conto Uno → to Conto Tre");
});

test("a movement with a time shows it, one without shows the day alone", async ({ page }) => {
  await open(page);
  // 12:32 UTC: 13:32 or 14:32 in Rome, by the season of last month.
  await expect(row(page, "Morning bakery")).toContainText(/1[34]:32/);
  await expect(row(page, "Corner kiosk")).not.toContainText(/\d\d:\d\d/);

  await row(page, "Morning bakery").dblclick({ position: { x: 300, y: 10 } });
  const details = page.getByRole("dialog");
  await expect(details).toContainText(/\d{1,2} \w{3} \d{4} · 1[34]:32/);
  await page.keyboard.press("Escape");
  await row(page, "Corner kiosk").dblclick({ position: { x: 300, y: 10 } });
  await expect(page.getByRole("dialog")).not.toContainText(/\d\d:\d\d/);
});

test("the choice of the account works from the keyboard", async ({ page }) => {
  await open(page);
  await focusOn(row(page, "Choose out").getByTestId("transfer-choose"));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Other account" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Other account")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row(page, "Choose out").getByTestId("transfer-choose")).toBeFocused();
});
