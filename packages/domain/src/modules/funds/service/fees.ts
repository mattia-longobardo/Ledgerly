// Funds · the fees of a fund.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { fundFees } from "../schema";
import { type FeeInput, feeInputSchema, FundError, type FundFee } from "./model";
import { requireFeeScope, requireOpenFund, sourcesOf } from "./reads";

// ——— Fees ———————————————————————————————————————————————————————————————————————————————————

export async function addFee(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: FeeInput & { id?: string },
): Promise<FundFee> {
  await requireOpenFund(ctx, fundId);
  const { id, ...rest } = input;
  const parsed = feeInputSchema.parse(rest);
  requireFeeScope(parsed, await sourcesOf(ctx, [fundId]));
  const [row] = await getDb()
    .insert(fundFees)
    .values(
      userScoped(ctx).stamp({ fundId, ...parsed, ...(id === undefined ? {} : { id: z.uuid().parse(id) }) }),
    )
    .returning();
  return row;
}

async function requireFee(ctx: Pick<Ctx, "userId">, id: string): Promise<FundFee> {
  const [row] = await getDb()
    .select()
    .from(fundFees)
    .where(and(eq(fundFees.id, id), userScoped(ctx).owns(fundFees)));
  if (!row) throw new FundError("not_found");
  return row;
}

export async function updateFee(ctx: Pick<Ctx, "userId">, feeId: string, input: FeeInput): Promise<FundFee> {
  const current = await requireFee(ctx, feeId);
  await requireOpenFund(ctx, current.fundId);
  const parsed = feeInputSchema.parse(input);
  requireFeeScope(parsed, await sourcesOf(ctx, [current.fundId]));
  const [row] = await getDb()
    .update(fundFees)
    .set(parsed)
    .where(and(eq(fundFees.id, feeId), userScoped(ctx).owns(fundFees)))
    .returning();
  return row;
}

/** A fee removed. The contributions already recorded keep the fee each of them states. */
export async function removeFee(ctx: Pick<Ctx, "userId">, feeId: string): Promise<FundFee> {
  const current = await requireFee(ctx, feeId);
  await requireOpenFund(ctx, current.fundId);
  await getDb()
    .delete(fundFees)
    .where(and(eq(fundFees.id, feeId), userScoped(ctx).owns(fundFees)));
  return current;
}
