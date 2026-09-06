import { describe, expect, it } from "vitest";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemorySchedulesRepository,
} from "./memory-repositories";
import { memoryPayrollContributionSink } from "./memory-contribution-sink";

const USER_ID = "user-1";

async function setup(over: { fee?: string; schedule?: boolean; userId?: string } = {}) {
  const userId = over.userId ?? USER_ID;
  const funds = new MemoryFundsRepository();
  const schedules = new MemorySchedulesRepository();
  const contributions = new MemoryContributionsRepository();
  const fund = await funds.create({
    userId,
    slug: "cometa",
    name: "Cometa",
    kind: "pension",
    currency: "EUR",
    accountId: null,
  });
  if (over.schedule !== false) {
    await schedules.add({
      fundId: fund.id,
      frequency: "quarterly",
      periodAnchorMonth: 1,
      postingLagMonths: 1,
      feePerPosting: over.fee ?? "3.00",
      effectiveFrom: "2026-01-01",
    });
  }
  return {
    fund,
    funds,
    schedules,
    contributions,
    sink: memoryPayrollContributionSink({ funds, schedules, contributions }),
  };
}

describe("memoryPayrollContributionSink", () => {
  it("locks every owner fund in id order before replacement", async () => {
    class TrackingFundsRepository extends MemoryFundsRepository {
      readonly lockedIds: string[] = [];
      override async lock(userId: string, id: string) {
        this.lockedIds.push(id);
        return super.lock(userId, id);
      }
    }
    const funds = new TrackingFundsRepository();
    const first = await funds.create({ userId: USER_ID, slug: "zulu", name: "Zulu", kind: "pension", currency: "EUR", accountId: null });
    const second = await funds.create({ userId: USER_ID, slug: "alpha", name: "Alpha", kind: "pension", currency: "EUR", accountId: null });
    const sink = memoryPayrollContributionSink({
      funds,
      schedules: new MemorySchedulesRepository(),
      contributions: new MemoryContributionsRepository(),
    });
    await sink.writeForRecord({ userId: USER_ID, payrollRecordId: "none", supersededRecordId: null, rows: [] });
    expect(funds.lockedIds).toEqual([first.id, second.id].sort());
  });

  it("writes quarterly payroll parts and one negative system fee in the posting month", async () => {
    const { fund, contributions, sink } = await setup();

    await expect(sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "payroll-february",
      supersededRecordId: null,
      rows: [
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "100.00", currency: "EUR" },
        { fundSlug: "cometa", part: "employer", accrualMonth: "2026-02-01", amount: "150.00", currency: "EUR" },
      ],
    })).resolves.toEqual({ written: 2, skipped: [] });

    expect(await contributions.listForFund(fund.id)).toEqual([
      expect.objectContaining({
        typeCode: "employee",
        accrualPeriodStart: "2026-01-01",
        accrualPeriodEnd: "2026-03-01",
        postedMonth: "2026-04-01",
        amount: "100.00",
        currency: "EUR",
        source: "payroll",
        payrollRecordId: "payroll-february",
      }),
      expect.objectContaining({
        typeCode: "employer",
        accrualPeriodStart: "2026-01-01",
        accrualPeriodEnd: "2026-03-01",
        postedMonth: "2026-04-01",
        amount: "150.00",
        currency: "EUR",
        source: "payroll",
        payrollRecordId: "payroll-february",
      }),
      expect.objectContaining({
        typeCode: "fee",
        accrualPeriodStart: "2026-01-01",
        accrualPeriodEnd: "2026-03-01",
        postedMonth: "2026-04-01",
        amount: "-3.00",
        currency: "EUR",
        source: "system",
        payrollRecordId: null,
      }),
    ]);
  });

  it("shares one fee across February and March records in the same posting", async () => {
    const { fund, contributions, sink } = await setup();
    for (const [payrollRecordId, accrualMonth] of [["february", "2026-02-01"], ["march", "2026-03-01"]] as const) {
      await sink.writeForRecord({
        userId: USER_ID,
        payrollRecordId,
        supersededRecordId: null,
        rows: [{ fundSlug: "cometa", part: "employee", accrualMonth, amount: "10.00", currency: "EUR" }],
      });
    }
    const rows = await contributions.listForFund(fund.id);
    expect(rows.filter((row) => row.typeCode === "fee")).toHaveLength(1);
    expect(rows.filter((row) => row.typeCode === "employee").map((row) => row.postedMonth)).toEqual([
      "2026-04-01",
      "2026-04-01",
    ]);
  });

  it("aggregates repeated mapped components by fund and part using exact cents", async () => {
    const { fund, contributions, sink } = await setup({ fee: "0.00" });
    const result = await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "repeated",
      supersededRecordId: null,
      rows: [
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "0.10", currency: "EUR" },
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "0.20", currency: "EUR" },
        { fundSlug: "cometa", part: "employer", accrualMonth: "2026-02-01", amount: "1.00", currency: "EUR" },
      ],
    });
    expect(result).toEqual({ written: 2, skipped: [] });
    expect((await contributions.listForFund(fund.id)).map((row) => [row.typeCode, row.amount])).toEqual([
      ["employee", "0.30"],
      ["employer", "1.00"],
    ]);
  });

  it("skips unknown funds and null amounts and defaults missing schedules without a fee", async () => {
    const { fund, contributions, sink } = await setup({ schedule: false });
    const result = await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "defaults",
      supersededRecordId: null,
      rows: [
        { fundSlug: "missing", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" },
        { fundSlug: "cometa", part: "employer", accrualMonth: "2026-02-01", amount: null, currency: "EUR" },
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "12.00", currency: "EUR" },
      ],
    });
    expect(result).toEqual({
      written: 1,
      skipped: [
        { fundSlug: "missing", reason: "no_fund" },
        { fundSlug: "cometa", reason: "no_amount" },
      ],
    });
    expect(await contributions.listForFund(fund.id)).toEqual([
      expect.objectContaining({
        typeCode: "employee",
        accrualPeriodStart: "2026-01-01",
        accrualPeriodEnd: "2026-03-01",
        postedMonth: "2026-04-01",
      }),
    ]);
  });

  it("validates every row before replacing existing contributions", async () => {
    const { fund, contributions, sink } = await setup({ fee: "0.00" });
    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
    });

    await expect(sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-30", amount: "NaN", currency: "eur" }],
    })).rejects.toThrow(/invalid/i);
    expect(await contributions.listForFund(fund.id)).toEqual([
      expect.objectContaining({ payrollRecordId: "current", amount: "10.00" }),
    ]);
  });

  it("validates repeated part consistency before replacing existing contributions", async () => {
    const { fund, contributions, sink } = await setup({ fee: "0.00" });
    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
    });
    await expect(sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "1.00", currency: "EUR" },
        { fundSlug: "cometa", part: "employee", accrualMonth: "2026-03-01", amount: "2.00", currency: "EUR" },
      ],
    })).rejects.toThrow(/span months/i);
    expect(await contributions.listForFund(fund.id)).toEqual([
      expect.objectContaining({ payrollRecordId: "current", amount: "10.00" }),
    ]);
  });

  it("rejects a mapped currency that differs from the owner fund and cannot see another owner's slug", async () => {
    const { fund, funds, schedules, contributions, sink } = await setup({ fee: "0.00" });
    await expect(sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "wrong-currency",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "USD" }],
    })).rejects.toThrow(/currency/i);
    expect(await contributions.listForFund(fund.id)).toEqual([]);

    const otherSink = memoryPayrollContributionSink({ funds, schedules, contributions });
    await expect(otherSink.writeForRecord({
      userId: "user-2",
      payrollRecordId: "foreign",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
    })).resolves.toEqual({ written: 0, skipped: [{ fundSlug: "cometa", reason: "no_fund" }] });
    expect(await contributions.listForFund(fund.id)).toEqual([]);
  });

  it("re-apply removes the current record, its reversal, and its now-orphan system fee", async () => {
    const { fund, contributions, sink } = await setup();
    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
    });
    const original = (await contributions.listForFund(fund.id)).find((row) => row.typeCode === "employee")!;
    await contributions.create({
      fundId: original.fundId,
      typeCode: "reversal",
      accrualPeriodStart: original.accrualPeriodStart,
      accrualPeriodEnd: original.accrualPeriodEnd,
      postedMonth: original.postedMonth,
      valueDate: original.valueDate,
      amount: "-10.00",
      currency: original.currency,
      source: "manual",
      payrollRecordId: null,
      note: null,
      reversesId: original.id,
      reconciliationStatus: "received",
    });

    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "current",
      supersededRecordId: null,
      rows: [],
    });
    expect(await contributions.listForFund(fund.id)).toEqual([]);
  });

  it("supersession clears removed and changed mappings across all owner funds", async () => {
    const { fund: cometa, funds, schedules, contributions, sink } = await setup();
    const other = await funds.create({
      userId: USER_ID,
      slug: "other",
      name: "Other",
      kind: "pension",
      currency: "EUR",
      accountId: null,
    });
    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "old",
      supersededRecordId: null,
      rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
    });
    await sink.writeForRecord({
      userId: USER_ID,
      payrollRecordId: "new",
      supersededRecordId: "old",
      rows: [{ fundSlug: "other", part: "employer", accrualMonth: "2026-02-01", amount: "20.00", currency: "EUR" }],
    });
    expect(await contributions.listForFund(cometa.id)).toEqual([]);
    expect(await contributions.listForFund(other.id)).toEqual([
      expect.objectContaining({ payrollRecordId: "new", typeCode: "employer", amount: "20.00" }),
    ]);
    expect(await schedules.listForFund(other.id)).toEqual([]);
  });

  it("keeps the shared fee while another linked record or unlinked migration row remains", async () => {
    const { fund, contributions, sink } = await setup();
    for (const payrollRecordId of ["current", "other"]) {
      await sink.writeForRecord({
        userId: USER_ID,
        payrollRecordId,
        supersededRecordId: null,
        rows: [{ fundSlug: "cometa", part: "employee", accrualMonth: "2026-02-01", amount: "10.00", currency: "EUR" }],
      });
    }
    await sink.writeForRecord({ userId: USER_ID, payrollRecordId: "current", supersededRecordId: null, rows: [] });
    expect((await contributions.listForFund(fund.id)).filter((row) => row.typeCode === "fee")).toHaveLength(1);

    await contributions.create({
      fundId: fund.id,
      typeCode: "employer",
      accrualPeriodStart: "2026-01-01",
      accrualPeriodEnd: "2026-03-01",
      postedMonth: "2026-04-01",
      valueDate: null,
      amount: "5.00",
      currency: "EUR",
      source: "migration",
      payrollRecordId: null,
      note: "legacy without live record",
      reversesId: null,
      reconciliationStatus: "received",
    });
    await sink.writeForRecord({ userId: USER_ID, payrollRecordId: "other", supersededRecordId: null, rows: [] });
    expect((await contributions.listForFund(fund.id)).filter((row) => row.typeCode === "fee")).toHaveLength(1);
  });
});
