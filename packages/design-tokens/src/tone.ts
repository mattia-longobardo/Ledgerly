// The tones a figure or a note can take: a subset of the colours, as Tailwind text classes.

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
