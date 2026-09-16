import { describe, expect, it } from "vitest";
import { spanMonths, withParams } from "./controls";

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

describe("spanMonths", () => {
  it("reads the design's spans, and counts YTD from January", () => {
    expect(spanMonths("3m", 9)).toBe(3);
    expect(spanMonths("6m", 9)).toBe(6);
    expect(spanMonths("1y", 9)).toBe(12);
    expect(spanMonths("2y", 9)).toBe(24);
    expect(spanMonths("ytd", 9)).toBe(9);
    expect(spanMonths("ytd", 1)).toBe(1);
  });

  it("falls back to a year when nothing was chosen", () => {
    expect(spanMonths(undefined, 9)).toBe(12);
  });
});
