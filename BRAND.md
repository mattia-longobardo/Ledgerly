# Finance Dashboard — Brand System

> **Your money, instrumented.**

A single-user, self-hosted instrument for reading and controlling personal
finance. Not a bank, not a budgeting app with a mascot: a cockpit. The identity
follows the design direction the UI already ships under — *Instrument*, a
dense-data cockpit — rather than sitting on top of it.

---

## 1. Strategy

| | |
|---|---|
| **Category** | Self-hosted personal finance instrument |
| **Audience** | One owner-operator who runs their own stack |
| **Promise** | Every number current, sourced, and legible at a glance |
| **Personality** | Precise, quiet, unsentimental, dense but calm |
| **Core metaphor** | The instrument panel — a reading, not a recommendation |
| **Avoid** | Bank blues, coins and piggy banks, growth-arrow clip art, motivational finance language, gamified confetti |

The product's job is to *tell the truth about a number and where it came from*.
Everything visual should defer to that: the data is the hero, the brand is the
frame around it.

---

## 2. The mark

A monogram **F** standing on a chart axis.

```
 ██████████████         ← long bar
 ██                     ← stem
 ██████████     (accent)← short bar: the current value
 ██
 ██
 ────────────────       ← axis rule, overshooting both sides
```

**How it is built** — a 48-unit grid, one stroke weight (6u) for every letter
stroke:

| Element | x | y | w | h |
|---|---|---|---|---|
| Axis rule | 3 | 40 | 42 | 2.5 |
| Stem | 8 | 6 | 6 | 30 |
| Long bar | 8 | 6 | 27 | 6 |
| Short bar *(accent)* | 8 | 18 | 19 | 6 |

**Why it works.** Two ideas are fused, and only two: the brand initial, and the
product's action. Read as a letter it is an F. Read as a chart it is two bars of
different length measured against an axis — comparison, which is the single
thing this product does on every screen.

Three decisions carry it:

1. **The axis rule overshoots the stem on both sides.** This is the load-bearing
   detail. Flush to the stem, the rule reads as a third arm and the mark becomes
   an *E*. Overshooting left of the stem — as a real chart's baseline does past
   its origin — makes it structure instead of letterform.
2. **The glyph floats clear of the rule.** A 4-unit gap separates the stem's foot
   from the axis. The F sits *on* the chart; it is not part of it.
3. **The short bar is always the accent.** It is the one fixed point of the
   identity and the only colour in the mark. It reads as the live value.

**Clearspace.** One stem-width (6u, = 12.5% of the mark's height) on all sides.
Never crowd the axis overshoot — it is the part that makes the mark legible.

**Minimum size.** 16px. Verified: at 16–32px the accent bar and axis rule both
still resolve. Below that, use `mark-mono.svg`.

**Never:** re-colour the letter strokes; add a second accent; outline it; set it
on a gradient; rotate it; stretch it; enclose it in a circle; add a shadow;
animate the accent bar as a loading state.

---

## 3. Assets

| File | Use |
|---|---|
| `public/brand/mark.svg` | Two-tone mark, dark backgrounds |
| `public/brand/mark-light.svg` | Two-tone mark, light backgrounds |
| `public/brand/mark-mono.svg` | `currentColor`, single-colour contexts and tiny sizes |
| `public/brand/lockup.svg` | Horizontal mark + wordmark |
| `public/brand/icon.svg` | App icon, rounded square |
| `public/brand/icon-maskable.svg` | Full-bleed, for Android maskable |
| `public/icon-192.png` `icon-512.png` `icon-512-maskable.png` `apple-icon.png` | Rasterised PWA / touch icons |

**In the app, use the component, not the file.** `src/components/ui/Brand.tsx`
exports `BrandMark` and `BrandLockup`; the mark takes `currentColor` for its
letter strokes so it inherits the theme, while the accent bar stays fixed. The
SVG files exist for surfaces React does not render (manifest, favicon, exports).

Geometry is duplicated between `Brand.tsx` and `public/brand/*.svg` — **change
both together.** `render_icons.py`'s geometry table must match as well; it is
what produces the PNGs (there is no rasteriser on the deploy host).

---

## 4. Colour

The palette is not new — it is the app's shipping token set in
`src/styles/globals.css`. The brand consumes semantic tokens, never raw hex.

**Dark (primary surface)**

| Token | Hex | Role |
|---|---|---|
| `--c-bg` | `#0c0e12` | Canvas |
| `--c-surface` | `#14171d` | Panels |
| `--c-fg` | `#e6eaf0` | Letter strokes, primary text |
| `--c-fg-muted` | `#8b94a3` | Axis rule, secondary text |
| `--c-accent` | `#22d3ee` | **The short bar.** One accent, everywhere |
| `--c-positive` | `#34d399` | Gain |
| `--c-negative` | `#f87171` | Loss |
| `--c-warning` | `#fbbf24` | Stale / needs verifying |
| `--c-border` | `#232830` | Hairlines |

**Light** — first-class, not an afterthought: `#f4f5f7` canvas, `#15181d` text,
accent darkens to `#0e7490` to hold contrast on white.

**Discipline.** One accent carries the whole system. Positive/negative/warning
are *state*, never decoration — if a colour appears and does not encode a fact
about the data, remove it. Never signal by colour alone; pair it with weight, a
sign, or a label.

---

## 5. Typography

**IBM Plex Sans** (400/500/600) and **IBM Plex Mono** (400/500/600), vendored
locally — the image builds without network access and CSP pins `font-src 'self'`.

Plex is the right voice here: it is an engineering typeface with warmth, drawn
for instrumentation and reading dense figures. It is doing the work already; the
brand does not introduce a display face on top of it.

**The rule that matters: every number is mono and tabular.** Money must never
shift width as it updates. The `.num` / `[data-num]` class exists for this and is
not optional.

Wordmark: Plex Sans 600 "Finance" + 400 "Dashboard", tracking `-0.5`. The weight
split carries the hierarchy — never split it by colour alone.

Scale is token-driven (`--text-caption` → `--text-display`); do not introduce
sizes outside it.

---

## 6. Voice

Short, factual, and specific about provenance. State the number, then where it
came from and how fresh it is. No exclamation marks, no encouragement, no advice.

| Write | Not |
|---|---|
| "Updated 4 hours ago" | "You're all caught up! 🎉" |
| "Needs verifying — 3 fields below confidence" | "Oops, something looks off" |
| "Sign-in failed. Try again — the error was logged." | "Uh oh! Please try again later" |

Tagline: **Your money, instrumented.** Use it once, on the sign-in screen or a
README header. Never stack it under the logo in the app chrome.

---

## 7. Applications

- **App chrome** — `BrandLockup` at the head of the desktop sidebar. The mobile
  tab bar carries no logo; screen real estate goes to data.
- **Sign-in** — the one pre-auth surface. Mark at 32px above the wordmark.
- **PWA / home screen** — rounded-square icon, `#0c0e12` ground.
- **Notifications** — Gotify alerts title as `Finance Dashboard: <job> <state>`.
- **Charts** — uPlot series use `--c-chart-1…6`, starting at the accent. The mark
  never appears inside a chart.
