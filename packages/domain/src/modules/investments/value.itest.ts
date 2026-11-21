// The one value of a service (audit INV-3): the number the pages and the API compute on the book and
// the `portfolio` balance that Accounts, Overview and `GET /summary` read are the same, because
// `rebuild` writes `valueAt` itself.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, listBalanceEntries } from "../accounts/queries";
import type { Ctx } from "../../platform/context";
import { today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { parseDecimal } from "../../shared/money";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { engineService } from "../../../../../test/investments";
import { createTestUser } from "../../../../../test/users";
import { investmentsPortfolio, serviceDetail } from "./queries";
import { PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import { investmentAccountPeriods, investmentAccounts } from "./schema";
import { addAsset, rebuildAll, recordOperation } from "./service";

const eur = (value: number) => BigInt(Math.round(value * 100));

let ctx: Ctx;

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
});

afterAll(closeDatabase);

/** Moves the service's first period back to `from`, so its history can be dated. */
async function backdate(accountId: string, from: string) {
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, accountId));
  await getDb()
    .update(investmentAccounts)
    .set({ managedSince: from })
    .where(eq(investmentAccounts.id, investment.id));
  await getDb()
    .update(investmentAccountPeriods)
    .set({ fromOn: from, startsAt: new Date(`${from}T00:00:00Z`) })
    .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
  await rebuildAll(ctx, accountId);
}

describe("valueAt: one value of a service (INV-3)", () => {
  it("is the same number on the Investments pages, in the API and in Accounts", async () => {
    const { accountId } = await engineService(ctx, {
      name: "Directa",
      category: "broker",
      currency: "EUR",
      mode: "assets",
    });
    await backdate(accountId, "2026-03-01");
    await recordOperation(ctx, accountId, { kind: "deposit", on: "2026-03-01", amountCents: eur(10000) });
    await addAsset(ctx, accountId, {
      asset: { create: { class: "etf", name: "Vanguard FTSE All-World", symbol: "VWCE", currency: "EUR" } },
      product: "custody",
      on: "2026-03-02",
      quantity: parseDecimal("100", QUANTITY_SCALE),
      unitPrice: parseDecimal("60", PRICE_SCALE),
      feeCents: eur(2),
    });
    const holdingId = (await serviceDetail(ctx, accountId))!.holdings[0].id;
    await recordOperation(ctx, accountId, {
      kind: "valuation",
      holdingId,
      on: "2026-06-30",
      unitPrice: parseDecimal("65", PRICE_SCALE),
    });

    const page = (await serviceDetail(ctx, accountId))!.summary.valueCents;
    const api = (await investmentsPortfolio(ctx)).services.find(
      (one) => one.account.id === accountId,
    )?.valueCents;
    const accounts = (await accountsView(ctx, {})).rows.find((row) => row.account.id === accountId)?.balance;
    const stored = (await listBalanceEntries(ctx, accountId, 1000))
      .filter((row) => row.source === "portfolio" && row.on <= today(ctx.timeZone))
      .sort((a, b) => (a.on < b.on ? -1 : 1))
      .at(-1)?.balanceCents;

    expect(page).toBe(eur(10498));
    expect(api).toBe(page);
    expect(accounts).toBe(page);
    expect(stored).toBe(page);
  });
});
