// The instruments of a basket plan (PERS-681, docs/design/investments-plans-whole-shares.md §3.2): each
// with its weight in basis points, 1-10 of them, 100 % in all, each once. Written whole, in the plan's
// transaction: the sum and the count are checked here, not by a trigger.
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import type { Tx } from "../../../platform/db/client";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { MAX_PLAN_INSTRUMENTS, WEIGHT_WHOLE } from "../rules";
import { investmentAssets, investmentPlanInstruments } from "../schema";
import { assetOfInstrument, requireAsset } from "./assets";

const assetRef = z.union([
  z.object({ id: z.uuid() }),
  z.object({
    instrument: z.object({
      instrumentId: z.uuid(),
      mic: z
        .string()
        .regex(/^[A-Z0-9]{4}$/)
        .nullable(),
    }),
  }),
]);

export const instrumentsSchema = z
  .array(z.object({ asset: assetRef, weightBp: z.number().int().min(1).max(WEIGHT_WHOLE) }))
  .min(1)
  .max(MAX_PLAN_INSTRUMENTS)
  .refine(
    (rows) => rows.reduce((sum, row) => sum + row.weightBp, 0) === WEIGHT_WHOLE,
    "The weights make 100 %",
  );

/** A basket's cadence: every N working days, weeks or months (`quarter` stays for the plans of R5d). */
export const BASKET_FREQUENCIES = ["day", "week", "month"] as const;

/**
 * Replaces the instruments of a plan, inside its transaction: an asset named twice (also through two
 * markets of one instrument) is `invalid`.
 */
export async function writeInstruments(
  ctx: Pick<Ctx, "userId">,
  transaction: Tx,
  planId: string,
  rows: z.output<typeof instrumentsSchema>,
): Promise<void> {
  const assets: { id: string }[] = [];
  for (const row of rows) {
    assets.push(
      "id" in row.asset
        ? await requireAsset(ctx, row.asset.id, transaction)
        : await assetOfInstrument(ctx, row.asset.instrument, transaction),
    );
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new RangeError("An instrument is in the plan once");
  }
  await transaction.delete(investmentPlanInstruments).where(eq(investmentPlanInstruments.planId, planId));
  await transaction
    .insert(investmentPlanInstruments)
    .values(
      rows.map((row, position) =>
        userScoped(ctx).stamp({ planId, assetId: assets[position].id, weightBp: row.weightBp, position }),
      ),
    );
}

/** The instruments of some plans with their assets, in the order they were typed. */
export async function instrumentsOf(ctx: Pick<Ctx, "userId">, planIds: readonly string[], transaction?: Tx) {
  if (planIds.length === 0) return [];
  return (transaction ?? getDb())
    .select({ row: investmentPlanInstruments, asset: investmentAssets })
    .from(investmentPlanInstruments)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentPlanInstruments.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentPlanInstruments),
        inArray(investmentPlanInstruments.planId, [...planIds]),
      ),
    )
    .orderBy(asc(investmentPlanInstruments.position));
}
