import type { Tone } from "@ledgerly/design-tokens";

export { TONE_TEXT, type Tone } from "@ledgerly/design-tokens";

/** Colour for a signed figure: gains green, losses red, zero and unknown muted. */
export function toneOfSign(value: bigint | number | null): Tone {
  if (value === null || value === 0 || value === 0n) return "muted";
  return value > 0 ? "pos" : "neg";
}
