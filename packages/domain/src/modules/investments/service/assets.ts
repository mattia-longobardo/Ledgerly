// The asset catalog (§1.4): its seed and a new asset.
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { ASSET_SEED } from "../catalog";
import { marketPrices, type RegistryInstrument } from "../ports";
import { ASSET_CLASSES } from "../rules";
import { investmentAssets, investmentHoldings } from "../schema";
import { type InvestmentAsset, InvestmentError, type InvestmentHolding, translated } from "./types";

// ——— Assets —————————————————————————————————————————————————————————————————————————————

export const assetInputSchema = z.object({
  class: z.enum(ASSET_CLASSES),
  name: z.string().trim().min(1).max(120),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2}[A-Z0-9]{9}[0-9])?$/)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type AssetInput = z.input<typeof assetInputSchema>;

/** The seed of the asset catalog (§1.4), written once for a person who has none yet. */
export async function ensureAssetSeed(ctx: Pick<Ctx, "userId">): Promise<void> {
  const [existing] = await getDb()
    .select({ id: investmentAssets.id })
    .from(investmentAssets)
    .where(userScoped(ctx).owns(investmentAssets))
    .limit(1);
  if (existing) return;
  await getDb()
    .insert(investmentAssets)
    .values(ASSET_SEED.map((asset) => userScoped(ctx).stamp({ ...asset })))
    .onConflictDoNothing();
}

export async function createAsset(
  ctx: Pick<Ctx, "userId">,
  input: AssetInput,
  tx?: Tx,
): Promise<InvestmentAsset> {
  const parsed = assetInputSchema.parse(input);
  const [row] = await translated(
    (tx ?? getDb()).insert(investmentAssets).values(userScoped(ctx).stamp(parsed)).returning(),
  );
  return row;
}

export async function requireAsset(ctx: Pick<Ctx, "userId">, id: string, tx: Tx): Promise<InvestmentAsset> {
  const [row] = await tx
    .select()
    .from(investmentAssets)
    .where(and(eq(investmentAssets.id, id), userScoped(ctx).owns(investmentAssets)));
  if (!row) throw new InvestmentError("not_found");
  return row;
}

export async function holdingFor(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  assetId: string,
  product: string,
  on: CivilDate,
): Promise<InvestmentHolding> {
  const [found] = await tx
    .select()
    .from(investmentHoldings)
    .where(
      and(
        userScoped(ctx).owns(investmentHoldings),
        eq(investmentHoldings.investmentAccountId, investmentAccountId),
        eq(investmentHoldings.assetId, assetId),
        eq(investmentHoldings.origin, "manual"),
        eq(investmentHoldings.product, product),
      ),
    );
  if (found) return found;
  const [row] = await tx
    .insert(investmentHoldings)
    .values(
      userScoped(ctx).stamp({
        investmentAccountId,
        assetId,
        origin: "manual" as const,
        product,
        openedOn: on,
      }),
    )
    .returning();
  return row;
}

/** An instrument of the registry on the market of the order (R5d); `mic` null for one with no market. */
interface InstrumentRef {
  instrumentId: string;
  mic: string | null;
}

/**
 * The person's asset of an instrument of the registry (R5d): theirs already — by the instrument, or
 * by its ISIN when they typed it by hand before, which it then names — or a new one. Its price is
 * automatic when its market has a source, by hand otherwise.
 */
export async function assetOfInstrument(
  ctx: Pick<Ctx, "userId">,
  ref: InstrumentRef,
  transaction: Tx,
): Promise<InvestmentAsset> {
  const instrument = await marketPrices().instrumentById(ref.instrumentId);
  if (!instrument) throw new InvestmentError("not_found");
  const values = assetValuesOf(instrument, ref);
  const mine = userScoped(ctx).owns(investmentAssets);
  const sameInstrument = eq(investmentAssets.instrumentId, instrument.instrumentId);
  const [found] = await transaction
    .select()
    .from(investmentAssets)
    .where(
      and(
        mine,
        instrument.isin === null
          ? sameInstrument
          : or(sameInstrument, eq(investmentAssets.isin, instrument.isin)),
      ),
    );
  if (found && found.instrumentId === instrument.instrumentId && found.mic === ref.mic) return found;
  const write = found
    ? transaction
        .update(investmentAssets)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(investmentAssets.id, found.id), mine))
        .returning()
    : transaction
        .insert(investmentAssets)
        .values(
          userScoped(ctx).stamp({
            ...values,
            class: instrument.class,
            name: instrument.name.slice(0, 120),
            isin: instrument.isin,
          }),
        )
        .returning();
  const [row] = await translated(write);
  return row;
}

/** What an asset takes from its instrument and the market of the order: an automatic price when a source has it. */
function assetValuesOf(instrument: RegistryInstrument, ref: InstrumentRef) {
  const listing = ref.mic === null ? null : instrument.listings.find((one) => one.mic === ref.mic);
  if (listing === undefined) throw new InvestmentError("not_found");
  return {
    instrumentId: instrument.instrumentId,
    mic: ref.mic,
    symbol: listing?.ticker ?? null,
    currency: listing?.currency ?? instrument.currency,
    priceSource: listing?.priced ? ("market" as const) : ("manual" as const),
  };
}
