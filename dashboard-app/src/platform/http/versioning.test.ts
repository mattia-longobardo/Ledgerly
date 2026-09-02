import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { parseExpectedVersion } from "./versioning";

describe("parseExpectedVersion", () => {
  it("reads If-Match first, then body.version", () => {
    expect(parseExpectedVersion({ ifMatch: "3", body: { version: 1 } })).toBe(3);
    expect(parseExpectedVersion({ ifMatch: null, body: { version: 2 } })).toBe(2);
  });
  it("throws a 428 when neither is present", () => {
    expect(() => parseExpectedVersion({ ifMatch: null, body: {} })).toThrow(ApiError);
  });
});
