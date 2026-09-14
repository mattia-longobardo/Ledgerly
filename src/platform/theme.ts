export const THEME_COOKIE = "theme";
export type ThemePreference = "system" | "light" | "dark";

/** Light is the default theme (spec §8.1); System and Dark are explicit choices. */
export function parseTheme(value: string | undefined): ThemePreference {
  return value === "system" || value === "dark" ? value : "light";
}

/** Server-rendered attribute. "system" renders light and THEME_SCRIPT corrects it before first paint. */
export function initialThemeAttribute(value: string | undefined): "light" | "dark" {
  return parseTheme(value) === "dark" ? "dark" : "light";
}

export const THEME_SCRIPT = `(()=>{try{const m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/);const p=m?m[1]:"light";document.documentElement.dataset.theme=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p}catch{}})()`;
