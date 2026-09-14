import { describe, expect, it } from "vitest";
import { initialThemeAttribute, parseTheme, THEME_COOKIE, THEME_SCRIPT } from "./theme";

describe("theme", () => {
  it("parses the cookie, defaulting to light (spec §8.1)", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("neon")).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
  });

  it("renders light for system; the inline script resolves it before paint", () => {
    expect(initialThemeAttribute("dark")).toBe("dark");
    expect(initialThemeAttribute("system")).toBe("light");
    expect(initialThemeAttribute(undefined)).toBe("light");
    expect(THEME_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_SCRIPT).toContain(`${THEME_COOKIE}=`);
  });
});
