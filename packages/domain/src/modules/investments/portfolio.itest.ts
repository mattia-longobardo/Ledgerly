// The manual portfolio (rewrite plan R5d, D2): positions and cash typed by hand, the account's value
// written by the module; never a sale of more than is held.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, readingsAt } from "../accounts";
import type { Ctx } from "../../platform/context";
import { today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { serviceKind } from "../portfolio";
import { PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import { parseDecimal } from "../../shared/money";
import {
  addAsset,
  createPortfolio,
  createPortfolioWithAccount,
  deleteOperation,
  isPortfolio,
  listInvestmentAccounts,
  recordOperation,
} from "./service";
import { investmentAccounts, investmentHoldings } from "./schema";

const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);
const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const ETF = { create: { class: "etf" as const, name: "An ETF", symbol: "ETF", currency: "EUR" } };

let ctx: Ctx;
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

const valueOf = async (accountId: string) => (await readingsAt(ctx, [accountId], todayOn)).get(accountId);

describe("a manual portfolio", () => {
  it("keeps cash and positions: a deposit, a purchase and its fee, the value of both", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    expect(await isPortfolio(ctx, accountId)).toBe(true);
    const [service] = await listInvestmentAccounts(ctx);
    expect(serviceKind({ provider: service.provider, accountOrigin: "manual" })).toBe("manual_portfolio");
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    await addAsset(ctx, accountId, {
      asset: ETF,
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
      feeCents: 5_00n,
    });
    // 2,000 in, 1,000 of the ETF and 5 of fee out: 995 of cash and 1,000 of positions.
    expect(await valueOf(accountId)).toBe(1_995_00n);
  });

  it("refuses a sale of more than is held, and a purchase deleted under a later sale", async () => {
    const { accountId } = await createPortfolioWithAccount(ctx, {
      name: "Broker",
      currency: "EUR",
      url: null,
    });
    await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: 2_000_00n });
    const bought = await addAsset(ctx, accountId, {
      asset: ETF,
      on: todayOn,
      quantity: qty("10"),
      unitPrice: price("100"),
    });
    const [service] = await listInvestmentAccounts(ctx);
    expect(service.provider).toBe("portfolio");
    const holdingId = await holdingOf(accountId);
    await expect(
      recordOperation(ctx, accountId, {
        kind: "sell",
        holdingId,
        on: todayOn,
        quantity: qty("11"),
        unitPrice: price("110"),
      }),
    ).rejects.toMatchObject({ code: "quantity_exceeded" });
    await recordOperation(ctx, accountId, {
      kind: "sell",
      holdingId,
      on: todayOn,
      quantity: qty("4"),
      unitPrice: price("110"),
    });
    await expect(deleteOperation(ctx, bought.eventId, accountId)).rejects.toMatchObject({
      code: "quantity_exceeded",
    });
    // 2,000 − 1,000 + 440 of cash, 6 units at the last price of 110.
    expect(await valueOf(accountId)).toBe(1_440_00n + 660_00n);
  });

  it("starts from the balance of its account, and is refused on an account already a service", async () => {
    const account = await createAccount(ctx, {
      name: "Broker",
      type: "investment",
      currency: "EUR",
      openingBalance: { on: "2026-01-01", cents: 500_00n },
    });
    await createPortfolio(ctx, { accountId: account.id });
    expect(await valueOf(account.id)).toBe(500_00n);
    await expect(createPortfolio(ctx, { accountId: account.id })).rejects.toMatchObject({
      code: "not_eligible",
    });
  });
});

async function holdingOf(accountId: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: investmentHoldings.id })
    .from(investmentHoldings)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentHoldings.investmentAccountId))
    .where(eq(investmentAccounts.accountId, accountId));
  return row.id;
}
