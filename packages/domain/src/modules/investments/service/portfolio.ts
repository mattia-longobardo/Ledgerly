// The manual portfolio (rewrite plan R5d, D2): positions and cash typed by hand, on an investment
// account of Accounts no source reads. The module writes the account's value from then on, as it
// does for a synced service: the cash plus the positions.
import { z } from "zod";
import { createAccount, readingsAt, removeAccount } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { addDays, today } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { accountTypeOf, PORTFOLIO_PROVIDER } from "../catalog";
import { investmentAccountPeriods, investmentAccounts } from "../schema";
import { requireInvestmentAccount } from "./book";
import { insertEvent } from "./events";
import { eligibleAccounts } from "./services";
import { InvestmentError } from "./types";

export const portfolioSchema = z.object({
  accountId: z.uuid(),
  url: z.string().max(500).nullable().default(null),
});
export type PortfolioInput = z.input<typeof portfolioSchema>;

/**
 * A manual portfolio on an account of Accounts: refused on a fund's account, another type, an account
 * already a service, and an account a source reads (its balance is the bank's, `synced`). The
 * balance before today is its opening cash, so the account's value does not move.
 */
export async function createPortfolio(ctx: Ctx, input: PortfolioInput): Promise<{ accountId: string }> {
  const parsed = portfolioSchema.parse(input);
  const eligible = (await eligibleAccounts(ctx)).find((one) => one.account.id === parsed.accountId);
  if (!eligible || eligible.reason !== null) throw new InvestmentError("not_eligible");
  if (eligible.account.origin !== "manual") throw new InvestmentError("not_eligible");
  const todayOn = today(ctx.timeZone);
  const now = new Date();
  const opening =
    (await readingsAt(ctx, [parsed.accountId], addDays(todayOn, -1))).get(parsed.accountId) ?? null;
  return getDb().transaction(async (transaction) => {
    const [investment] = await transaction
      .insert(investmentAccounts)
      .values(
        userScoped(ctx).stamp({
          accountId: parsed.accountId,
          category: "broker" as const,
          provider: PORTFOLIO_PROVIDER,
          managedSince: todayOn,
          url: parsed.url,
          openedOn: eligible.account.openedOn ?? todayOn,
        }),
      )
      .returning();
    await transaction.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt: now,
        mode: "assets" as const,
        origin: "manual" as const,
        reason: "opening" as const,
      }),
    );
    if (opening !== null && opening !== 0n) {
      await insertEvent(ctx, transaction, investment.id, {
        on: todayOn,
        occurredAt: now,
        origin: "conversion",
        legs: [{ leg: "main", kind: "opening_cash", amountCents: opening }],
      });
    }
    return { accountId: parsed.accountId };
  });
}

/**
 * A manual portfolio on a new account of Accounts, from its name and currency, with no money yet:
 * the first deposit brings it. Two writes of two modules: when the second fails, the account goes.
 */
export async function createPortfolioWithAccount(
  ctx: Ctx,
  input: { name: string; currency: string; url: string | null },
): Promise<{ accountId: string }> {
  const account = await createAccount(ctx, {
    name: input.name,
    type: accountTypeOf("broker"),
    currency: input.currency,
    openingBalance: null,
  });
  try {
    return await createPortfolio(ctx, { accountId: account.id, url: input.url });
  } catch (error) {
    await removeAccount(ctx, account.id);
    throw error;
  }
}

/** Whether a service is a manual portfolio: its cash and positions are typed by hand. */
export async function isPortfolio(ctx: Pick<Ctx, "userId">, accountId: string): Promise<boolean> {
  return (await requireInvestmentAccount(ctx, accountId)).provider === PORTFOLIO_PROVIDER;
}
