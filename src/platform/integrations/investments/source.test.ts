// The error allowlist of the investment sources (docs/design/investments.md §5.1, SEC-04).
import { describe, expect, it } from "vitest";
import { plainNumber, SourceError, sourceErrorLog, sourceErrorText } from "./source";

const CANARY = "canary-secret-0d9e";

describe("sourceErrorText", () => {
  it("keeps only provider, class and status", () => {
    expect(sourceErrorText("etoro", new SourceError("etoro", "auth", 401))).toBe("etoro · auth · 401");
    expect(sourceErrorText("etoro", new SourceError("etoro", "timeout"))).toBe("etoro · timeout");
  });

  it("says nothing more than 'error' about anything else, whatever it carries", () => {
    for (const error of [
      new Error(CANARY),
      CANARY,
      { message: CANARY },
      new RangeError(`https://x?key=${CANARY}`),
    ]) {
      expect(sourceErrorText("etoro", error)).toBe("etoro · error");
      expect(JSON.stringify(sourceErrorLog("etoro", error))).not.toContain(CANARY);
    }
  });

  it("does not trust a forged class, status or provider", () => {
    const forged = Object.assign(new SourceError("etoro", "auth", 401), { errorClass: CANARY, status: 9999 });
    expect(sourceErrorText("etoro", forged)).toBe("etoro · error");
    expect(sourceErrorText("etoro", Object.assign(new SourceError("etoro", "auth"), { status: 9999 }))).toBe(
      "etoro · auth",
    );
    expect(sourceErrorText(`etoro ${CANARY} <b>`, new SourceError("etoro", "auth"))).toBe("provider · auth");
  });
});

describe("plainNumber", () => {
  it("never writes an exponent", () => {
    expect(plainNumber(1e-7)).toBe("0.0000001");
    expect(plainNumber(0.07337507)).toBe("0.07337507");
    expect(plainNumber(418.5588)).toBe("418.5588");
    expect(plainNumber(-2)).toBe("-2");
    expect(() => plainNumber(Number.NaN)).toThrow(RangeError);
  });
});
