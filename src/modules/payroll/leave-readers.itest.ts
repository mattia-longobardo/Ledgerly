/**
 * The two reads `timeoff` makes of this module (plan F7 §3.1), on the synthetic twins: the leave
 * snapshots of the applied payslips and the events, by the month the hours were used in.
 *
 * They live in their own file rather than in `service.itest.ts` because what they guarantee is a
 * contract with another module, not a step of the payslip pipeline: the ordering, the year they
 * answer for, and that a superseded payslip never speaks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { APRIL, MARCH, MARCH_REPRINT } from "../../../tests/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../tests/fixtures/payroll/twin";
import {
  applyPayslip,
  leaveEventsOf,
  leaveSnapshotsOf,
  processPayslip,
  uploadPayslip,
  verifyPayslip,
} from "./service";

let ctx: Ctx;
let other: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  other = await newContext();
});
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

async function imported(twin: TwinPayslip, who: Ctx = ctx) {
  const { document } = await uploadPayslip(who, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
  await processPayslip(who, document.id);
  return document.id;
}

async function applied(twin: TwinPayslip, who: Ctx = ctx) {
  const id = await imported(twin, who);
  await verifyPayslip(who, id);
  await applyPayslip(who, id);
  return id;
}

describe("leaveSnapshotsOf", () => {
  it("answers with the applied payslips' snapshots, oldest first", async () => {
    await applied(MARCH);
    const snapshots = await leaveSnapshotsOf(ctx, 2031);
    expect(snapshots).toEqual([
      {
        kind: "rol",
        period: "2031-03-01",
        previousYearHours: 10,
        accruedHours: 20,
        usedHours: null,
        remainingHours: 30,
      },
      {
        kind: "vacation",
        period: "2031-03-01",
        previousYearHours: 5,
        accruedHours: 40,
        usedHours: null,
        remainingHours: 45,
      },
    ]);
  });

  it("holds to the payslip's A.P. + MAT. − GOD. = RES. (spec §7.8)", async () => {
    await applied(MARCH);
    for (const snapshot of await leaveSnapshotsOf(ctx, 2031)) {
      const previous = snapshot.previousYearHours ?? 0;
      const accrued = snapshot.accruedHours ?? 0;
      const used = snapshot.usedHours ?? 0;
      expect(snapshot.remainingHours).toBeCloseTo(previous + accrued - used, 2);
    }
  });

  it("answers for the year asked and no other", async () => {
    await applied(MARCH);
    expect(await leaveSnapshotsOf(ctx, 2030)).toEqual([]);
    expect(await leaveSnapshotsOf(ctx, 2032)).toEqual([]);
  });

  it("lets only the active payslip speak, never the one it superseded", async () => {
    await applied(MARCH);
    const reprint = await imported(MARCH_REPRINT);
    await verifyPayslip(ctx, reprint);
    await applyPayslip(ctx, reprint);

    // One month, one snapshot per kind: the superseded payslip's are no longer offered, so the
    // residual cannot pick the stale one.
    const snapshots = await leaveSnapshotsOf(ctx, 2031);
    expect(snapshots.filter((one) => one.kind === "vacation")).toHaveLength(1);
    expect(snapshots.filter((one) => one.kind === "rol")).toHaveLength(1);
  });

  it("keeps one user's payslips out of another's", async () => {
    await applied(MARCH);
    expect(await leaveSnapshotsOf(other, 2031)).toEqual([]);
  });
});

describe("leaveEventsOf", () => {
  it("files the hours under the month they were used in, not the payslip's own", async () => {
    await applied(MARCH);
    const events = await leaveEventsOf(ctx, 2031);
    expect(events).toEqual([
      { kind: "vacation", hours: 8, payrollPeriod: "2031-03-01", usagePeriod: "2031-02-01" },
    ]);
  });

  it("orders by the month of use, then by kind", async () => {
    await applied(MARCH);
    await applied(APRIL);
    const events = await leaveEventsOf(ctx, 2031);
    expect(events.map((one) => [one.usagePeriod, one.kind])).toEqual([
      ["2031-02-01", "vacation"],
      ["2031-03-01", "rol"],
    ]);
  });

  it("answers by the year of use, which a January payslip puts in the year before", async () => {
    await applied(MARCH);
    // The one event of 2031 is February's; nothing belongs to 2030.
    expect(await leaveEventsOf(ctx, 2030)).toEqual([]);
    expect(await leaveEventsOf(ctx, 2031)).toHaveLength(1);
  });

  it("keeps one user's events out of another's", async () => {
    await applied(MARCH);
    expect(await leaveEventsOf(other, 2031)).toEqual([]);
  });
});
