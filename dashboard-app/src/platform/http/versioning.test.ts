import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { parseExpectedVersion } from "./versioning";

describe("parseExpectedVersion", () => {
  it("reads If-Match first, then body.version", () => {
    expect(parseExpectedVersion({ ifMatch: "3", body: { version: 1 } })).toBe(3);
    expect(parseExpectedVersion({ ifMatch: null, body: { version: 2 } })).toBe(2);
  });
  it("throws a 428 precondition_required when neither is present", () => {
    expect(() => parseExpectedVersion({ ifMatch: null, body: {} })).toThrow(ApiError);
    try {
      parseExpectedVersion({ ifMatch: null, body: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(428);
      expect((err as ApiError).code).toBe("precondition_required");
    }
  });
});
