// Funds · the values recorded by hand, each one a balance of the fund's account.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { isCivilDate, today } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { deleteBalanceEntry, isFutureDate, saveBalanceEntry } from "../../accounts";
import { fundValuations } from "../schema";
import { FundError, type FundValuation } from "./model";
import { requireOpenFund } from "./reads";

// ——— Valuations —————————————————————————————————————————————————————————————————————————————

interface ValuationInput {
  on: string;
  cents: Cents;
  units?: string | null;
  note?: string | null;
}

/** A valuation's day (never in the future) and the two fields the balance has no place for. */
function valuationFields(
  ctx: Pick<Ctx, "timeZone">,
  input: ValuationInput,
): { units: string | null; note: string | null } {
  if (!isCivilDate(input.on)) throw new FundError("invalid");
  if (isFutureDate(input.on, today(ctx.timeZone))) throw new FundError("future_date");
  const units = input.units === undefined || input.units === null || input.units === "" ? null : input.units;
  if (units !== null && !/^\d+(\.\d{1,6})?$/.test(units)) throw new FundError("invalid");
  return { units, note: input.note?.trim() ? input.note.trim().slice(0, 200) : null };
}

/**
 * A valuation (spec §7.7): a `manual` balance on the valuation account on that day — the value's one
 * home, which net worth reads — and the units and note beside it. A second valuation on the same
 * day replaces the first.
 */
export async function recordValuation(
  ctx: Ctx,
  fundId: string,
  input: ValuationInput,
): Promise<FundValuation> {
  const fund = await requireOpenFund(ctx, fundId);
  const { units, note } = valuationFields(ctx, input);
  const entry = await saveBalanceEntry(ctx, fund.valuationAccountId, {
    on: input.on,
    cents: input.cents,
    note: note ?? "",
  });
  const [row] = await getDb()
    .insert(fundValuations)
    .values(
      userScoped(ctx).stamp({ fundId, balanceEntryId: entry.id, units, note, source: "manual" as const }),
    )
    .onConflictDoUpdate({ target: fundValuations.balanceEntryId, set: { units, note } })
    .returning();
  return row;
}

async function requireValuation(ctx: Pick<Ctx, "userId">, valuationId: string): Promise<FundValuation> {
  const [row] = await getDb()
    .select()
    .from(fundValuations)
    .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)));
  if (!row) throw new FundError("not_found");
  return row;
}

/**
 * A valuation corrected by hand (day, value, units, note). The value's one home is the `manual`
 * balance of the valuation account, so a new day **moves** that balance instead of adding a second:
 * the value is written on the new day, the valuation row follows it inside one transaction — taking
 * with it any valuation that already sat there, which is what «one value per day» means — and only
 * then is the balance of the old day dropped, with nothing left pointing at it. A valuation read
 * from a statement before release N6 (`import`) is not edited here: it stays as it was read.
 */
export async function updateValuation(
  ctx: Ctx,
  valuationId: string,
  input: ValuationInput,
): Promise<FundValuation> {
  const current = await requireValuation(ctx, valuationId);
  if (current.source !== "manual") throw new FundError("invalid");
  const fund = await requireOpenFund(ctx, current.fundId);
  const { units, note } = valuationFields(ctx, input);
  const previousEntryId = current.balanceEntryId;
  const entry = await saveBalanceEntry(ctx, fund.valuationAccountId, {
    on: input.on,
    cents: input.cents,
    note: note ?? "",
  });
  if (entry.id === previousEntryId) {
    const [row] = await getDb()
      .update(fundValuations)
      .set({ units, note })
      .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)))
      .returning();
    return row;
  }
  const row = await getDb().transaction(async (tx) => {
    await tx
      .delete(fundValuations)
      .where(and(eq(fundValuations.balanceEntryId, entry.id), userScoped(ctx).owns(fundValuations)));
    const [moved] = await tx
      .update(fundValuations)
      .set({ balanceEntryId: entry.id, units, note })
      .where(and(eq(fundValuations.id, valuationId), userScoped(ctx).owns(fundValuations)))
      .returning();
    return moved;
  });
  await deleteBalanceEntry(ctx, previousEntryId);
  return row;
}

/** Deleting a valuation deletes its balance; the valuation row goes with it (cascade). */
export async function deleteValuation(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  valuationId: string,
): Promise<void> {
  const row = await requireValuation(ctx, valuationId);
  await deleteBalanceEntry(ctx, row.balanceEntryId);
}
