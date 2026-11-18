export type Tone = "fg" | "muted" | "faint" | "accent" | "pos" | "neg" | "warn";

export const TONE_TEXT: Record<Tone, string> = {
  fg: "text-fg",
  muted: "text-muted",
  faint: "text-faint",
  accent: "text-accent",
  pos: "text-pos",
  neg: "text-neg",
  warn: "text-warn",
};

/** Colour for a signed figure: gains green, losses red, zero and unknown muted. */
export function toneOfSign(value: bigint | number | null): Tone {
  if (value === null || value === 0 || value === 0n) return "muted";
  return value > 0 ? "pos" : "neg";
}
