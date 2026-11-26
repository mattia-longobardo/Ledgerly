// The voluntary contributions of a fund as giroconti in the accounts (PERS-651), against the
// database: a leg for money that left one of the person's accounts, none for the payslip's.
// Synthetic data only: made-up names and amounts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../../platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";
import { payrollFund } from "../../../../../test/funds";
import { listTransactions } from "../transactions/queries";
import { upsertFromProvider } from "../transactions/service";
import { addContribution, createFund, deleteContribution, linkAllFundLegs } from "./service";

let ctx: Ctx;
let bank: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  bank = await anAccount(ctx, "Conto corrente");
});
afterAll(closeDatabase);

const all = () => listTransactions(ctx, { includeHidden: true, limit: 100 });
const legs = async () => (await all()).filter((row) => row.origin === "investments");

describe("a fund's legs in the accounts", () => {
  it("gives a voluntary contribution its leg, paired with the movement that paid it", async () => {
    await upsertFromProvider(
      ctx,
      bank,
      [movement({ amountCents: -100_00n, payee: "Versamento", categoryName: null })],
      { provider: WALLET_PROVIDER },
    );
    const paid = (await listTransactions(ctx, { limit: 10 })).find((row) => row.payee === "Versamento")!;
    const fund = await createFund(ctx, {
      fund: { name: "Fondo Alfa", provider: "Esempio Previdenza", startOn: "2026-01-01" },
      sources: [],
      fees: [],
    });
    const operation = await addContribution(ctx, fund.id, {
      kind: "voluntary",
      on: "2026-03-10",
      amountCents: 100_00n,
      feeCents: 0n,
      transactionId: paid.id,
    });
    const [leg] = await legs();
    expect(leg).toMatchObject({ amountCents: 100_00n, type: "transfer", accountId: fund.valuationAccountId });
    expect(leg.transferGroupId).not.toBeNull();
    const bankLeg = (await all()).find((row) => row.id === paid.id)!;
    expect(bankLeg.transferGroupId).toBe(leg.transferGroupId);
    expect(await linkAllFundLegs(ctx)).toBe(0);

    await deleteContribution(ctx, operation.id);
    expect(await legs()).toEqual([]);
  });

  it("writes none for a contribution from the payslip: it never passes through an account", async () => {
    const fund = await payrollFund(ctx, { name: "Fondo Beta", startOn: "2026-01-01" });
    await addContribution(ctx, fund.id, {
      kind: "payroll",
      on: "2026-04-20",
      workerCents: 50_00n,
      employerCents: 30_00n,
      tfrCents: 70_00n,
      period: { year: 2026, index: 1 },
      feeCents: 0n,
    });
    await addContribution(ctx, fund.id, {
      kind: "voluntary",
      on: "2026-04-21",
      amountCents: 20_00n,
      feeCents: 0n,
    });
    // The voluntary one on the same fund has its leg: the rule is per operation, never per fund.
    expect((await legs()).map((leg) => leg.amountCents)).toEqual([20_00n]);
  });
});
