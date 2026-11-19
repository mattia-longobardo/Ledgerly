// The scales of the design: type, radii, tracking, small shadows, stacking. Each entry becomes a
// Tailwind theme variable (`--text-kpi` → `text-kpi`), so a screen never writes a value by hand.

/** One inherited line height, 1.45, as in the design: Tailwind's own per-size defaults are replaced. */
export const TEXT: Record<string, { size: string; lineHeight?: string }> = {
  micro: { size: "10px" },
  xs: { size: "11px", lineHeight: "1.45" },
  sm: { size: "12px", lineHeight: "1.45" },
  base: { size: "13px", lineHeight: "1.45" },
  md: { size: "14px" },
  lg: { size: "15px", lineHeight: "1.45" },
  xl: { size: "17px", lineHeight: "1.45" },
  "2xl": { size: "20px", lineHeight: "1.45" },
  kpi: { size: "22px" },
  title: { size: "24px" },
  "hero-sm": { size: "28px" },
  hero: { size: "32px" },
  display: { size: "36px" },
};

/** Corners: the three of the design (`ctl`, `card`, `modal`) and the small ones of tags and marks (UI-DS-16). */
export const RADIUS = {
  xs: "2px",
  "xs-plus": "3px",
  sm: "4px",
  tag: "5px",
  ctl: "6px",
  seg: "7px",
  card: "10px",
  modal: "12px",
} as const;

/** Letter spacing of titles and of small capitals (UI-DS-17). */
export const TRACKING = {
  title: "-0.02em",
  snug: "-0.01em",
  caps: "0.04em",
} as const;

/** The small shadows: the pressed item of a segmented control, the ring of a switch's thumb (UI-DS-1). */
export const SMALL_SHADOWS = {
  pressed: "0 1px 2px rgba(0, 0, 0, 0.08)",
  ring: "0 0 0 1px var(--border)",
} as const;

/** The wide threshold of spec §8.2 (F2.5): a page column of 1600 px and more gets a third band. */
export const CONTAINERS = { wide: "100rem" } as const;

export const FONTS = {
  sans: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;
