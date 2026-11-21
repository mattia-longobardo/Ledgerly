import { describe, expect, it } from "vitest";
import { modifiedDietz, periodReturn, returnOnNetCapital, returnOnPaidIn } from "./returns";

describe("returnOnPaidIn", () => {
  it("divides the gain by the money paid in", () => {
    expect(returnOnPaidIn(1_000n, 10_000n)).toBe(0.1);
    expect(returnOnPaidIn(-2_500n, 10_000n)).toBe(-0.25);
  });

  it("has no rate without money paid in", () => {
    expect(returnOnPaidIn(1_000n, 0n)).toBeNull();
    expect(returnOnPaidIn(1_000n, -1n)).toBeNull();
  });
});

describe("returnOnNetCapital", () => {
  it("divides the P&L by the net capital", () => {
    expect(returnOnNetCapital(500n, 5_000n)).toBe(0.1);
  });

  it("has no rate when the net capital is not above zero", () => {
    expect(returnOnNetCapital(500n, 0n)).toBeNull();
    expect(returnOnNetCapital(500n, -100n)).toBeNull();
  });
});

describe("periodReturn", () => {
  it("is Modified Dietz when the period has a capital", () => {
    const input = {
      from: "2026-01-01",
      to: "2026-06-30",
      startCents: 100_000n,
      endCents: 115_000n,
      pnlCents: 5_000n,
      flows: [{ on: "2026-04-01", cents: 10_000n }],
    };
    const measured = periodReturn(input);
    expect(measured.method).toBe("dietz");
    expect(measured.dietz).toBe(modifiedDietz(input).rate);
    expect(measured.xirr).toBeNull();
    expect(measured.largeFlows).toBe(false);
  });

  it("is the P&L on the money put in when the money went in and out inside the period", () => {
    const measured = periodReturn({
      from: "2026-01-01",
      to: "2026-12-31",
      startCents: 0n,
      endCents: 0n,
      pnlCents: 2_000n,
      flows: [
        { on: "2026-01-02", cents: 10_000n },
        { on: "2026-01-03", cents: -12_000n },
      ],
    });
    expect(measured.method).toBe("invested");
    expect(measured.dietz).toBe(0.2);
    expect(measured.largeFlows).toBe(true);
  });

  it("measures the XIRR over a year or more", () => {
    const measured = periodReturn({
      from: "2025-01-01",
      to: "2026-12-31",
      startCents: 100_000n,
      endCents: 110_000n,
      pnlCents: 10_000n,
      flows: [],
    });
    expect(measured.xirr?.status).toBe("ok");
  });
});
