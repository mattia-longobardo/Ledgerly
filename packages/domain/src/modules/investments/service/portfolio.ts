// The manual portfolio (rewrite plan R5d, D2): positions and cash typed by hand, on an investment
// account of Accounts no source reads. The module writes the account's value from then on, as it
// does for a synced service: the cash plus the positions.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccount, listBalanceEntries, readingsAt } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { civilDate } from "../../../shared/inputs";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { MANUAL_PROVIDER, PORTFOLIO_PROVIDER } from "../catalog";
import { positionCents } from "../rules";
import { investmentAccountPeriods, investmentAccounts } from "../schema";
import { assetOfInstrument, holdingFor } from "./assets";
import { lockInvestmentAccount, rebuild, requireInvestmentAccount } from "./book";
import { insertEvent, type LegInput, optionalNote, positive, rateOf } from "./events";
import { openService, serviceUrl, withNewAccount } from "./services";
import { InvestmentError, notFuture, type WriteCtx } from "./types";

const portfolioSchema = z.object({
  accountId: z.uuid(),
  // The same address rule as a manual service: "" is none, a bare host is https (PERS-591).
  url: serviceUrl.nullable().default(null),
});
export type PortfolioInput = z.input<typeof portfolioSchema>;

/**
 * A manual portfolio on an account of Accounts: refused on a fund's account, another type, an account
 * already a service, and an account a source reads (its balance is the bank's). The balance before
 * today is its opening cash, so the account's value does not move.
 */
export async function createPortfolio(ctx: Ctx, input: PortfolioInput): Promise<{ accountId: string }> {
  const parsed = portfolioSchema.parse(input);
  return openService(ctx, {
    accountId: parsed.accountId,
    category: "broker",
    provider: PORTFOLIO_PROVIDER,
    mode: "assets",
    url: parsed.url,
  });
}

/** A manual portfolio on a new account of Accounts, from its name and currency, with no money yet. */
export async function createPortfolioWithAccount(
  ctx: Ctx,
  input: { name: string; currency: string; url: string | null },
): Promise<{ accountId: string }> {
  return withNewAccount(ctx, { ...input, category: "broker", valueCents: null }, (accountId) =>
    createPortfolio(ctx, { accountId, url: input.url }),
  );
}

/** Whether a service is a manual portfolio: its cash and positions are typed by hand. */
export async function isPortfolio(ctx: Pick<Ctx, "userId">, accountId: string): Promise<boolean> {
  return (await requireInvestmentAccount(ctx, accountId)).provider === PORTFOLIO_PROVIDER;
}

const conversionSchema = z.object({
  on: civilDate(),
  positions: z
    .array(
      z.object({
        instrumentId: z.uuid(),
        mic: z
          .string()
          .regex(/^[A-Z0-9]{4}$/)
          .nullable()
          .default(null),
        quantity: positive,
        unitPrice: z.bigint().nonnegative(),
        fxRate: positive.nullable().default(null),
      }),
    )
    .max(100),
  note: optionalNote,
});
export type ConversionInput = z.input<typeof conversionSchema>;

/** The legs of a position of the switch: its holding opened at its price, in the account's currency. */
async function openingLeg(
  ctx: WriteCtx,
  transaction: Tx,
  context: { investmentId: string; currency: string; on: CivilDate },
  position: z.output<typeof conversionSchema>["positions"][number],
): Promise<LegInput> {
  const asset = await assetOfInstrument(
    ctx,
    { instrumentId: position.instrumentId, mic: position.mic },
    transaction,
  );
  const holding = await holdingFor(ctx, transaction, context.investmentId, asset.id, "custody", context.on);
  const rate = await rateOf(asset.currency, context.currency, context.on, position.fxRate);
  return {
    leg: "main",
    kind: "opening_position",
    holdingId: holding.id,
    quantity: position.quantity,
    unitPrice: position.unitPrice,
    priceCurrency: asset.currency,
    fxRate: rate.fxRate,
    fxSource: rate.fxSource,
    amountCents: rate.inAccount(positionCents(position.quantity, position.unitPrice)),
  };
}

/** The service becomes a portfolio from `on`: its provider, its first day as writer, its `assets` period. */
async function switchToPortfolio(
  ctx: WriteCtx,
  transaction: Tx,
  investmentId: string,
  moment: { on: CivilDate; now: Date },
) {
  const [switched] = await transaction
    .update(investmentAccounts)
    .set({ provider: PORTFOLIO_PROVIDER, managedSince: moment.on, updatedAt: moment.now })
    .where(and(eq(investmentAccounts.id, investmentId), userScoped(ctx).owns(investmentAccounts)))
    .returning();
  await transaction.insert(investmentAccountPeriods).values(
    userScoped(ctx).stamp({
      investmentAccountId: investmentId,
      fromOn: moment.on,
      startsAt: moment.now,
      mode: "assets" as const,
      origin: "manual" as const,
      reason: "conversion" as const,
    }),
  );
  return switched;
}

/**
 * «Switch to positions» (R5d, D4): a manual service kept by value becomes a manual portfolio from `on`
 * (§2.5, `total` → `assets`). The value of that day does not move: its positions open at their price
 * and the cash is the rest; positions worth more are `negative_cash`. The days before stay the
 * account's balances. Only on an account typed by hand, and on or after its last balance.
 */
export async function convertToPortfolio(
  ctx: WriteCtx,
  accountId: string,
  input: ConversionInput,
): Promise<void> {
  const parsed = conversionSchema.parse(input);
  notFuture(ctx, parsed.on);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  const [latest] = await listBalanceEntries(ctx, accountId, 1);
  if (latest && latest.on > parsed.on) throw new InvestmentError("before_period");
  const valueCents = (await readingsAt(ctx, [accountId], parsed.on)).get(accountId) ?? 0n;
  await getDb().transaction(async (transaction) => {
    const investment = await lockInvestmentAccount(ctx, accountId, transaction);
    if (investment.provider !== MANUAL_PROVIDER || account.origin !== "manual") {
      throw new InvestmentError("not_eligible");
    }
    const legs: LegInput[] = [];
    for (const position of parsed.positions) {
      legs.push(
        await openingLeg(
          ctx,
          transaction,
          { investmentId: investment.id, currency: account.currency, on: parsed.on },
          position,
        ),
      );
    }
    const cashCents = valueCents - legs.reduce((sum, leg) => sum + leg.amountCents, 0n);
    if (cashCents < 0n) throw new InvestmentError("negative_cash");
    const now = new Date();
    const switched = await switchToPortfolio(ctx, transaction, investment.id, { on: parsed.on, now });
    // One event a leg: an event has one leg of each kind. The cash first, then the positions.
    for (const leg of [
      { leg: "main" as const, kind: "opening_cash" as const, amountCents: cashCents },
      ...legs,
    ]) {
      await insertEvent(ctx, transaction, investment.id, {
        on: parsed.on,
        occurredAt: now,
        origin: "conversion",
        note: parsed.note,
        legs: [leg],
      });
    }
    await rebuild(ctx, switched, account.currency, parsed.on, transaction);
  });
}
