// The asset catalog (§1.4): its seed and a new asset.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { ASSET_SEED } from "../catalog";
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
