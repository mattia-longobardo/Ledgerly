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

  it("reports no_data (not matched) when there are no accrual records at all — no basis to compare", () => {
    const summary = reconcileInterest([], [], period);
    expect(summary).toMatchObject({ status: "no_data", accruedTotal: "0.00", paidTotal: "0.00", differenceCents: 0 });
  });

  it("reports no_data, not anomalous, when something was paid but there is no accrual record for the period", () => {
    // Distinct from "anomalous": that status asserts the ledger was
    // evaluated and found a real discrepancy. With zero accrual records we
    // cannot assert that — the accrual job may simply not have run yet.
    const summary = reconcileInterest([], [{ occurredAt: new Date("2026-09-15"), net: "0.50" }], period);
    expect(summary.status).toBe("no_data");
  });

  it("reports matched, not no_data, when the ledger explicitly recorded zero accrual and nothing was paid", () => {
    // Distinct from the empty-accruals case above: here there IS accrual
    // evidence for the period (the job ran and found nothing owed), so
    // matched is the honest status, not no_data.
    const summary = reconcileInterest([{ accrualDate: "2026-09-01", net: "0.00" }], [], period);
    expect(summary).toMatchObject({ status: "matched", accruedTotal: "0.00" });
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

  // Ruling P3-C39 (B2): a claimed-but-unconfirmed accrual must read as
  // neither "posted" nor "unposted" — `indeterminate` takes priority over
  // the ordinary amount-comparison routing, even when the totals would
  // otherwise look perfectly matched.
  it("reports indeterminate, not matched, when an accrual is claimed but unconfirmed — even if the totals otherwise agree", () => {
    const summary = reconcileInterest(
      [{ accrualDate: "2026-09-01", net: "0.63", postingIndeterminate: true }],
      [{ occurredAt: new Date("2026-09-01"), net: "0.63" }],
      period,
    );
    expect(summary.status).toBe("indeterminate");
  });

  it("indeterminate takes priority even when only one of several accruals in the period is affected", () => {
    const summary = reconcileInterest(
      [
        { accrualDate: "2026-09-01", net: "0.63" },
        { accrualDate: "2026-09-02", net: "0.50", postingIndeterminate: true },
      ],
      [],
      period,
    );
    expect(summary.status).toBe("indeterminate");
  });
});
