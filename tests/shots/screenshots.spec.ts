// tests/shots/screenshots.spec.ts — the pictures in the README (`npm run docs:shots`).
//
// Every shot is of the seeded `layout` user, whose data is invented from end to end
// (scripts/seed-e2e.ts) and who is deleted when the run ends: no screenshot in this repository
// shows a real person's money.
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "../e2e/env";

const DIR = "docs/screenshots";
mkdirSync(DIR, { recursive: true });

test.use({ storageState: sessionState("layout") });
test.describe.configure({ mode: "serial" });

/** The page fades in, and a chart draws itself: a shot taken too early is a shot of a skeleton. */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(700);
}

async function shot(page: Page, name: string, path: string, full = false): Promise<void> {
  await page.goto(path);
  await settled(page);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
}

/** Goes to a list and follows the first visible link named `name`. */
async function follow(page: Page, from: string, name: RegExp | string): Promise<string> {
  await page.goto(from);
  await settled(page);
  const link = page.getByRole("link", { name }).filter({ visible: true }).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  return href!;
}

test("the screens of the README", async ({ page }) => {
  await shot(page, "overview", "/");
  await shot(page, "accounts", "/accounts");
  await shot(page, "expenses", "/expenses");
  await shot(page, "budgets", "/budgets");
  await shot(page, "pockets", "/pockets");
  await shot(page, "subscriptions", "/subscriptions");
  await shot(page, "funds", "/funds");
  await shot(page, "timeoff", "/timeoff");
  await shot(page, "payroll", "/payroll");

  // The payslip review: the PDF beside the fields read out of it (F5).
  const payslip = await follow(page, "/payroll", /^(Open|Review)$/);
  await shot(page, "payroll-review", payslip);

  // A pension fund with its bridge and its operations (F6).
  const pension = await follow(page, "/funds", /Cometa/);
  await shot(page, "cometa", pension);

  // An investment PAC with its deposits and its returns (F4).
  const pac = await follow(page, "/funds", /Fideuram/);
  await shot(page, "fund", pac);
});

test("the same screens on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  await shot(page, "mobile-overview", "/");
  await shot(page, "mobile-accounts", "/accounts");
  await shot(page, "mobile-expenses", "/expenses");
});

test("the dark theme", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/overview-dark.png` });
});
