// tests/e2e/_shared/a11y.ts — the engine of the screen check; each flow lists its own screens in
// tests/e2e/<flow>/a11y.spec.ts.
//
// What a screen has to be before it is called done (owner, 2026-09-20, widened in F9): at 1440 and
// at 400 px, no WCAG 2.1 A/AA violation (the rules about colour in both
// themes, the others in the light one, since a theme changes colours only), nothing
// reaching past the viewport, no scrollbar nobody asked for, no control too small to hit, and no
// text spilling out of its container. axe-core is injected from `node_modules`, so nothing is
// fetched from a CDN and the check runs against the deployed site like every other spec here.
//
// Every screen of the application is in the list of its flow, and almost all of them are opened as
// the seeded `layout` user, who has something on every page (scripts/seed-e2e.ts): a layout check run
// against an empty state measures an empty state, which is how F8's regression on
// /settings/plugins went unseen until F9 looked at that page as an admin.
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { type SESSIONS, sessionState } from "./env";
import { THIS_YEAR } from "./helpers";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

const WIDTHS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 400, height: 860, name: "phone" },
] as const;

type Size = (typeof WIDTHS)[number]["name"];

/**
 * What Funds is also measured at (funds-ux §6): the phone of the design, and a tablet. One screen
 * of each kind — the home, a fund's page, the form — and not every state of them: the states of a
 * kind share one layout, and each of them is still measured at the two usual widths.
 */
const EVERY_WIDTH = [
  ...WIDTHS,
  { width: 768, height: 1024, name: "tablet" },
  { width: 375, height: 812, name: "small phone" },
] as const;

export interface Screen {
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
  /** Measured at the design's four widths and not the usual two: one screen of each kind of Funds. */
  everyWidth?: boolean;
  /** One screen of each area: at the desktop width it is a `@smoke` test (docs/testing.md). */
  smoke?: boolean;
}

// ——— Getting to a screen ———————————————————————————————————————————————————————————————————

/** The page fades in: colours read while `<main>` is transparent are not the page's colours. */
export async function settled(page: Page): Promise<void> {
  // A client screen can draw nothing until its first read answers: with no `<main>` yet, the checks
  // below pass at once, and under load the layout rule then found "nothing matching main".
  await page
    .locator("main")
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => undefined);
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  // A skeleton is a `<main>` too, and it does not fade in: measured, it says nothing about the page.
  // Any skeleton, by the one component that draws them (src/ui/skeleton.tsx), and not by the name of
  // each: the page that replaces a skeleton fades in after it, and axe read the contrast of "To
  // review" half faded in, one run in eight, while only the skeletons of Funds were waited for.
  await page.locator("main .animate-shimmer").first().waitFor({ state: "detached", timeout: 15_000 });
  // A read with no skeleton says "Loading…" (packages/ui/src/loaded.tsx) inside a `<main>` already at
  // rest: /expenses then drew its page, faded in, while axe read it — the h1 too, one run in twenty.
  await page
    .locator("main [role=status]", { hasText: /^(Loading|Caricamento)…$/ })
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
export async function finished(page: Page): Promise<void> {
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
export async function settledDialog(page: Page): Promise<void> {
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
export async function follow(page: Page, from: string, name: string | RegExp): Promise<void> {
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
export async function followLink(page: Page, selector: string): Promise<void> {
  // Lists are drawn twice — a table from `md` up, cards below — so only the shown copy counts.
  const link = page.locator(selector).filter({ visible: true }).first();
  await expect(link, `no link matching ${selector} on ${page.url()}`).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  expect(href, `the link matching ${selector} has no href`).toBeTruthy();
  await page.goto(href!);
  await settled(page);
}

/** A page's tab, by the query the LinkTabs write: `?tab=…` on the page already open. */
export async function openTab(page: Page, tab: string): Promise<void> {
  const url = new URL(page.url());
  url.searchParams.set("tab", tab);
  await page.goto(url.toString());
  await settled(page);
}

/** A service's tab (docs/design/investments-ux.md §1.1): a route of its own under the service. */
export async function serviceTab(
  page: Page,
  service: string,
  tab: "" | "positions" | "activity" | "connection",
) {
  // The exact name: the home's alert link names the service too, and opens its Connection tab.
  await follow(page, "/investments", new RegExp(`^${service}$`));
  if (tab === "") return;
  const url = new URL(page.url());
  url.pathname = `${url.pathname}/${tab}`;
  await page.goto(url.toString());
  await settled(page);
}

/** A command of a service's `⋯` menu (§3.2), then the item. */
export async function headerCommand(page: Page, menu: "More actions", item: string) {
  await page.getByRole("button", { name: menu }).first().click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

export const go = (path: string) => async (page: Page) => {
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
export async function fundForm(page: Page, step: FundFormStep): Promise<void> {
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
export async function layoutFund(page: Page, fund: RegExp, query: string): Promise<void> {
  await follow(page, "/funds", fund);
  await page.goto(`${new URL(page.url()).pathname}${query}`);
  await settled(page);
}

// ——— The five rules ————————————————————————————————————————————————————————————————————————

/** The WCAG 2.1 A/AA rules of axe whose answer depends on a colour, and so on the theme. */
const COLOUR_RULES = ["color-contrast", "link-in-text-block"];

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
async function violationsOf(
  page: Page,
  roots: readonly string[] | undefined,
  rules: "every rule" | "colours",
): Promise<AxeViolation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ include, runOnly }) => {
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
        runOnly,
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? "",
        nodes: violation.nodes.length,
        html: violation.nodes[0]?.html.replace(/\s+/g, " ").slice(0, 100) ?? "",
      }));
    },
    {
      include: roots === undefined ? null : [...roots],
      runOnly:
        rules === "colours"
          ? { type: "rule", values: COLOUR_RULES }
          : { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    },
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

/** The app reads the theme off `<html data-theme>`; the contrast is checked in both, because it is a colour. */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

// ——— The run ———————————————————————————————————————————————————————————————————————————————

export function audit(screens: readonly Screen[]): void {
  const sessions = [...new Set(screens.map((screen) => screen.session))];
  for (const session of sessions) {
    test.describe(session === null ? "signed out" : `as ${session}`, () => {
      if (session !== null) test.use({ storageState: sessionState(session) });
      else test.use({ storageState: { cookies: [], origins: [] } });

      for (const screen of screens.filter((one) => one.session === session)) {
        for (const { width, height, name: size } of screen.everyWidth ? EVERY_WIDTH : WIDTHS) {
          if (screen.only !== undefined && screen.only !== size) continue;
          const smoke = screen.smoke && size === "desktop" ? " @smoke" : "";
          test(`${screen.name} at ${size} width${smoke}`, async ({ page }) => {
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
            const light = await violationsOf(page, scope, "every rule");
            // The second theme changes colours and nothing else: the structure, the names and the
            // roles were read in the first one, so the dark pass reads the rules about colour alone.
            await setTheme(page, "dark");
            await finished(page);
            const dark = await violationsOf(page, scope, "colours");
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
