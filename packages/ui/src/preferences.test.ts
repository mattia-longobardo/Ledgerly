// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { browserPreferences } from "./preferences";

describe("browserPreferences", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.cookie = "sidebar=; path=/; max-age=0";
  });

  it("keeps a choice in storage and in the cookie the server render reads", () => {
    browserPreferences.write("sidebar", "collapsed");
    expect(browserPreferences.read("sidebar")).toBe("collapsed");
    expect(document.cookie).toContain("sidebar=collapsed");
  });

  it("reads nothing for a choice never made", () => {
    expect(browserPreferences.read("theme")).toBeNull();
  });
});
