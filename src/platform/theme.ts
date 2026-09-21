export const THEME_COOKIE = "theme";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Light is the default theme (spec §8.1); System and Dark are explicit choices. */
export function parseTheme(value: string | undefined): ThemePreference {
  return value === "system" || value === "dark" ? value : "light";
}

/**
 * The preference a request renders with: the signed-in user's saved one, otherwise the cookie that
 * the last save left behind (anonymous pages such as sign-in).
 */
export function requestThemePreference(
  saved: ThemePreference | null,
  cookie: string | undefined,
): ThemePreference {
  return saved ?? parseTheme(cookie);
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === "dark" || (preference === "system" && prefersDark) ? "dark" : "light";
}

/**
 * Runs in <head> before first paint: resolves the preference the server rendered as
 * `data-theme-pref` on <html> into `data-theme`. From then on ThemeProvider owns `data-theme`.
 */
export const THEME_SCRIPT = `(()=>{try{const d=document.documentElement,p=d.dataset.themePref;d.dataset.theme=p==="dark"||(p==="system"&&matchMedia("${PREFERS_DARK_QUERY}").matches)?"dark":"light"}catch{}})()`;
