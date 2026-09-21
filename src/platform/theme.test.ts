import { describe, expect, it } from "vitest";
import {
  parseTheme,
  requestThemePreference,
  resolveTheme,
  THEME_SCRIPT,
  type ThemePreference,
} from "./theme";

/** Runs the pre-paint script against a stand-in <html> element and media query. */
function runThemeScript(themePref: string | undefined, prefersDark: boolean): string | undefined {
  const dataset: Record<string, string | undefined> = { themePref };
  const document = { documentElement: { dataset } };
  const matchMedia = () => ({ matches: prefersDark });
  new Function("document", "matchMedia", THEME_SCRIPT)(document, matchMedia);
  return dataset.theme;
}

describe("theme", () => {
  it("parses the cookie, defaulting to light (spec §8.1)", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("neon")).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
  });

  it("renders the signed-in user's saved preference over the cookie", () => {
    expect(requestThemePreference("system", "dark")).toBe("system");
    expect(requestThemePreference("light", "dark")).toBe("light");
    expect(requestThemePreference(null, "dark")).toBe("dark");
    expect(requestThemePreference(null, undefined)).toBe("light");
  });

  it("resolves System through the colour-scheme media query", () => {
    const cases: [ThemePreference, boolean, "light" | "dark"][] = [
      ["light", true, "light"],
      ["dark", false, "dark"],
      ["system", false, "light"],
      ["system", true, "dark"],
    ];
    for (const [preference, prefersDark, expected] of cases)
      expect(resolveTheme(preference, prefersDark)).toBe(expected);
  });

  it("resolves the rendered preference before first paint, the same way", () => {
    expect(runThemeScript("dark", false)).toBe("dark");
    expect(runThemeScript("light", true)).toBe("light");
    expect(runThemeScript("system", true)).toBe("dark");
    expect(runThemeScript("system", false)).toBe("light");
    expect(runThemeScript(undefined, true)).toBe("light");
  });
});
