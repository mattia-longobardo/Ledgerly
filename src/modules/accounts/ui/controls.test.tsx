import { describe, expect, it } from "vitest";
import { withParams } from "./controls";

describe("withParams", () => {
  it("keeps the parameters already on the page and changes the one asked for", () => {
    expect(withParams("/accounts", { grain: "year", off: "2" }, { off: "3" })).toBe(
      "/accounts?grain=year&off=3",
    );
  });

  it("drops a parameter set to its default, so the plain address stays clean", () => {
    expect(withParams("/accounts", { grain: "year" }, { grain: undefined })).toBe("/accounts");
    expect(withParams("/accounts", { off: "2" }, { off: "" })).toBe("/accounts");
  });

  it("escapes what it puts in the query string", () => {
    expect(withParams("/accounts", {}, { from: "2026-01" })).toBe("/accounts?from=2026-01");
  });
});
