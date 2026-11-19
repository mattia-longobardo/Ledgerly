// The colours of a chart's series (audit UI-DS-19): one palette for the accounts, the categories
// and the gains and losses of a chart, here with every other visual value rather than in a module.

/**
 * The colours of the accounts, in order; an account's own colour wins when it has one. The same
 * family as the category colours (`CATEGORY_COLORS`), a little darker so that white text on an
 * account card stays readable, and ordered so that neighbours never share a hue.
 */
export const PALETTE = [
  "#3c79f0", // blue
  "#eb6202", // orange
  "#35ad44", // green
  "#da3aa4", // magenta
  "#01a4b9", // cyan
  "#d98b09", // amber
  "#8f54dc", // violet
  "#ea3c3f", // red
  "#03a578", // emerald
  "#0a96d6", // light blue
  "#645fdf", // indigo
  "#616a75", // slate
] as const;

/** A gain and a loss where a chart of one thing colours its bars by sign: the palette's own. */
export const GAIN_COLOR = PALETTE[2];
export const LOSS_COLOR = PALETTE[7];
