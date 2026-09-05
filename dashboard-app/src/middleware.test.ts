import { describe, expect, it } from "vitest";
import { frameAncestorsFor } from "./middleware";

describe("frameAncestorsFor", () => {
  it("allows same-origin framing for the payslip original route only", () => {
    expect(frameAncestorsFor("/api/v1/payroll/imports/abc-123/original")).toBe("'self'");
  });

  it("refuses the five JSON action routes under the same import prefix", () => {
    const id = "abc-123";
    expect(frameAncestorsFor(`/api/v1/payroll/imports/${id}`)).toBe("'none'");
    expect(frameAncestorsFor(`/api/v1/payroll/imports/${id}/verify`)).toBe("'none'");
    expect(frameAncestorsFor(`/api/v1/payroll/imports/${id}/reject`)).toBe("'none'");
    expect(frameAncestorsFor(`/api/v1/payroll/imports/${id}/apply`)).toBe("'none'");
    expect(frameAncestorsFor(`/api/v1/payroll/imports/${id}/retry`)).toBe("'none'");
  });

  it("refuses the bare imports collection and any other path", () => {
    expect(frameAncestorsFor("/api/v1/payroll/imports")).toBe("'none'");
    expect(frameAncestorsFor("/")).toBe("'none'");
    expect(frameAncestorsFor("/api/paperless/preview/abc-123")).toBe("'none'");
  });

  it("does not treat a nested or trailing path as the original route", () => {
    // A stray extra segment must not sneak past the exact-suffix check.
    expect(frameAncestorsFor("/api/v1/payroll/imports/abc-123/original/extra")).toBe("'none'");
    expect(frameAncestorsFor("/api/v1/payroll/imports/abc-123/original/")).toBe("'none'");
  });
});
