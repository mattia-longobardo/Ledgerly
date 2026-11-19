// The colours of the two themes (spec §8.1), in pairs: a colour changes in both themes or in none
// (`AGENTS.md`, «What a screen has to be»).

const LIGHT = {
  bg: "#f7f7f8",
  card: "#ffffff",
  side: "#fbfbfc",
  border: "#e6e7ea",
  border2: "#d3d6db",
  fg: "#15181d",
  muted: "#5f6670",
  // The design's #9aa0a8 reads at 2.5:1 on this background: below AA for the small text it is used
  // for. Darkened to 4.75:1 on the sidebar's own background, the tightest one (owner, 2026-09-20).
  faint: "#6a7079",
  accent: "#0e7490",
  primary: "#0e7490",
  "primary-fg": "#ffffff",
  soft: "#e3f3f7",
  pos: "#047857",
  neg: "#b91c1c",
  warn: "#b45309",
  "pos-bg": "#ecfdf5",
  "neg-bg": "#fef2f2",
  "warn-bg": "#fffbeb",
  hover: "#f2f3f5",
  sel: "#eaf7fa",
  track: "#eceef1",
  skel: "#eef0f2",
  // What dims the page behind a dialog, a sheet or the palette (UI-DS-19).
  overlay: "rgba(10, 12, 16, 0.28)",
} as const;

type ColorToken = keyof typeof LIGHT;

const DARK: Record<ColorToken, string> = {
  bg: "#0e1012",
  card: "#16181b",
  side: "#111315",
  border: "#25282d",
  border2: "#353941",
  fg: "#e8e9ec",
  muted: "#9da3ab",
  // The dark twin of the note above: raised to 5.31:1 on `card` and 4.93:1 on `hover`, the tightest
  // background faint text sits on, while staying fainter than `muted` (F9 P2, measured 2026-09-21).
  faint: "#868d96",
  accent: "#5fcbe0",
  primary: "#0e7490",
  "primary-fg": "#ffffff",
  soft: "#0f2a31",
  pos: "#4ade80",
  neg: "#f87171",
  warn: "#fbbf24",
  "pos-bg": "#0f2a1c",
  "neg-bg": "#2c1515",
  "warn-bg": "#2a2210",
  hover: "#1c1f24",
  sel: "#0f2a31",
  track: "#25282d",
  skel: "#1f2226",
  overlay: "rgba(10, 12, 16, 0.28)",
};

/** The colours of each theme; light is the default (spec §8.1). */
export const COLORS: { light: Record<ColorToken, string>; dark: Record<ColorToken, string> } = {
  light: LIGHT,
  dark: DARK,
};

/** The raised shadow of each theme: popovers, menus, dialogs. */
export const SHADOWS = {
  light: "0 8px 24px rgba(16, 20, 28, 0.1), 0 1px 2px rgba(16, 20, 28, 0.06)",
  dark: "0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4)",
} as const;
