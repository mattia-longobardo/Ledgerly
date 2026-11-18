// Funds for the tests and the seeds, in the single model of release N6.
//
// The tests of before N6 made a fund with a debit plan and a fund fed by the payslip through two
// services that no longer exist. These helpers build the same funds through the one service, so a
// test keeps the data it was written for and its assertions stay as they were. `importedOperation`
// and `importedPosition` write the rows a document left before N6: the app reads them, as history,
// and nothing in it writes them any more.
import { and, eq } from "drizzle-orm";
import { saveImportBalance } from "@domain/modules/accounts/service";
import {
  fundContributionSources,
  fundFees,
  fundOperations,
  positionSnapshots,
  unitMovements,
} from "@domain/modules/funds/schema";
import {
  addContribution,
  createFund,
  type Fund,
  type FundOperation,
  setSourceState,
  sourcesOf,
} from "@domain/modules/funds/service";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import type { Cents } from "@domain/platform/money";

/** A text no movement carries: a debit source that finds nothing until a test gives it a payee. */
const NO_MATCH = "no-movement-carries-this";

interface DebitFundInput {
  name: string;
  provider?: string | null;
  compartment?: string | null;
  /** The fund's code: what the field `isin` held before N6. */
  code?: string | null;
  startOn: string;
  /** The plan: what is debited each month, on which day, from which account. */
  monthlyCents?: Cents | null;
  debitDay?: number | null;
  debitAccountId?: string | null;
  /** The fee taken from each debit. */
  depositFeeCents?: Cents | null;
  /** The yearly cost on the assets, as a fraction ("0.012"). */
  ter?: string | null;
  /** A first payment by hand on the start day, with no fee. */
  initialCents?: Cents | null;
}

/** A fund with a monthly debit plan: one `bank_debit` source and its two fees. */
export async function debitFund(ctx: Ctx, input: DebitFundInput): Promise<Fund> {
  const planned = input.monthlyCents !== null && input.monthlyCents !== undefined;
  const fund = await createFund(ctx, {
    fund: {
      name: input.name,
      provider: input.provider ?? null,
      compartment: input.compartment ?? null,
      startOn: input.startOn,
      code: input.code ?? null,
    },
    currency: "EUR",
    sources: planned
      ? [
          {
            kind: "bank_debit",
            amountCents: input.monthlyCents!,
            frequency: { count: 1, unit: "month" },
            debitDay: input.debitDay ?? null,
            accountId: input.debitAccountId ?? null,
            payeeMatch: NO_MATCH,
          },
        ]
      : [],
    fees: [
      ...(input.depositFeeCents
        ? [
            {
              label: "Per deposit",
              basis: "per_contribution" as const,
              amountCents: input.depositFeeCents,
              sourceIndex: planned ? 0 : null,
            },
          ]
        : []),
      ...(input.ter
        ? [{ label: "Management", basis: "on_assets" as const, rate: input.ter, period: "year" as const }]
        : []),
    ],
  });
  if (input.initialCents) {
    await addDeposit(ctx, fund.id, {
      on: input.startOn,
      chargedCents: input.initialCents,
      feeCents: 0n,
      note: null,
    });
  }
  return fund;
}

/** A payment written by hand: what "Add deposit" wrote before N6. */
export async function addDeposit(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: { on: string; chargedCents: Cents; feeCents: Cents | null; note: string | null },
): Promise<FundOperation> {
  return addContribution(ctx, fundId, {
    kind: "voluntary",
    on: input.on,
    amountCents: input.chargedCents,
    feeCents: input.feeCents,
    note: input.note,
  });
}

/** The payee, the account and the state of a fund's debit source: the "deposit rule" of before N6. */
export async function saveDepositRule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: { payeeMatch: string; accountId: string | null; active: boolean },
): Promise<void> {
  const [source] = (await sourcesOf(ctx, [fundId])).filter((one) => one.kind === "bank_debit");
  if (!source) {
    await getDb()
      .insert(fundContributionSources)
      .values(
        userScoped(ctx).stamp({
          fundId,
          kind: "bank_debit" as const,
          state: "paused" as const,
          payeeMatch: input.payeeMatch,
          accountId: input.accountId,
          intervalCount: 1,
          intervalUnit: "month" as const,
        }),
      );
  } else {
    await getDb()
      .update(fundContributionSources)
      .set({ payeeMatch: input.payeeMatch, accountId: input.accountId, state: "paused" })
      .where(and(eq(fundContributionSources.id, source.id), userScoped(ctx).owns(fundContributionSources)));
  }
  const [saved] = (await sourcesOf(ctx, [fundId])).filter((one) => one.kind === "bank_debit");
  // Activating is what matches the movements, as saving the rule did.
  if (input.active) await setSourceState(ctx, saved.id, "active");
}

interface PayrollFundInput {
  name: string;
  provider?: string | null;
  compartment?: string | null;
  startOn: string;
  /** False for a fund that keeps its payslip source paused: another fund is fed by the payslip. */
  receivesPayroll?: boolean;
}

/**
 * A fund fed by the payslip, as one was made before N6: the three components by quarter, due on the
 * 20th of the month after, 15 days of tolerance, a joining fee of 10,32 € and 3 € a quarter.
 */
export async function payrollFund(ctx: Ctx, input: PayrollFundInput): Promise<Fund> {
  const fund = await createFund(ctx, {
    fund: {
      name: input.name,
      provider: input.provider ?? null,
      compartment: input.compartment ?? null,
      startOn: input.startOn,
    },
    currency: "EUR",
    sources: [],
    fees: [],
  });
  const [source] = await getDb()
    .insert(fundContributionSources)
    .values(
      userScoped(ctx).stamp({
        fundId: fund.id,
        kind: "payroll" as const,
        state: input.receivesPayroll === false ? ("paused" as const) : ("active" as const),
        components: ["worker", "employer", "tfr"] as ("worker" | "employer" | "tfr")[],
        accrualPeriod: "quarter" as const,
        dueDay: 20,
        dueOffsetMonths: 1,
        toleranceDays: 15,
      }),
    )
    .returning();
  await getDb()
    .insert(fundFees)
    .values([
      userScoped(ctx).stamp({
        fundId: fund.id,
        label: "Joining",
        basis: "one_off" as const,
        amountCents: 1032n,
        sourceId: source.id,
      }),
      userScoped(ctx).stamp({
        fundId: fund.id,
        label: "Association",
        basis: "periodic" as const,
        amountCents: 300n,
        period: "quarter" as const,
        sourceId: source.id,
      }),
    ]);
  return fund;
}

/** A payment made straight to the fund, by hand. */
export async function addVoluntaryContribution(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: {
    on: string;
    amountCents: Cents;
    feesCents?: Cents;
    note?: string | null;
    transactionId?: string | null;
  },
): Promise<FundOperation> {
  return addContribution(ctx, fundId, {
    kind: "voluntary",
    on: input.on,
    amountCents: input.amountCents,
    feeCents: input.feesCents ?? 0n,
    transactionId: input.transactionId ?? null,
    note: input.note ?? null,
  });
}

interface ImportedOperation {
  originKey: string;
  originalType: string;
  classification: FundOperation["classification"];
  originalState?: string | null;
  competenceYear?: number | null;
  competenceQuarter?: number | null;
  operationDate: string;
  workerCents?: Cents;
  employerCents?: Cents;
  tfrCents?: Cents;
  otherCents?: Cents;
  feesCents?: Cents;
  netCents: Cents;
  /** The employer the export named on the operation. */
  employerTaxCode?: string | null;
  employerName?: string | null;
  movements?: {
    compartment: string;
    units: string;
    unitPrice: string | null;
    unitPriceDate: string | null;
  }[];
}

/** An operation a document left before N6 (`source = import`), with the units it moved. */
export async function importedOperation(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: ImportedOperation,
): Promise<FundOperation> {
  const { movements = [], ...operation } = input;
  const [row] = await getDb()
    .insert(fundOperations)
    .values(userScoped(ctx).stamp({ fundId, source: "import" as const, ...operation }))
    .returning();
  if (movements.length > 0) {
    await getDb()
      .insert(unitMovements)
      .values(
        movements.map((movement, index) =>
          userScoped(ctx).stamp({ operationId: row.id, position: index + 1, ...movement }),
        ),
      );
  }
  return row;
}

/** The position a statement stated before N6: the `import` balance on its day, and its summary. */
export async function importedPosition(
  ctx: Pick<Ctx, "userId">,
  fund: Pick<Fund, "id" | "valuationAccountId">,
  input: {
    valuationDate: string;
    valueCents: Cents;
    tfrCents?: Cents | null;
    workerCents?: Cents | null;
    employerCents?: Cents | null;
    transfersInCents?: Cents | null;
    inflowsCents?: Cents | null;
    advancesCents?: Cents | null;
    redemptionsCents?: Cents | null;
    ritaCents?: Cents | null;
    outflowsCents?: Cents | null;
    reportedGainCents?: Cents | null;
    /** The note of the balance: the name of the statement's file, before N6. */
    note?: string;
  },
): Promise<void> {
  const { note = "", ...snapshot } = input;
  await getDb().transaction(async (tx) => {
    const entry = await saveImportBalance(
      ctx,
      fund.valuationAccountId,
      { on: input.valuationDate, cents: input.valueCents, note },
      tx,
    );
    await tx
      .insert(positionSnapshots)
      .values(userScoped(ctx).stamp({ fundId: fund.id, balanceEntryId: entry.id, ...snapshot }));
  });
}
