// Readings and reconciliation (§1.6, R4, R5): a reading saved, an empty one confirmed, a holding reconciled.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type CivilDate } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import {
  PRICE_SCALE,
  PRODUCT_PATTERN,
  missingPricesOf,
  QUANTITY_SCALE,
  READING_STATUSES,
  RECONCILIATION_KINDS,
} from "../rules";
import { formatDecimal } from "../../../shared/money";
import {
  investmentAccounts,
  investmentHoldings,
  investmentReadingPositions,
  investmentReadings,
  investmentReadingScopes,
  investmentReconciliations,
} from "../schema";
import { civilDate } from "../../../shared/inputs";
import { currencyOf, lockInvestmentAccount, rebuild } from "./book";
import { optionalNote, positive } from "./events";
import { decimal, InvestmentError, notFuture, translated, type WriteCtx } from "./types";

// ——— Readings and reconciliation (§1.6, R4, R5) ——————————————————————————————————————————————

export interface ReadingInput {
  on: CivilDate;
  observedAt: Date;
  status: (typeof READING_STATUSES)[number];
  totalCents: Cents;
  cashCents?: Cents | null;
  missingPrices?: number;
  positions: readonly {
    assetId: string;
    product: string;
    quantity: bigint;
    price: bigint | null;
    priceCurrency: string | null;
    priceSource: string | null;
    valueCents: Cents | null;
  }[];
  scopes: readonly { externalAccountId: string; product: string; complete: boolean }[];
}

/**
 * A provider's reading of a day (§1.6): the last of the day replaces the earlier ones, with its
 * positions and its scope, and the points are rewritten from that day (R6). The provider adapters
 * of phases 3 and 4 call it; phase 2 has none, so only the seed and the tests do.
 */
export async function saveReading(
  ctx: WriteCtx,
  accountId: string,
  input: ReadingInput,
): Promise<{ readingId: string }> {
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    await tx
      .delete(investmentReadings)
      .where(
        and(
          userScoped(ctx).owns(investmentReadings),
          eq(investmentReadings.investmentAccountId, investment.id),
          eq(investmentReadings.on, input.on),
        ),
      );
    const [reading] = await tx
      .insert(investmentReadings)
      .values(
        userScoped(ctx).stamp({
          investmentAccountId: investment.id,
          on: input.on,
          observedAt: input.observedAt,
          status: input.status,
          totalCents: input.totalCents,
          cashCents: input.cashCents ?? null,
          missingPrices: input.missingPrices ?? missingPricesOf(input.positions),
        }),
      )
      .returning();
    if (input.positions.length > 0) {
      await tx.insert(investmentReadingPositions).values(
        input.positions.map((position) =>
          userScoped(ctx).stamp({
            readingId: reading.id,
            assetId: position.assetId,
            product: position.product,
            quantity: formatDecimal(position.quantity, QUANTITY_SCALE),
            price: decimal(position.price, PRICE_SCALE),
            priceCurrency: position.priceCurrency,
            priceAt: input.observedAt,
            priceSource: position.priceSource,
            valueCents: position.valueCents,
          }),
        ),
      );
    }
    if (input.scopes.length > 0) {
      await tx
        .insert(investmentReadingScopes)
        .values(input.scopes.map((scope) => userScoped(ctx).stamp({ readingId: reading.id, ...scope })));
    }
    await rebuild(ctx, investment, await currencyOf(ctx, accountId), input.on, tx);
    return { readingId: reading.id };
  });
}

/** "The account was emptied" (R5): a `pending_zero` reading counts from its day; of `ofAccount` when given. */
export async function confirmZeroReading(
  ctx: WriteCtx,
  readingId: string,
  ofAccount?: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ reading: investmentReadings, accountId: investmentAccounts.accountId })
      .from(investmentReadings)
      .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentReadings.investmentAccountId))
      .where(and(eq(investmentReadings.id, readingId), userScoped(ctx).owns(investmentReadings)));
    if (
      !row ||
      row.reading.status !== "pending_zero" ||
      (ofAccount !== undefined && row.accountId !== ofAccount)
    )
      throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, row.accountId, tx);
    await tx
      .update(investmentReadings)
      .set({ status: "confirmed_zero" })
      .where(and(eq(investmentReadings.id, readingId), userScoped(ctx).owns(investmentReadings)));
    await rebuild(ctx, investment, await currencyOf(ctx, row.accountId), row.reading.on, tx);
  });
}

export const reconciliationInputSchema = z.object({
  holdingId: z.uuid(),
  kind: z.enum(RECONCILIATION_KINDS),
  effectiveOn: civilDate(),
  /** For `partial`: how much of the position the provider covers. */
  quantity: positive.nullable().default(null),
  /** For `outside_scope`: the product the manual position really is in. */
  product: z.string().regex(new RegExp(PRODUCT_PATTERN)).nullable().default(null),
  readingId: z.uuid().nullable().default(null),
  note: optionalNote,
});
export type ReconciliationInput = z.input<typeof reconciliationInputSchema>;

/**
 * "Reconcile" (R4): a dated decision on a manual position the provider's reading may cover. The
 * points are rewritten from its decorrenza; "outside the scope" moves the position to the product
 * it really is in.
 */
export async function reconcileHolding(
  ctx: WriteCtx,
  input: ReconciliationInput,
  /** The service the holding must be of: another one's is `not_found`. */
  ofAccount?: string,
): Promise<void> {
  const parsed = reconciliationInputSchema.parse(input);
  notFuture(ctx, parsed.effectiveOn);
  if ((parsed.kind === "partial") !== (parsed.quantity !== null))
    throw new RangeError("Partial needs a quantity");
  if (parsed.kind === "outside_scope" && parsed.product === null)
    throw new RangeError("Outside needs a product");
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ holding: investmentHoldings, accountId: investmentAccounts.accountId })
      .from(investmentHoldings)
      .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentHoldings.investmentAccountId))
      .where(and(eq(investmentHoldings.id, parsed.holdingId), userScoped(ctx).owns(investmentHoldings)));
    if (!row || row.holding.origin !== "manual" || (ofAccount !== undefined && row.accountId !== ofAccount))
      throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, row.accountId, tx);
    if (
      parsed.kind === "outside_scope" &&
      parsed.product !== null &&
      parsed.product !== row.holding.product
    ) {
      await translated(
        tx
          .update(investmentHoldings)
          .set({ product: parsed.product })
          .where(and(eq(investmentHoldings.id, row.holding.id), userScoped(ctx).owns(investmentHoldings))),
      );
    }
    await tx.insert(investmentReconciliations).values(
      userScoped(ctx).stamp({
        holdingId: parsed.holdingId,
        kind: parsed.kind,
        effectiveOn: parsed.effectiveOn,
        quantity: decimal(parsed.quantity, QUANTITY_SCALE),
        readingId: parsed.readingId,
        note: parsed.note,
      }),
    );
    await rebuild(ctx, investment, await currencyOf(ctx, row.accountId), parsed.effectiveOn, tx);
  });
}
