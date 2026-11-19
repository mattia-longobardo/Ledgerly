// The theme a screen is drawn in (spec §8.1): the person's preference and the colour scheme it
// resolves to. The web app's first paint (`apps/web/src/platform/theme.ts`) reads the same rule.

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === "dark" || (preference === "system" && prefersDark) ? "dark" : "light";
}
