import { describe, expect, it } from "vitest";
import { reconcileInterest } from "./reconciliation";

const period = { start: "2026-09-01", end: "2026-10-01" };

describe("reconcileInterest", () => {
  it("matches when the paid total equals the accrued total within a cent", () => {
    const summary = reconcileInterest(
      [{ accrualDate: "2026-09-01", net: "0.63" }, { accrualDate: "2026-09-02", net: "0.63" }],
      [{ occurredAt: new Date("2026-09-30"), net: "1.26" }],
      period,
    );
    expect(summary).toMatchObject({ status: "matched", accruedTotal: "1.26", paidTotal: "1.26" });
  });

  it("reports missing when nothing was paid but interest accrued", () => {
    const summary = reconcileInterest([{ accrualDate: "2026-09-01", net: "0.63" }], [], period);
    expect(summary.status).toBe("missing");
  });

  it("reports delayed when less was paid than accrued but something did land", () => {
    const summary = reconcileInterest(
      [{ accrualDate: "2026-09-01", net: "0.63" }, { accrualDate: "2026-09-02", net: "0.63" }],
      [{ occurredAt: new Date("2026-09-15"), net: "0.63" }],
      period,
    );
    expect(summary.status).toBe("delayed");
  });

  it("reports anomalous when more was paid than accrued", () => {
    const summary = reconcileInterest([{ accrualDate: "2026-09-01", net: "0.63" }], [{ occurredAt: new Date("2026-09-15"), net: "5.00" }], period);
    expect(summary.status).toBe("anomalous");
  });

  // --- Boundary cases beyond the brief's happy-path set ---

  it("treats no accrual and no payment as matched, not missing", () => {
    const summary = reconcileInterest([], [], period);
    expect(summary).toMatchObject({ status: "matched", accruedTotal: "0.00", paidTotal: "0.00", differenceCents: 0 });
  });

  it("reports anomalous, not missing, when something was paid but nothing accrued", () => {
    const summary = reconcileInterest([], [{ occurredAt: new Date("2026-09-15"), net: "0.50" }], period);
    expect(summary.status).toBe("anomalous");
  });

  it("matches at exactly a 1-cent difference (rounding noise, not a discrepancy)", () => {
    const over = reconcileInterest([{ accrualDate: "2026-09-01", net: "1.00" }], [{ occurredAt: new Date("2026-09-15"), net: "1.01" }], period);
    expect(over).toMatchObject({ status: "matched", differenceCents: 1 });

    const under = reconcileInterest([{ accrualDate: "2026-09-01", net: "1.00" }], [{ occurredAt: new Date("2026-09-15"), net: "0.99" }], period);
    expect(under).toMatchObject({ status: "matched", differenceCents: -1 });
  });

  it("flags a 2-cent overpayment as anomalous and a 2-cent underpayment as delayed", () => {
    const over = reconcileInterest([{ accrualDate: "2026-09-01", net: "1.00" }], [{ occurredAt: new Date("2026-09-15"), net: "1.02" }], period);
    expect(over).toMatchObject({ status: "anomalous", differenceCents: 2 });

    const under = reconcileInterest([{ accrualDate: "2026-09-01", net: "1.00" }], [{ occurredAt: new Date("2026-09-15"), net: "0.98" }], period);
    expect(under).toMatchObject({ status: "delayed", differenceCents: -2 });
  });

  it("sums many small accrual entries exactly, without float drift", () => {
    // 0.01 x 100 must total 1.00 exactly, not 0.9999999999999999.
    const accruals = Array.from({ length: 100 }, (_, i) => ({ accrualDate: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, net: "0.01" }));
    const summary = reconcileInterest(accruals, [{ occurredAt: new Date("2026-09-30"), net: "1.00" }], period);
    expect(summary).toMatchObject({ status: "matched", accruedTotal: "1.00" });
  });

  it("echoes the requested period bounds regardless of the entries passed in", () => {
    const summary = reconcileInterest([], [], period);
    expect(summary).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-10-01" });
  });
});
