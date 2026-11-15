import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, getAccount } from "@/modules/accounts/queries";
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { chargeCandidates } from "@/modules/transactions/queries";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { importedOperation, importedPosition } from "../../../test/funds";
import { periodFees } from "./fees";
import { fundHomeRow } from "./home-queries";
import {
  fundContributionSources,
  fundDepositRules,
  fundDeposits,
  fundFees,
  fundFeeTariffs,
  fundOperations,
  funds,
  fundValuations,
  pensionRules,
  positionSnapshots,
  unitMovements,
} from "./schema";

// Step A2 of release N6 on the rows a database of before the release holds (rewrite plan,
// 11-standardization.md §11.2.4): the test writes a fund with a debit plan and a fund fed by the
// payslip as the code of before wrote them, runs the migration's own SQL, and reads the result.
// Tests SN2 (the copy of the deposits), SN7 (what a document left is not touched) and the rollback
// file. The integration database is already at the last migration, with no fund in it: the SQL of
// `0047` and `0048` only looks at the funds that have no source yet, so it runs again here.

const migration = (file: string) =>
  readFileSync(join(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", "");
const A2 = migration("0047_migrate_fund_data.sql");
const X2 = migration("0048_fund_account_group.sql");
/** The rollback file without its own `BEGIN`/`COMMIT`: the test runs it in a transaction it undoes. */
const ROLLBACK = readFileSync(join(process.cwd(), "docs/design/rewrite-plan/n6-rollback.sql"), "utf8")
  .replace(/^BEGIN;$/m, "")
  .replace(/^COMMIT;$/m, "");

let ctx: Ctx;
let debitFundId: string;
let payslipFundId: string;
let debitAccountId: string;
let bankId: string;

const stamp = <T extends object>(values: T) => userScoped(ctx).stamp(values);

async function anAccountOf(type: "investment" | "pension", name: string): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type,
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: "2026-01-01",
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

/** The two funds of before N6, with everything the code of then wrote around them. */
async function fundsOfBefore(): Promise<void> {
  bankId = await anAccount(ctx, "Conto corrente");
  await upsertFromProvider(
    ctx,
    bankId,
    ["02", "03", "04"].map((month) =>
      movement({
        payee: "Esempio Previdenza SDD",
        amountCents: -25_100n,
        occurredAt: new Date(`2026-${month}-05T10:00:00Z`),
      }),
    ),
  );
  const movements = await chargeCandidates(ctx, {
    accountId: bankId,
    from: "2026-01-01",
    to: "2026-12-31",
    types: ["expense"],
  });

  debitAccountId = await anAccountOf("investment", "Fondo Beta");
  const [debit] = await getDb()
    .insert(funds)
    .values(
      stamp({
        name: "Fondo Beta",
        type: "pac" as const,
        provider: "Esempio Previdenza",
        isin: "LU0987654321",
        valuationAccountId: debitAccountId,
        debitAccountId: bankId,
        debitDay: 5,
        ter: "0.012000",
        startOn: "2026-01-01",
        monthlyCents: 25_100n,
        depositFeeCents: 100n,
      }),
    )
    .returning();
  debitFundId = debit.id;
  await getDb()
    .insert(fundDepositRules)
    .values(stamp({ fundId: debit.id, payeeMatch: "Esempio Previdenza", accountId: bankId, active: true }));
  await getDb()
    .insert(fundDeposits)
    .values([
      stamp({
        fundId: debit.id,
        on: "2026-01-02",
        chargedCents: 500_000n,
        feeCents: 0n,
        source: "manual" as const,
        note: "Capitale iniziale",
      }),
      ...movements.map((one, index) =>
        stamp({
          fundId: debit.id,
          on: `2026-0${index + 2}-05`,
          chargedCents: 25_100n,
          feeCents: index === 2 ? null : 100n,
          transactionId: one.id,
          source: "rule" as const,
        }),
      ),
    ]);
  await saveBalanceEntry(ctx, debitAccountId, { on: "2026-03-31", cents: 551_000n, note: "" });

  const pensionAccountId = await anAccountOf("pension", "Fondo Alfa");
  const [payslip] = await getDb()
    .insert(funds)
    .values(
      stamp({
        name: "Fondo Alfa",
        type: "pension" as const,
        provider: "Esempio",
        compartment: "Crescita",
        valuationAccountId: pensionAccountId,
        startOn: "2025-10-01",
        receivesPayroll: true,
      }),
    )
    .returning();
  payslipFundId = payslip.id;
  await getDb()
    .insert(pensionRules)
    .values([
      stamp({
        fundId: payslip.id,
        kind: "payment_schedule" as const,
        validFrom: "2025-10-01",
        schedule: [
          { quarter: 1, month: 4, day: 20, nextYear: false },
          { quarter: 2, month: 7, day: 20, nextYear: false },
          { quarter: 3, month: 10, day: 20, nextYear: false },
          { quarter: 4, month: 1, day: 20, nextYear: true },
        ],
        toleranceDays: 15,
        enrollmentFeeCents: 1_032n,
        quarterFeeCents: 300n,
      }),
      stamp({
        fundId: payslip.id,
        kind: "contribution" as const,
        validFrom: "2025-10-01",
        ccnl: "Contratto di esempio",
        workerPct: "1.2000",
        employerPct: "2.0000",
        tfrPct: "100.0000",
      }),
    ]);
  // The public tariff the code of before seeded on every read: thirteen rows.
  const url = "https://example.test/costi.pdf";
  const tariff = (
    item: string,
    amountCents: bigint | null,
    rate: string | null,
    unit: string,
    note?: string,
  ) => ({
    provider: "esempio",
    validFrom: "2026-07-31",
    item,
    amountCents,
    rate,
    unit,
    note: note ?? null,
    sourceUrl: url,
  });
  await getDb()
    .insert(fundFeeTariffs)
    .values([
      tariff("enrollment_worker", 516n, null, "once"),
      tariff("enrollment_employer", 516n, null, "once"),
      tariff("association", 1_200n, null, "year", "quarterly"),
      tariff("management_monetario_plus", null, "0.000400", "year_of_assets"),
      tariff("management_sicurezza", null, "0.005800", "year_of_assets"),
      tariff("management_reddito", null, "0.000600", "year_of_assets"),
      tariff("management_crescita", null, "0.000800", "year_of_assets"),
      tariff("advance", 1_000n, null, "request", "online_half"),
      tariff("transfer", 1_000n, null, "request", "online_half"),
      tariff("redemption", 1_000n, null, "request", "online_half"),
      tariff("switch", 1_000n, null, "request", "first_free"),
      tariff("beneficiary", 500n, null, "request", "first_free"),
      tariff("assignment", 2_000n, null, "request"),
    ]);
  // What two documents left before N6: operations with their units, and a statement's position.
  for (const [quarter, on, price] of [
    [4, "2026-01-20", "10.000000"],
    [1, "2026-04-20", "10.500000"],
  ] as const) {
    await importedOperation(ctx, payslip.id, {
      originKey: `export:${on}`,
      originalType: "Contributo",
      classification: "contribution",
      originalState: "QUOTATO",
      competenceYear: quarter === 4 ? 2025 : 2026,
      competenceQuarter: quarter,
      operationDate: on,
      workerCents: 10_000n,
      employerCents: 18_000n,
      tfrCents: 60_000n,
      feesCents: 300n,
      netCents: 87_700n,
      movements: [{ compartment: "Crescita", units: "83.523810", unitPrice: price, unitPriceDate: on }],
    });
  }
  await importedPosition(
    ctx,
    { id: payslip.id, valuationAccountId: pensionAccountId },
    {
      valuationDate: "2026-04-30",
      valueCents: 181_200n,
      tfrCents: 120_000n,
      workerCents: 20_000n,
      employerCents: 36_000n,
      reportedGainCents: 5_200n,
    },
  );
}

/** What a document left, row by row: what SN7 says the release does not touch. */
async function history() {
  const db = getDb();
  return {
    operations: await db
      .select()
      .from(fundOperations)
      .where(eq(fundOperations.source, "import"))
      .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id)),
    movements: await db.select().from(unitMovements).orderBy(asc(unitMovements.operationId)),
    positions: await db.select().from(positionSnapshots).orderBy(asc(positionSnapshots.valuationDate)),
    valuations: await db.select().from(fundValuations).orderBy(asc(fundValuations.id)),
    balances: (
      await db.execute(
        sql`select account_id, "on", source, balance_cents from balance_entries where source = 'import' order by "on"`,
      )
    ).rows,
  };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  await fundsOfBefore();
});

afterAll(closeDatabase);

describe("step A2: the funds of before move to the single model", () => {
  it("copies every deposit into the register, equal in count and in sums (SN2)", async () => {
    await getDb().execute(sql.raw(A2));
    const deposits = await getDb().select().from(fundDeposits).orderBy(asc(fundDeposits.on));
    const copies = await getDb()
      .select()
      .from(fundOperations)
      .where(eq(fundOperations.fundId, debitFundId))
      .orderBy(asc(fundOperations.operationDate));
    expect(copies).toHaveLength(deposits.length);
    expect(copies.map((one) => one.originKey).sort()).toEqual(
      deposits.map((one) => `deposit:${one.id}`).sort(),
    );
    const sum = (values: bigint[]) => values.reduce((total, one) => total + one, 0n);
    expect(sum(copies.map((one) => one.workerCents))).toBe(sum(deposits.map((one) => one.chargedCents)));
    expect(sum(copies.map((one) => one.feesCents))).toBe(sum(deposits.map((one) => one.feeCents ?? 0n)));
    expect(copies.map((one) => one.transactionId)).toEqual(deposits.map((one) => one.transactionId));
    for (const [index, copy] of copies.entries()) {
      const deposit = deposits[index];
      expect(copy).toMatchObject({
        classification: "voluntary",
        operationDate: deposit.on,
        workerCents: deposit.chargedCents,
        feesCents: deposit.feeCents ?? 0n,
        feesUnknown: deposit.feeCents === null,
        netCents: deposit.chargedCents - (deposit.feeCents ?? 0n),
        source: deposit.source,
        note: deposit.note,
      });
    }
    // The deposits themselves stay where the image before reads them.
    expect(await getDb().select().from(fundDeposits)).toHaveLength(deposits.length);
  });

  it("makes the debit plan a source, and the two fees of the fund rows of the list", async () => {
    await getDb().execute(sql.raw(A2));
    const [source] = await getDb()
      .select()
      .from(fundContributionSources)
      .where(eq(fundContributionSources.fundId, debitFundId));
    expect(source).toMatchObject({
      kind: "bank_debit",
      state: "active",
      accountId: bankId,
      payeeMatch: "Esempio Previdenza",
      amountCents: 25_100n,
      debitDay: 5,
      intervalCount: 1,
      intervalUnit: "month",
      validFrom: null,
      validTo: null,
    });
    const fees = await getDb().select().from(fundFees).where(eq(fundFees.fundId, debitFundId));
    expect(
      fees.map((fee) => [fee.basis, fee.amountCents, fee.rate, fee.period, fee.sourceId]).sort(),
    ).toEqual(
      [
        ["on_assets", null, "0.012000", "year", null],
        ["per_contribution", 100n, null, null, source.id],
      ].sort(),
    );
    // The deposits the job found belong to the source; the one written by hand to none.
    const copies = await getDb().select().from(fundOperations).where(eq(fundOperations.fundId, debitFundId));
    expect(copies.filter((one) => one.source === "rule").every((one) => one.sourceId === source.id)).toBe(
      true,
    );
    expect(copies.filter((one) => one.source === "manual").every((one) => one.sourceId === null)).toBe(true);
    const [fund] = await getDb().select().from(funds).where(eq(funds.id, debitFundId));
    expect(fund.code).toBe("LU0987654321");
    // Nothing of the model before is rewritten.
    expect(fund).toMatchObject({ type: "pac", isin: "LU0987654321", monthlyCents: 25_100n, debitDay: 5 });
  });

  it("makes the schedule and the tariff of the payslip fund a source and rows of fees", async () => {
    await getDb().execute(sql.raw(A2));
    const [source] = await getDb()
      .select()
      .from(fundContributionSources)
      .where(eq(fundContributionSources.fundId, payslipFundId));
    expect(source).toMatchObject({
      kind: "payroll",
      state: "active",
      components: ["worker", "employer", "tfr"],
      accrualPeriod: "quarter",
      dueDay: 20,
      dueOffsetMonths: 1,
      dueEntries: null,
      toleranceDays: 15,
    });
    expect(source.note).toContain("Contratto di esempio");
    expect(source.note).toContain("1.2 %");
    const fees = await getDb().select().from(fundFees).where(eq(fundFees.fundId, payslipFundId));
    const of = (basis: string) => fees.filter((fee) => fee.basis === basis);
    // The rule's own two fees, tied to the source: what the estimate of a payslip period reads.
    expect(of("one_off").map((fee) => [fee.amountCents, fee.sourceId])).toEqual([[1_032n, source.id]]);
    expect(of("periodic").map((fee) => [fee.amountCents, fee.period, fee.sourceId])).toEqual([
      [300n, "quarter", source.id],
    ]);
    // The tariff's joining and membership figures are in the notes of those two, not rows of their own.
    expect(of("one_off")[0].note).toContain("5.16");
    expect(of("periodic")[0].note).toContain("12.00");
    expect(
      of("on_assets")
        .map((fee) => fee.rate)
        .sort(),
    ).toEqual(["0.000400", "0.000600", "0.000800", "0.005800"]);
    expect(
      of("per_request")
        .map((fee) => fee.amountCents)
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual([500n, 1_000n, 1_000n, 1_000n, 1_000n, 2_000n]);
    expect(fees).toHaveLength(12);
    // SN4, on the rows the migration wrote: the estimate of a transfer is the two constants of before.
    expect(
      periodFees(
        fees.map((fee) => ({ ...fee, rate: fee.rate })),
        { sourceId: source.id, period: "quarter", on: "2026-11-14" },
      ),
    ).toEqual({ enrollmentCents: 1_032n, quarterCents: 300n });
  });

  it("keeps explicit due dates the two fields cannot say", async () => {
    await getDb()
      .update(pensionRules)
      .set({
        schedule: [
          { quarter: 1, month: 4, day: 20, nextYear: false },
          { quarter: 2, month: 7, day: 15, nextYear: false },
          { quarter: 3, month: 10, day: 20, nextYear: false },
          { quarter: 4, month: 1, day: 20, nextYear: true },
        ],
      })
      .where(eq(pensionRules.kind, "payment_schedule"));
    await getDb().execute(sql.raw(A2));
    const [source] = await getDb()
      .select()
      .from(fundContributionSources)
      .where(eq(fundContributionSources.fundId, payslipFundId));
    expect([source.dueDay, source.dueOffsetMonths]).toEqual([null, null]);
    expect(source.dueEntries).toEqual([
      { period: 1, month: 4, day: 20, nextYear: false },
      { period: 2, month: 7, day: 15, nextYear: false },
      { period: 3, month: 10, day: 20, nextYear: false },
      { period: 4, month: 1, day: 20, nextYear: true },
    ]);
  });

  it("leaves what a document wrote exactly as it was (SN7)", async () => {
    const before = await history();
    expect(before.operations).toHaveLength(2);
    expect(before.positions).toHaveLength(1);
    await getDb().execute(sql.raw(A2));
    await getDb().execute(sql.raw(X2));
    expect(await history()).toEqual(before);
  });

  it("gives the migrated funds the flows and the status the plan had", async () => {
    await getDb().execute(sql.raw(A2));
    const now = new Date("2026-04-10T10:00:00Z");
    const debit = await fundHomeRow(ctx, debitFundId, now);
    expect(
      debit.home.flows.map((flow) => [flow.on, flow.chargedCents, flow.feeCents, flow.recurring]),
    ).toEqual([
      // Newest first, as the engine of before read the deposits: the sums of floats keep their order.
      ["2026-04-05", 25_100n, null, true],
      ["2026-03-05", 25_100n, 100n, true],
      ["2026-02-05", 25_100n, 100n, true],
      ["2026-01-02", 500_000n, 0n, false],
    ]);
    expect(debit.month).toEqual({ kind: "found", on: "2026-04-05" });
    const payslip = await fundHomeRow(ctx, payslipFundId, now);
    expect(payslip.detail.quarters.map((quarter) => [quarter.year, quarter.quarter, quarter.due])).toEqual([
      [2025, 4, "2026-01-20"],
      [2026, 1, "2026-04-20"],
    ]);
    expect(payslip.detail.metrics.units).toBe("167.04762");
  });

  it("writes nothing twice when it runs again, and stops when a copy differs", async () => {
    await getDb().execute(sql.raw(A2));
    const count = async () =>
      [
        (await getDb().select().from(fundOperations)).length,
        (await getDb().select().from(fundContributionSources)).length,
        (await getDb().select().from(fundFees)).length,
      ] as const;
    const first = await count();
    await getDb().execute(sql.raw(A2));
    expect(await count()).toEqual(first);

    await getDb()
      .update(fundOperations)
      .set({ workerCents: 1n })
      .where(sql`${fundOperations.originKey} like 'deposit:%' and ${fundOperations.source} = 'manual'`);
    await expect(getDb().execute(sql.raw(A2))).rejects.toThrow();
  });
});

describe("exception X2: the account of a fund is a pension account", () => {
  it("moves the account of the fund that had a debit plan, and no other account", async () => {
    const broker = await anAccountOf("investment", "Broker");
    await getDb().execute(sql.raw(A2));
    await getDb().execute(sql.raw(X2));
    expect((await getAccount(ctx, debitAccountId))?.type).toBe("pension");
    expect((await getAccount(ctx, broker))?.type).toBe("investment");
    expect((await getAccount(ctx, bankId))?.type).toBe("checking");
  });

  it("leaves net worth as it was: only the group of the account changes (SN6)", async () => {
    await getDb().execute(sql.raw(A2));
    const now = new Date("2026-04-10T10:00:00Z");
    const before = await accountsView(ctx, { now });
    await getDb().execute(sql.raw(X2));
    const after = await accountsView(ctx, { now });
    expect(before.netWorth).not.toBeNull();
    expect(after.netWorth).toEqual(before.netWorth);
    expect(after.total).toEqual(before.total);
    expect(after.rows.map((row) => [row.account.name, row.balance])).toEqual(
      before.rows.map((row) => [row.account.name, row.balance]),
    );
    const typeOf = (view: typeof before) =>
      new Map(view.rows.map((row) => [row.account.name, row.account.type]));
    expect(typeOf(before).get("Fondo Beta")).toBe("investment");
    expect(typeOf(after).get("Fondo Beta")).toBe("pension");
  });
});

describe("the rollback file of the release", () => {
  class Undo extends Error {}

  it("puts the database back, with the payments written by hand after the release where the image before reads them", async () => {
    await getDb().execute(sql.raw(A2));
    await getDb().execute(sql.raw(X2));
    const [source] = await getDb()
      .select()
      .from(fundContributionSources)
      .where(eq(fundContributionSources.fundId, debitFundId));
    // After the release: one payment by hand, one found by the job, one contribution counted by month.
    await getDb()
      .insert(fundOperations)
      .values([
        stamp({
          fundId: debitFundId,
          originKey: "manual:after",
          originalType: "voluntary",
          classification: "voluntary" as const,
          operationDate: "2026-05-20",
          workerCents: 40_000n,
          feesCents: 0n,
          feesUnknown: true,
          netCents: 40_000n,
          source: "manual" as const,
        }),
        stamp({
          fundId: debitFundId,
          originKey: "rule:after",
          originalType: "voluntary",
          classification: "voluntary" as const,
          operationDate: "2026-05-05",
          workerCents: 25_100n,
          feesCents: 100n,
          netCents: 25_000n,
          source: "rule" as const,
          sourceId: source.id,
        }),
        stamp({
          fundId: payslipFundId,
          originKey: "manual:monthly",
          originalType: "contribution",
          classification: "contribution" as const,
          competenceYear: 2026,
          competenceQuarter: 11,
          operationDate: "2026-05-21",
          workerCents: 1_000n,
          netCents: 1_000n,
          source: "manual" as const,
        }),
      ]);
    const depositsBefore = (await getDb().select().from(fundDeposits)).length;

    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql.raw(ROLLBACK));
        const one = async (query: string) =>
          (await tx.execute(sql.raw(query))).rows[0] as Record<string, unknown>;
        // The tables and the columns of the release are gone, and the checks of before are back.
        expect((await one("select to_regclass('fund_contribution_sources') as t")).t).toBeNull();
        expect((await one("select to_regclass('fund_fees') as t")).t).toBeNull();
        expect(
          Number(
            (
              await one(
                "select count(*) as n from information_schema.columns where table_name = 'fund_operations' and column_name in ('source_id', 'fees_unknown')",
              )
            ).n,
          ),
        ).toBe(0);
        expect(
          String(
            (
              await one(
                "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'fund_operations_source_ck'",
              )
            ).d,
          ),
        ).not.toContain("rule");
        // The payment by hand is a deposit again, with its unknown fee; the job's one is left to the job.
        const deposits = await tx.select().from(fundDeposits).orderBy(asc(fundDeposits.on));
        expect(deposits).toHaveLength(depositsBefore + 1);
        expect(deposits.at(-1)).toMatchObject({
          on: "2026-05-20",
          chargedCents: 40_000n,
          feeCents: null,
          source: "manual",
        });
        // The fund that had a debit plan has no operation left; the other keeps what a document wrote.
        expect(
          Number((await one(`select count(*) as n from fund_operations where fund_id = '${debitFundId}'`)).n),
        ).toBe(0);
        expect(
          Number((await one("select count(*) as n from fund_operations where source = 'import'")).n),
        ).toBe(2);
        expect(
          (
            await one(
              "select competence_quarter as q from fund_operations where origin_key = 'manual:monthly'",
            )
          ).q,
        ).toBeNull();
        expect((await one(`select type from accounts where id = '${debitAccountId}'`)).type).toBe(
          "investment",
        );
        throw new Undo();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Undo)) throw error;
      });
    // The test undid the rollback: the release's tables are still there for the tests that follow.
    expect((await getDb().select().from(fundContributionSources)).length).toBeGreaterThan(0);
  });
});
