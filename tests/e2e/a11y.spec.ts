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
}

// ——— Getting to a screen ———————————————————————————————————————————————————————————————————

/** The page fades in: colours read while `<main>` is transparent are not the page's colours. */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("main")!).opacity === "1", null, {
      timeout: 15_000,
    })
    .catch(() => undefined);
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

const go = (path: string) => async (page: Page) => {
  await page.goto(path);
  await settled(page);
};

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
  { name: "/pockets", session: "layout", open: go("/pockets") },
  { name: "/subscriptions", session: "layout", open: go("/subscriptions") },
  { name: "/interests", session: "layout", open: go("/interests") },
  {
    name: "/interests/[id]",
    session: "layout",
    open: (page) => follow(page, "/interests", "Revolut Saving"),
  },
  { name: "/funds", session: "layout", open: go("/funds") },
  {
    name: "/funds/[id] (PAC)",
    session: "layout",
    open: (page) => follow(page, "/funds", /Fideuram/),
  },
  {
    name: "/funds/[id]/returns",
    session: "layout",
    open: async (page) => {
      await follow(page, "/funds", /Cometa/);
      await followLink(page, '[data-testid="pension-returns"] a[href$="/returns"]');
    },
  },
  {
    name: "/funds/[id] (pension)",
    session: "layout",
    open: (page) => follow(page, "/funds", /Cometa/),
  },
  ...(["contributions", "valuations", "settings"] as const).map((tab) => ({
    name: `/funds/[id] (pension)?tab=${tab}`,
    session: "layout" as const,
    open: async (page: Page) => {
      await follow(page, "/funds", /Cometa/);
      await openTab(page, tab);
    },
  })),
  {
    name: "/funds/[id]/documents/[docId]",
    session: "layout",
    open: async (page) => {
      await follow(page, "/funds", /Cometa/);
      // The documents card lives on the Valuations tab, not on the fund's first screen.
      await openTab(page, "valuations");
      await followLink(page, '[data-testid="pension-documents"] a[href*="/documents/"]');
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
      await followLink(page, 'main a[href^="/payroll/"]:not([href$="/original"])');
    },
  },
  { name: "/timeoff", session: "layout", open: go("/timeoff") },
  { name: "/settings/profile", session: "layout", open: go("/settings/profile") },
  { name: "/settings/security", session: "layout", open: go("/settings/security") },
  { name: "/settings/categories", session: "layout", open: go("/settings/categories") },
  { name: "/settings/data", session: "layout", open: go("/settings/data") },
  { name: "/settings/integrations", session: "layout", open: go("/settings/integrations") },

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
];

/** Overlays: they live in a portal, outside `<main>`, so each says what to measure. */
const OVERLAYS: Screen[] = [
  {
    name: "the command palette",
    session: "layout",
    roots: ['[role="dialog"]'],
    open: async (page) => {
      await page.goto("/");
      await settled(page);
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible();
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
      await expect(page.getByRole("dialog")).toBeVisible();
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
      await expect(page.getByRole("dialog")).toBeVisible();
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
        for (const { width, height, name: size } of WIDTHS) {
          if (screen.only !== undefined && screen.only !== size) continue;
          test(`${screen.name} at ${size} width`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await setTheme(page, "light");
            await screen.open(page);
            await setTheme(page, "light");

            // One assertion for all four answers rather than four in a row: a screen that fails
            // its layout would otherwise never be put in front of axe, and the run would report
            // half of what it measured.
            const roots = screen.roots ?? ["main"];
            const layout = await layoutFaults(page, roots);
            const scope = screen.roots === undefined ? undefined : roots;
            const light = await violationsOf(page, scope);
            await setTheme(page, "dark");
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
