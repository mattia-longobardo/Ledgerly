// The prices of the assets of a manual portfolio (rewrite plan R5d): automatic or by hand, the state
// a row shows («to update»), and what the daily job reads and rewrites.
import { and, eq } from "drizzle-orm";
import { isStale, lastCloses, type PricedMarket, type PricesRun } from "../../instruments";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { investmentAccounts, investmentAssets, investmentHoldings } from "../schema";
import { currencyOf, lockInvestmentAccount, rebuild } from "./book";
import { pricedListingOf } from "./market";
import { type InvestmentAsset, InvestmentError, type WriteCtx } from "./types";

/** Where an asset's price comes from, and how old the last one is (contract `assetPrice`). */
export interface AssetPrice {
  mode: "auto" | "manual" | "provider";
  on: CivilDate | null;
  source: string | null;
  stale: boolean;
}

/**
 * The price state of each asset: automatic, from the last close of its market; by hand, from the
 * day of its last valuation when the caller knows it; a provider's, from its reading.
 */
export async function assetPrices(
  assets: readonly InvestmentAsset[],
  todayOn: CivilDate,
  pricedOn: ReadonlyMap<string, CivilDate | null> = new Map(),
): Promise<Map<string, AssetPrice>> {
  const listingOf = await pricedListingOf(assets);
  const closes = await lastCloses([...new Set(listingOf.values())], todayOn);
  const priceOf = (asset: InvestmentAsset): AssetPrice => {
    const known = pricedOn.get(asset.id) ?? null;
    if (asset.priceSource === "provider") return { mode: "provider", on: known, source: null, stale: false };
    const listingId = listingOf.get(asset.id);
    if (asset.priceSource === "market" && listingId !== undefined) {
      const close = closes.get(listingId);
      const lastOn = close?.on ?? null;
      return { mode: "auto", on: lastOn, source: close?.source ?? null, stale: isStale(lastOn, todayOn) };
    }
    return {
      mode: "manual",
      on: known,
      source: known === null ? null : "manual",
      stale: known !== null && isStale(known, todayOn),
    };
  };
  return new Map(assets.map((asset) => [asset.id, priceOf(asset)]));
}

/**
 * Where the price of a holding of a manual portfolio comes from (R5d): `auto`, the daily close of its
 * market; `manual`, the valuations typed by hand. `auto` with no market a source prices: `not_editable`.
 */
export async function setPriceMode(
  ctx: WriteCtx,
  accountId: string,
  holdingId: string,
  mode: "auto" | "manual",
): Promise<void> {
  const currency = await currencyOf(ctx, accountId);
  await getDb().transaction(async (transaction) => {
    const investment = await lockInvestmentAccount(ctx, accountId, transaction);
    if (investment.provider !== PORTFOLIO_PROVIDER) throw new InvestmentError("not_editable");
    const [row] = await transaction
      .select({ holding: investmentHoldings, asset: investmentAssets })
      .from(investmentHoldings)
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
      .where(
        and(
          userScoped(ctx).owns(investmentHoldings),
          eq(investmentHoldings.id, holdingId),
          eq(investmentHoldings.investmentAccountId, investment.id),
        ),
      );
    if (!row || row.holding.origin !== "manual") throw new InvestmentError("not_found");
    const priceSource = mode === "auto" ? ("market" as const) : ("manual" as const);
    if (mode === "auto" && !(await pricedListingOf([{ ...row.asset, priceSource }])).has(row.asset.id)) {
      throw new InvestmentError("not_editable");
    }
    await transaction
      .update(investmentAssets)
      .set({ priceSource, updatedAt: new Date() })
      .where(and(eq(investmentAssets.id, row.asset.id), userScoped(ctx).owns(investmentAssets)));
    await rebuild(ctx, investment, currency, row.holding.openedOn, transaction);
  });
}

/** The person's manual portfolios with their holdings of an automatic asset. */
async function automaticHoldings(ctx: Pick<Ctx, "userId">) {
  return getDb()
    .select({ accountId: investmentAccounts.accountId, holding: investmentHoldings, asset: investmentAssets })
    .from(investmentHoldings)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentHoldings.investmentAccountId))
    .where(
      and(
        userScoped(ctx).owns(investmentHoldings),
        eq(investmentAccounts.provider, PORTFOLIO_PROVIDER),
        eq(investmentHoldings.origin, "manual"),
        eq(investmentAssets.priceSource, "market"),
      ),
    );
}

/** The markets the daily job reads for a person: each from the day its oldest holding opened. */
export async function pricedMarkets(ctx: Pick<Ctx, "userId">): Promise<PricedMarket[]> {
  const rows = await automaticHoldings(ctx);
  const listingOf = await pricedListingOf(rows.map((row) => row.asset));
  return rows.flatMap((row) => {
    const listingId = listingOf.get(row.asset.id);
    return listingId === undefined ? [] : [{ listingId, neededFrom: row.holding.openedOn }];
  });
}

/** After a run of the job: every portfolio of the person on a market whose closes changed, rewritten from the oldest day. */
export async function revalueAfterPrices(ctx: WriteCtx, run: Pick<PricesRun, "changed">): Promise<number> {
  if (run.changed.size === 0) return 0;
  const rows = await automaticHoldings(ctx);
  const listingOf = await pricedListingOf(rows.map((row) => row.asset));
  const fromOf = new Map<string, CivilDate>();
  for (const row of rows) {
    const changedOn = run.changed.get(listingOf.get(row.asset.id) ?? "");
    if (changedOn === undefined) continue;
    const before = fromOf.get(row.accountId);
    if (before === undefined || changedOn < before) fromOf.set(row.accountId, changedOn);
  }
  for (const [accountId, from] of fromOf) {
    const currency = await currencyOf(ctx, accountId);
    await getDb().transaction(async (transaction) => {
      const investment = await lockInvestmentAccount(ctx, accountId, transaction);
      await rebuild(
        ctx,
        investment,
        currency,
        from < today(ctx.timeZone) ? from : today(ctx.timeZone),
        transaction,
      );
    });
  }
  return fromOf.size;
}
