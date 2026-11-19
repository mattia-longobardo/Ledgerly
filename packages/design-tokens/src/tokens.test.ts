import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORS, tokensCss } from "./index";

describe("design tokens", () => {
  it("are what tokens.css declares (`npm run tokens` writes it)", () => {
    expect(readFileSync(new URL("../tokens.css", import.meta.url), "utf8")).toBe(tokensCss());
  });

  it("give every colour a value in both themes", () => {
    expect(Object.keys(COLORS.dark).sort()).toEqual(Object.keys(COLORS.light).sort());
  });
});
