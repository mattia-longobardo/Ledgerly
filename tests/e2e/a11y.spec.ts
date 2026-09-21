// tests/e2e/a11y.spec.ts — what a screen has to be before it is called done (owner, 2026-09-20):
// no WCAG 2.1 A/AA violation, nothing reaching past the viewport, no scrollbar nobody asked for,
// and no control too small to hit. axe-core is injected from `node_modules`, so nothing is
// fetched from a CDN and the check runs against the deployed site like every other spec here.
//
// The pages listed here are the ones already verified clean; a page joins the list once it is.
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { sessionState } from "./env";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

test.use({ storageState: sessionState("funds") });

const PAGES = [
  "/",
  "/funds",
  "/budgets",
  "/interests",
  "/settings/integrations",
  "/settings/security",
] as const;
const WIDTHS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 400, height: 860, name: "phone" },
] as const;

interface AxeViolation {
  id: string;
  impact: string;
  nodes: number;
  html: string;
}

/** The page fades in: colours read while `<main>` is transparent are not the page's colours. */
async function settled(page: Page) {
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
}

async function violationsOf(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const result = await (
      window as unknown as {
        axe: {
          run: (
            root: Document,
            options: unknown,
          ) => Promise<{ violations: { id: string; impact: string | null; nodes: { html: string }[] }[] }>;
        };
      }
    ).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? "",
      nodes: violation.nodes.length,
      html: violation.nodes[0]?.html.replace(/\s+/g, " ").slice(0, 100) ?? "",
    }));
  });
}

/** What sticks out of the window, what scrolls sideways, and what is too small to press. */
async function layoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["no <main>"];
    const visible = (element: Element) => element.checkVisibility?.({ visibilityProperty: true }) ?? true;
    const faults: string[] = [];

    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 0) faults.push(`the page scrolls sideways by ${overflow}px`);

    const past = [...main.querySelectorAll("*")].filter((element) => {
      if (!visible(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > window.innerWidth + 1;
    });
    // Only the innermost: a parent is wide because its child is.
    for (const element of past.filter((one) => !past.some((other) => other !== one && one.contains(other)))) {
      const box = element.getBoundingClientRect();
      faults.push(
        `${element.tagName.toLowerCase()} reaches ${Math.round(box.right - window.innerWidth)}px past the window · ${(element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}`,
      );
    }

    for (const element of main.querySelectorAll("*")) {
      if (!visible(element) || element.classList.contains("sr-only")) continue;
      const style = getComputedStyle(element);
      // `hidden` is how this app truncates text on purpose; a real scrollbar is `auto` or `scroll`.
      if (
        element.scrollWidth > element.clientWidth + 1 &&
        (style.overflowX === "auto" || style.overflowX === "scroll")
      ) {
        const table = element.querySelector("table") !== null;
        if (!table) faults.push(`${element.tagName.toLowerCase()} scrolls sideways inside the page`);
      }
    }

    for (const element of main.querySelectorAll("button, a[href], input, select")) {
      if (!visible(element)) continue;
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
    return faults;
  });
}

for (const { width, height, name } of WIDTHS) {
  test.describe(`at ${name} width`, () => {
    test.use({ viewport: { width, height } });

    for (const path of PAGES) {
      test(`${path} has no accessibility or layout fault`, async ({ page }) => {
        await page.goto(path);
        await settled(page);
        expect(await layoutFaults(page), `layout of ${path} at ${width}px`).toEqual([]);
        expect(await violationsOf(page), `WCAG on ${path} at ${width}px`).toEqual([]);
      });
    }
  });
}

/**
 * Admin › Users and Admin › Server (F8) have their own block because they need an admin: for
 * anybody else both pages answer 404, which is the point of them.
 */
test.describe("the admin pages", () => {
  test.use({ storageState: sessionState("owner") });

  for (const path of ["/settings/users", "/settings/server"] as const) {
    for (const { width, height, name } of WIDTHS) {
      test(`${path} has no accessibility or layout fault at ${name} width`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path);
        await settled(page);
        expect(await layoutFaults(page), `layout of ${path} at ${width}px`).toEqual([]);
        expect(await violationsOf(page), `WCAG on ${path} at ${width}px`).toEqual([]);
      });
    }
  }
});

/**
 * Time off (F7) has its own block because it needs its own user: the page is a calendar, a chart
 * and a table, and checking it while empty would check none of them. The seeded `timeoff` user has
 * an allowance, days taken and planned, and half a day of ROL.
 */
test.describe("time off", () => {
  test.use({ storageState: sessionState("timeoff") });

  for (const { width, height, name } of WIDTHS) {
    test(`/timeoff has no accessibility or layout fault at ${name} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/timeoff");
      await settled(page);
      expect(await layoutFaults(page), `layout of /timeoff at ${width}px`).toEqual([]);
      expect(await violationsOf(page), `WCAG on /timeoff at ${width}px`).toEqual([]);
    });
  }
});
