# Finance Dashboard - Desktop & Mobile Redesign Plan

**Status:** awaiting approval. Execute in a fresh chat. Delete this file at the end (Step 9).
**Created:** 2026-09-01
**Scope:** full layout redesign of the authenticated app, desktop and mobile.

---

## 0. Read this first: what this plan is and is not

**The complaint is correct and measurable.** The content column is hard-capped at
`max-w-4xl` (896px) regardless of viewport, inside a shell that already reserves a
208px sidebar. Measured with Playwright on the running app:

| Viewport | Sidebar | Usable | Content | Dead space | Wasted |
|---|---|---|---|---|---|
| 1280 | 208 | 1072 | 896 | 176 | 16% |
| 1440 | 208 | 1232 | 896 | 336 | **27%** |
| 1920 | 208 | 1712 | 896 | 816 | **48%** |
| 2560 | 208 | 2352 | 896 | 1456 | **62%** |

Root cause: `max-w-3xl lg:max-w-4xl` is a *prose reading-width* constraint. It is
correct for an article and wrong for an instrument panel. Every screen inherits it
from `AppShell`, so no per-page fix can solve it. This is a shell-level defect.

**Honest scoping note.** The `design-taste-frontend` skill states in its Section 13
that it is **out of scope for dashboards and dense product UI**, and its Section 2.A
would route this brief to Carbon or Fluent. We are deliberately **not** adopting an
external design system: the app already has a documented token layer
(`src/styles/globals.css`) and a written identity (`BRAND.md`), and swapping in
Carbon would discard both. Instead we:

- keep the existing token layer and brand as the foundation,
- borrow Carbon's *data-density patterns* as reference only (no package),
- apply `design-taste-frontend` only for its craft rules (theme lock, colour and
  shape consistency, contrast, states, AI-tell bans, em-dash ban),
- apply the **Web Interface Guidelines** in full, since those are UI-agnostic.

**Redesign mode:** Overhaul of *layout and composition*. Preserve, without
negotiation: routes and slugs, nav labels, form field names, all business logic,
all 555 tests, the brand tokens, and copy voice.

---

## 1. Design direction

**Design read:** authenticated dense-data finance instrument for a single
owner-operator on a wide desktop and a phone, in the "Instrument" language BRAND.md
documents, built on the project's own Tailwind v4 token layer.

**Dials** (justified, not baseline):

| Dial | Value | Why |
|---|---|---|
| `DESIGN_VARIANCE` | 5 | Dashboards are scanned in a fixed pattern. Asymmetry helps hierarchy, chaos hurts recall. Above the current ~3, below the skill's landing baseline of 8. |
| `MOTION_INTENSITY` | 3 | Numbers that move while being read are a defect. Motion is for feedback and state transition only. |
| `VISUAL_DENSITY` | 8 | BRAND.md's thesis is "dense-data cockpit". At density 8 the skill bans generic card containers, which is exactly the fix this app needs. |

**Non-negotiable constants** (from BRAND.md, do not re-derive):

- Accent `#22d3ee` dark / `#0e7490` light. One accent, whole app. No second hue.
- IBM Plex Sans + IBM Plex Mono, vendored locally. CSP pins `font-src 'self'`.
  **Do not add a webfont, do not link Google Fonts.**
- Every number is `font-variant-numeric: tabular-nums` via `.num`.
- Radius scale is `xs 4 / sm 6 / md 8 / lg 12`. One system, no mixing.
- The axis-rule motif (`axis-rule`, `axis-rule-live`) is the divider language.

---

## 2. The core fix: a real desktop grid

Replace the fixed reading column with a **fluid dashboard grid** that earns the
viewport, and let panels adapt to their *container* rather than the viewport.

### 2.1 Shell

```
Current:  [sidebar 208] [ ---- 896 fixed ---- ] [ dead space ]
Target:   [sidebar 240] [ fluid content, padded, max-w-[1600px] ]
```

- Content wrapper becomes `w-full max-w-[1600px] px-6 xl:px-8` (cap only to stop
  absurd line lengths at 2560+, not to create a column).
- Sidebar widens to 240px so nav labels and a secondary group fit on one line.
- Sidebar becomes independently scrollable, `overscroll-behavior: contain`.

### 2.2 Column system

12-column CSS Grid at `lg`, 8 at `md`, 4 at `sm`, with named panel spans. Panels
declare span at the *page* level; panels never set their own width.

```
lg (1024-1439)  12 cols, gap 16
xl (1440-1919)  12 cols, gap 20
2xl (1920+)     12 cols, gap 24, sidebar sticky, content 3-up where content allows
```

### 2.3 Container queries are the load-bearing 2026 technique

A panel must render correctly at 380px (mobile), 560px (half of a 12-col row) and
1100px (full row). Viewport breakpoints cannot express that, which is precisely why
the current code gave up and fixed the width.

```css
/* panels opt into container context */
@utility panel { container-type: inline-size; }
```

```jsx
/* inside a panel, adapt to the PANEL not the screen */
<div className="@container">
  <div className="grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-4">
```

Tailwind v4 ships `@container` variants natively. **This is the single most
important structural decision in the plan.** Every panel component must be
container-query driven so it can be placed anywhere in the grid.

### 2.4 Other 2026 techniques to use (each must earn its place)

| Technique | Where | Why |
|---|---|---|
| `subgrid` | Stat cluster rows, account rows | Aligns label/value/delta baselines *across* panels. Removes the ragged look. |
| `content-visibility: auto` | Leave calendar months, payslip history | Skips offscreen layout. Replaces virtualization for < 200 rows. |
| `text-wrap: pretty` / `balance` | Headings, captions | Kills widows. One line of CSS. |
| `field-sizing: content` | Amount inputs in sheets | Input grows to the number. |
| `color-mix()` in OKLCH | Derive hover/active from accent | Stops hand-picked near-duplicate hexes drifting. |
| View Transitions API | Route changes between the 3 tabs | Cross-fade only, gated on `prefers-reduced-motion`. |
| Popover API + CSS anchor positioning | Range selector, account menus | Removes JS positioning and a focus-trap class of bugs. |
| `dvh` / `svh` | Sheets, mobile shell | Already partly used. Finish the job. No `h-screen` anywhere. |
| `@media (prefers-reduced-transparency)` | Any scrim or overlay | Required if any translucency is introduced. |

**Explicitly rejected:** glassmorphism, mesh gradients, scroll hijack, marquees,
parallax, magnetic hover, custom cursors, GSAP. None of them serve a money
instrument, all of them are on the AI-tell list.

---

## 3. Screen-by-screen target composition

Desktop composition first, mobile collapse stated for every one. Mobile is a strict
single column at `< 768px` in all cases; the tab bar stays.

### 3.1 Home (`/`)
The screen answers "where am I, right now".

```
lg 12-col:
+----------------------------------+------------------+
| PRIMARY READ  net worth          | LEAVE gauge      |
| display-lg, delta, staleness     | ring + figures   |
| span 8, on the accent axis rule  | span 4           |
+----------------------------------+------------------+
| NET WORTH CURVE (12m)            | ACCOUNTS         |
| span 8, height 260               | grouped rows     |
|                                  | span 4, subgrid  |
+----------------------------------+------------------+
```
- The chart moves to Home. Today the primary number and its curve live on
  different screens, which is the real information-architecture bug.
- Kill `NavCard`. The sidebar is the navigation; duplicate nav cards are filler.
- Mobile: primary read, curve, leave gauge, accounts. One column, in that order.

### 3.2 Finance (`/finance`)
- Promote the total to a real primary read (currently only a caption plus chart).
- Chart span 8, account list span 4, both on one row instead of stacked full-width.
- Range selector moves into the chart panel header, not a full-width bar.
- Mobile: total, range, chart, accounts.

### 3.3 Funds (`/finance/funds`, `/finance/funds/[slug]`)
- Index: card grid, `@container` driven, 2-up at 560px, 3-up at 900px, 4-up at 1200px.
- Detail: value + gain panel span 7, settings form span 5.
- `MonthlyGainPanel` currently renders a hairline under every row. Regroup into
  chunks with sparse dividers (Section 4.9 of the taste skill, and the
  `border-t + border-b` ban).

### 3.4 Vacation fund (`/finance/vacation`)
- Balance primary read span 5, withdrawal flow span 7.
- Withdrawal sheet keeps its multi-step flow untouched (logic is tested).

### 3.5 Work (`/work`)
- The 4-gauge `StatGrid` spans 12 at lg and becomes 4-up instead of 2x2.
- Leave calendar span 7, salary section span 5.
- `LeaveByMonth`: months become a `content-visibility: auto` list; the per-row
  hairlines collapse into per-month groups.

### 3.6 Verify (`/work/verify/[id]`)
Highest-value screen for the desktop fix: today the PDF preview and the form fight
for 896px.
- PDF iframe span 7, sticky, full available height.
- Verify form span 5, scrollable independently, field confidence inline.
- Mobile: keep the current stacked order. Do not attempt side-by-side.

### 3.7 Settings (`/settings`)
- Two-column `SettingsSection` layout at lg: description left span 5, controls
  right span 7. This is the one place the split-header pattern is legitimate,
  because the right column carries controls, not filler prose.
- Mobile: stacked, unchanged.

### 3.8 Sign-in (`/signin`)
- Only pre-auth surface. Keep centred (the message is the design, per the skill's
  own override for manifesto layouts). Mark stays 32px above the wordmark.

---

## 4. Component work

| Component | Action |
|---|---|
| `AppShell` | Fluid content wrapper, 240px sidebar, sticky sidebar, view transitions, skip link |
| **new** `PageGrid` | The 12/8/4 column primitive. Pages compose with it; no page hand-rolls a grid |
| **new** `Panel` | `container-type: inline-size`, optional header slot, hairline grouping, no default card chrome |
| `PageHeader` | Grid-aware, action slot right-aligned, keeps `axis-rule` |
| `StatTile` / `StatGrid` | Add `@container` responsiveness, `subgrid` row alignment, keep `emphasis` |
| `AccountRow` | Subgrid columns so name/spark/value/staleness align across all rows |
| `TimeSeriesChart` | Fluid width via `ResizeObserver`, not fixed height. Axis labels inside viewBox. Theme-token colours |
| `Sparkline` | Unchanged API, container-aware sizing |
| `MonthlyGainPanel` | Regroup rows into chunks, drop per-row hairlines |
| `LeaveByMonth` | `content-visibility: auto`, grouped dividers |
| `NavCard` | **Delete.** Sidebar is the navigation |
| `Sheet` / `SheetForm` | `dvh`, `overscroll-behavior: contain`, focus trap audit, `field-sizing` |

---

## 5. Guardrails every agent must satisfy

### 5.1 Web Interface Guidelines (fetched 2026-09-01, vercel-labs)

Applied to this app specifically. Each is a Playwright-checkable or grep-checkable
assertion in Step 8.

- **Accessibility:** icon-only buttons need `aria-label` (settings link, theme
  toggle, sheet close). Decorative icons `aria-hidden`. Semantic `<button>` vs
  `<a>`. Hierarchical headings, one `<h1>` per route. **Add a skip link** (missing
  today). `scroll-margin-top` on anchors.
- **Focus:** visible `:focus-visible` on every interactive element. Never
  `outline-none` without replacement. Sticky sidebar and bottom tab bar must not
  cover the focused element.
- **Forms:** `autocomplete` and meaningful `name`. Correct `type` and `inputmode`
  (`inputmode="decimal"` on amount fields). Never block paste. Labels clickable.
  `spellCheck={false}` on codes. Submit stays enabled until request starts.
  Errors inline, focus first error. Placeholders end with the ellipsis character.
- **Typography:** single ellipsis character, not three dots. Curly quotes.
  Non-breaking spaces in units and brand names. Loading states end with an
  ellipsis. `tabular-nums` on all number columns. `text-wrap: balance` on headings.
- **Content handling:** flex children need `min-w-0`. Long account names must
  `truncate`. Empty states for every list.
- **Navigation & state:** URL reflects state. The finance range selector and the
  selected account currently live in `useState`; **move both to query params** so
  a view is linkable and back/forward works.
- **Touch:** `touch-action: manipulation`, intentional `-webkit-tap-highlight-color`,
  `overscroll-behavior: contain` in sheets.
- **Safe areas:** `env(safe-area-inset-*)` on the tab bar (partly done, verify).
- **Dark mode:** `color-scheme` already set. Verify `<meta name="theme-color">`
  matches both grounds.
- **Locale:** `Intl.NumberFormat` / `Intl.DateTimeFormat` only. Verify
  `src/lib/format.ts` has no hardcoded formats. Wrap brand names `translate="no"`.
- **Anti-patterns to grep for:** `transition: all`, `outline-none`, `h-screen`,
  `<div onClick`, images without dimensions, `user-scalable=no`.

### 5.2 Craft rules carried from `design-taste-frontend`

- **Zero em-dashes and en-dashes in rendered UI copy.** Note: ~25 remain in prose
  helper text today (payslip hints, empty states). This redesign is the moment to
  clear them. Rewrite as two sentences, a comma, or parentheses. Do **not** alter
  the meaning of payslip field hints that mirror real payslip labels.
- One accent, one radius system, one theme per page.
- No card unless elevation encodes real hierarchy. At density 8, generic card
  containers are banned outright.
- Full interactive state cycles: loading skeleton matching final shape, empty,
  error, `:active` tactile feedback.
- No AI tells: no section-number eyebrows, no decorative status dots, no scroll
  cues, no version footers, no fake precision, no locale strips.
- Eyebrow budget: at most 1 per 3 sections per screen.

### 5.3 Performance

LCP < 2.5s, INP < 200ms, CLS < 0.1. Charts must reserve height before data arrives
(current skeletons do this; keep it). No layout reads in render. Sidebar and tab
bar must not cause CLS on first paint.

---

## 6. Multi-agent execution

**File ownership is disjoint by design.** No two agents in the same wave touch the
same file, so there are no merge conflicts.

### Wave 0 - foundation (blocking, run alone)

| Agent | Owns | Skill |
|---|---|---|
| **A1 Layout Architect** | `globals.css`, `AppShell.tsx`, `PageHeader.tsx`, new `PageGrid.tsx`, new `Panel.tsx` | `/web-design-guidelines` (installed, 598.5K) plus `giuseppe-trisciuoglio/developer-kit@tailwind-css-patterns` (15.7K) |

A1 delivers the grid primitives, container-query utilities, subgrid helpers, the
skip link, and the widened shell. **Nothing else starts until A1 lands and
typecheck passes.** A1 must also write a one-page usage note for A2 to A4 describing
`PageGrid` and `Panel` props.

### Wave 1 - screens (parallel, 4 agents)

| Agent | Owns | Skill |
|---|---|---|
| **A2 Finance** | `app/(app)/finance/**` | `vercel-labs/agent-skills@vercel-react-best-practices` (681.9K) |
| **A3 Work** | `app/(app)/work/**` | same |
| **A4 Home + Settings + Auth** | `app/(app)/page.tsx`, `app/(app)/settings/**`, `app/(auth)/**` | same |
| **A5 Charts + shared UI** | `components/chart/**`, `StatTile`, `AccountRow`, `MoneyValue`, `Sheet*` | `/dataviz` (installed) |

Install for Wave 1: `npx skills add vercel-labs/agent-skills@vercel-react-best-practices -g -y`

### Wave 2 - audit (sequential after Wave 1)

| Agent | Owns | Skill |
|---|---|---|
| **A6 Accessibility & Guidelines** | read-only audit, then fixes in any file | `addyosmani/web-quality-skills@accessibility` (49.3K) plus `/web-design-guidelines` |

A6 runs the full Section 5.1 checklist and reports `file:line` findings, then fixes.

### Wave 3 - verification

| Agent | Owns | Skill |
|---|---|---|
| **A7 Playwright verification** | `tests/e2e/**`, screenshots | `currents-dev/playwright-best-practices-skill@playwright-best-practices` (78.1K) |

Install: `npx skills add currents-dev/playwright-best-practices-skill@playwright-best-practices -g -y`

**Note on skill selection:** searches for dashboard-specific and design-token
skills returned nothing above ~340 installs, well under the 1K quality bar
`find-skills` sets. Those areas are covered by installed skills plus `BRAND.md`
rather than by low-confidence third-party packages.

---

## 7. Order of work

1. A1 foundation. Gate: `typecheck` plus `test` plus `build` green.
2. Wave 1 in parallel. Gate per agent: typecheck green, no cross-file edits.
3. Integration: run full suite. Gate: 555 tests still pass.
4. A6 audit and fixes. Gate: zero findings outstanding, or each documented.
5. A7 Playwright verification (Step 8).
6. Deploy.
7. Delete this plan.

---

## 8. Playwright verification (the acceptance gate)

Run against `npm run dev` on a spare port with a stub session cookie, and against
`/preview` for the component harness.

**Automated assertions:**

1. **Space utilisation.** At 1280 / 1440 / 1920 / 2560, measured dead space in the
   content area must be **under 12%** at every width. This is the headline
   acceptance criterion. Record the same table as Section 0 and compare.
2. **No horizontal scroll.** `document.body.scrollWidth <= innerWidth` at 360, 390,
   768, 1024, 1440, 1920.
3. **Both themes.** Every route screenshotted in light and dark. No section may
   render one theme's text on the other's ground.
4. **Focus visibility.** Tab through each route; assert every focused element has a
   non-zero outline or ring, and is not covered by the sidebar or tab bar.
5. **Contrast.** Assert WCAG AA on body text and all CTA labels in both themes.
6. **Dash sweep.** Assert zero em-dash and en-dash characters in rendered
   `textContent` of every route and in `aria-label` values.
7. **Reduced motion.** With `prefers-reduced-motion: reduce`, assert no animation
   longer than 0.01s runs.
8. **Anti-pattern grep:** `transition: all`, `outline-none`, `h-screen`,
   `<div onClick`, `window.addEventListener("scroll"`.
9. **Route health.** Every route returns 200 and renders its `<h1>`.

**Manual review:** desktop and mobile screenshots of all 8 routes, both themes,
presented for sign-off before deploy.

**Rollback:** all work on a branch. If the gate fails and cannot be fixed in the
session, `git checkout main` and redeploy the previous image. The current design is
committed and deployable.

---

## 9. Close-out

1. `npm run typecheck && npm test && npm run build` all green.
2. `docker compose build dashboard-app && docker compose up -d dashboard-app`,
   confirm `healthy`.
3. Verify brand assets still serve (`/brand/*.svg`, `/icon-*.png`, manifest).
4. `graphify update .`
5. Commit on a branch, do not push without asking.
6. **Delete `REDESIGN_PLAN.md`** and confirm deletion in the final report.

---

## Resolved: information architecture

**Approved 2026-09-02.** The net-worth curve belongs on Home, next to the figure
it describes. Done ahead of the redesign in commit `chart on home`:

- Home now renders a fixed 12-month net-worth curve directly beneath the primary
  read, built server-side (`netWorthSeries`) so Home stays a Server Component.
- `/finance` keeps its interactive chart. It is the drill-down (range selector,
  per-account selection); Home is the first read. They are different jobs, so the
  chart was added to Home rather than removed from Finance. If you want Finance
  stripped to an account list, say so and Wave 1 does it.
- `NavCard` deletion on Home is still part of Wave 1 (Section 3.1), not yet done.

Wave 1 therefore starts from a Home that already has the curve; A4 places it into
the 12-column grid (span 8) rather than introducing it.
