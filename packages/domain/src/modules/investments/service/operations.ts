// The operations of a service (§1.5): recorded, corrected with their revisions, deleted.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../../accounts";
import { getTransaction } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { MANUAL_PROVIDER, PORTFOLIO_PROVIDER } from "../catalog";
import { ADJUSTMENT_CLASSES, oldestDay, positionCents, shortPosition } from "../rules";
import {
  investmentAccounts,
  investmentEvents,
  investmentHoldings,
  investmentOperationRevisions,
  investmentOperations,
} from "../schema";
import { civilDate } from "../../../shared/inputs";
import { currencyOf, loadBook, type LoadedBook, lockInvestmentAccount, rebuild } from "./book";
import { insertEvent, insertLegs, type LegInput, optionalNote, periodOn, positive, rateOf } from "./events";
import { clearTransferGroup } from "./transfers";
import {
  type InvestmentAccount,
  InvestmentError,
  type InvestmentEvent,
  notFuture,
  translated,
  type WriteCtx,
} from "./types";

export const operationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["deposit", "withdrawal"]),
    on: civilDate(),
    amountCents: positive,
    transactionId: z.uuid().nullable().default(null),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("account_valuation"),
    on: civilDate(),
    amountCents: z.bigint().nonnegative(),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("valuation"),
    holdingId: z.uuid(),
    on: civilDate(),
    unitPrice: z.bigint().nonnegative().nullable().default(null),
    amountCents: z.bigint().nonnegative().nullable().default(null),
    note: optionalNote,
  }),
  z.object({
    kind: z.enum(["sell", "close"]),
    holdingId: z.uuid(),
    on: civilDate(),
    quantity: positive.nullable().default(null),
    unitPrice: z.bigint().nonnegative().nullable().default(null),
    /** The proceeds in the asset's currency, when no price is typed. */
    amountCents: z.bigint().nonnegative().nullable().default(null),
    feeCents: z.bigint().nonnegative().default(0n),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("income"),
    holdingId: z.uuid().nullable().default(null),
    on: civilDate(),
    amountCents: positive,
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("adjustment"),
    on: civilDate(),
    amountCents: z.bigint().refine((value) => value !== 0n, "An adjustment moves the value"),
    validUntil: civilDate().nullable().default(null),
    adjustmentClass: z.enum(ADJUSTMENT_CLASSES).default("data"),
    note: z.string().trim().min(1).max(200),
  }),
]);
export type OperationInput = z.input<typeof operationInputSchema>;

/**
 * A bank movement may document a deposit or a withdrawal only when it is the person's own and goes
 * the same way: money out of the account for a deposit, into it for a withdrawal.
 */
async function requireLinkable(
  ctx: Pick<Ctx, "userId">,
  transactionId: string | null,
  kind: "deposit" | "withdrawal",
): Promise<void> {
  if (transactionId === null) return;
  const transaction = await getTransaction(ctx, transactionId);
  if (!transaction || transaction.amountCents === 0n) throw new InvestmentError("invalid_transaction");
  if ((kind === "deposit") !== transaction.amountCents < 0n) throw new InvestmentError("invalid_transaction");
}

/** The legs of an operation the person typed, checked against the book of its day. */
async function legsOf(
  ctx: Pick<Ctx, "userId">,
  book: LoadedBook,
  input: z.output<typeof operationInputSchema>,
  account: { currency: string },
): Promise<{ legs: LegInput[]; transactionId: string | null }> {
  const period = periodOn(book, input.on);
  if (period === null) throw new InvestmentError("before_period");
  switch (input.kind) {
    case "deposit":
    case "withdrawal":
      await requireLinkable(ctx, input.transactionId, input.kind);
      return {
        legs: [
          {
            leg: "main",
            kind: input.kind,
            amountCents: input.kind === "deposit" ? input.amountCents : -input.amountCents,
          },
        ],
        transactionId: input.transactionId,
      };
    case "account_valuation":
      if (period.mode !== "total" || period.origin !== "manual") throw new InvestmentError("wrong_mode");
      return {
        legs: [{ leg: "main", kind: "account_valuation", amountCents: input.amountCents }],
        transactionId: null,
      };
    case "adjustment":
      if (input.validUntil !== null && input.validUntil < input.on)
        throw new RangeError("Ends before it starts");
      return {
        legs: [
          {
            leg: "main",
            kind: "adjustment",
            amountCents: input.amountCents,
            validUntil: input.validUntil,
            adjustmentClass: input.adjustmentClass,
          },
        ],
        transactionId: null,
      };
    case "income":
      return {
        legs: [{ leg: "main", kind: "income", holdingId: input.holdingId, amountCents: input.amountCents }],
        transactionId: null,
      };
    default: {
      if (period.mode !== "assets") throw new InvestmentError("wrong_mode");
      const holding = book.holdingRows.find((one) => one.id === input.holdingId && one.origin === "manual");
      if (!holding) throw new InvestmentError("not_found");
      const currency = holding.asset.currency;
      const { fxRate, fxSource, inAccount } = await rateOf(currency, account.currency, input.on, null);
      if (input.kind === "valuation") {
        if ((input.unitPrice === null) === (input.amountCents === null))
          throw new RangeError("A price or a value");
        return {
          legs: [
            {
              leg: "main",
              kind: "valuation",
              holdingId: holding.id,
              unitPrice: input.unitPrice,
              priceCurrency: currency,
              fxRate,
              fxSource,
              amountCents: input.amountCents === null ? 0n : inAccount(input.amountCents),
            },
          ],
          transactionId: null,
        };
      }
      const proceeds =
        input.quantity !== null && input.unitPrice !== null
          ? positionCents(input.quantity, input.unitPrice)
          : input.amountCents;
      if (proceeds === null) throw new RangeError("A sale needs a price or its proceeds");
      const legs: LegInput[] = [
        {
          leg: "main",
          kind: input.kind,
          holdingId: holding.id,
          quantity: input.quantity,
          unitPrice: input.quantity === null ? null : input.unitPrice,
          priceCurrency: currency,
          fxRate,
          fxSource,
          amountCents: inAccount(proceeds),
        },
      ];
      if (input.feeCents > 0n)
        legs.push({ leg: "fee", kind: "fee", amountCents: -inAccount(input.feeCents) });
      return { legs, transactionId: null };
    }
  }
}

/**
 * A manual service is a view on its account (PERS-342): its money in and out are the account's
 * movements and its value the account's balance, so no operation is written to it.
 */
function refuseValueChange(investment: InvestmentAccount): void {
  if (investment.provider === MANUAL_PROVIDER) throw new InvestmentError("not_editable");
}

/**
 * A manual portfolio never holds less than nothing (R5d): after a write, a position below zero at the
 * end of a day — a sale of more than is held, or a purchase changed or deleted under a later sale —
 * is refused, and the transaction with it.
 */
async function refuseShort(
  ctx: WriteCtx,
  investment: InvestmentAccount,
  currency: string,
  tx: Tx,
): Promise<void> {
  if (investment.provider !== PORTFOLIO_PROVIDER) return;
  if (shortPosition(await loadBook(ctx, investment, currency, tx)) !== null) {
    throw new InvestmentError("quantity_exceeded");
  }
}

/**
 * An operation on a service the module writes: one event with its legs, and the points rewritten
 * from its day. The app offers only what does not move a synced value by hand (`actions.ts`); the
 * engine takes every kind, as a provider's events and the tests deliver them.
 */
export async function recordOperation(
  ctx: WriteCtx,
  accountId: string,
  input: OperationInput,
): Promise<{ eventId: string }> {
  const parsed = operationInputSchema.parse(input);
  notFuture(ctx, parsed.on);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    refuseValueChange(investment);
    const book = await loadBook(ctx, investment, account.currency, tx);
    const { legs, transactionId } = await legsOf(ctx, book, parsed, account);
    const event = await insertEvent(ctx, tx, investment.id, {
      on: parsed.on,
      occurredAt: new Date(),
      origin: "manual",
      note: parsed.note,
      transactionId,
      legs,
    });
    await refuseShort(ctx, investment, account.currency, tx);
    await rebuild(ctx, investment, account.currency, parsed.on, tx);
    return { eventId: event.id };
  });
}

/** The person's event, of the service `ofAccount` when given: otherwise `not_found`. */
export async function requireEvent(ctx: Pick<Ctx, "userId">, eventId: string, tx: Tx, ofAccount?: string) {
  const [row] = await tx
    .select({ event: investmentEvents, accountId: investmentAccounts.accountId })
    .from(investmentEvents)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentEvents.investmentAccountId))
    .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
  if (!row || (ofAccount !== undefined && row.accountId !== ofAccount))
    throw new InvestmentError("not_found");
  return row;
}

/** Saves every leg of an event as it was (A2): an operation is never overwritten silently. */
async function keepRevisions(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  event: InvestmentEvent,
  reason: "edited" | "deleted",
): Promise<void> {
  const legs = await tx
    .select()
    .from(investmentOperations)
    .where(and(eq(investmentOperations.eventId, event.id), userScoped(ctx).owns(investmentOperations)));
  if (legs.length === 0) return;
  await tx.insert(investmentOperationRevisions).values(
    legs.map((leg) =>
      userScoped(ctx).stamp({
        investmentAccountId: event.investmentAccountId,
        eventId: event.id,
        operationId: leg.id,
        reason,
        before: {
          on: event.on,
          note: event.note,
          transactionId: event.transactionId,
          leg: leg.leg,
          kind: leg.kind,
          holdingId: leg.holdingId,
          quantity: leg.quantity,
          unitPrice: leg.unitPrice,
          priceCurrency: leg.priceCurrency,
          fxRate: leg.fxRate,
          fxSource: leg.fxSource,
          amountCents: leg.amountCents.toString(),
          validUntil: leg.validUntil,
        },
      }),
    ),
  );
}

/**
 * A manual event changed (A2): the legs before go to the revisions, the new ones take their place,
 * and the points are rewritten from the older of the two days. A buy keeps its asset and product;
 * an event a conversion or a provider wrote is not the person's to edit.
 */
export async function updateOperation(ctx: WriteCtx, eventId: string, input: OperationInput): Promise<void> {
  const parsed = operationInputSchema.parse(input);
  notFuture(ctx, parsed.on);
  await getDb().transaction(async (tx) => {
    const { event, accountId } = await requireEvent(ctx, eventId, tx);
    if (event.origin !== "manual") throw new InvestmentError("not_editable");
    const account = await getAccount(ctx, accountId);
    if (!account) throw new InvestmentError("not_found");
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    refuseValueChange(investment);
    const [main] = await tx
      .select({ kind: investmentOperations.kind })
      .from(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), eq(investmentOperations.leg, "main")));
    if (!main || main.kind !== parsed.kind) throw new InvestmentError("not_editable");
    await keepRevisions(ctx, tx, event, "edited");
    await tx
      .delete(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), userScoped(ctx).owns(investmentOperations)));
    const book = await loadBook(ctx, investment, account.currency, tx);
    const { legs, transactionId } = await legsOf(ctx, book, parsed, account);
    await translated(
      tx
        .update(investmentEvents)
        .set({ on: parsed.on, note: parsed.note, transactionId })
        .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents))),
    );
    await insertLegs(ctx, tx, eventId, legs);
    await refuseShort(ctx, investment, account.currency, tx);
    await rebuild(ctx, investment, account.currency, oldestDay(event.on, parsed.on) as CivilDate, tx);
  });
}

/**
 * A manual event deleted, its legs kept in the revisions, the points rewritten from its day. With
 * `ofAccount`, an event of another service is `not_found` (a route names the service in its path).
 */
export async function deleteOperation(ctx: WriteCtx, eventId: string, ofAccount?: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const { event, accountId } = await requireEvent(ctx, eventId, tx, ofAccount);
    if (event.origin !== "manual") throw new InvestmentError("not_editable");
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    await keepRevisions(ctx, tx, event, "deleted");
    const legs = await tx
      .delete(investmentOperations)
      .where(and(eq(investmentOperations.eventId, eventId), userScoped(ctx).owns(investmentOperations)))
      .returning({ holdingId: investmentOperations.holdingId });
    await tx
      .delete(investmentEvents)
      .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
    // The other leg of a transfer is a plain flow again: its partner is gone (§2.4).
    if (event.transferGroupId) await clearTransferGroup(ctx, tx, event.transferGroupId);
    // A position nothing refers to any more goes with its last operation.
    const holdingIds = [...new Set(legs.flatMap((leg) => (leg.holdingId ? [leg.holdingId] : [])))];
    for (const holdingId of holdingIds) {
      const [used] = await tx
        .select({ id: investmentOperations.id })
        .from(investmentOperations)
        .where(eq(investmentOperations.holdingId, holdingId))
        .limit(1);
      if (!used) {
        await tx
          .delete(investmentHoldings)
          .where(and(eq(investmentHoldings.id, holdingId), userScoped(ctx).owns(investmentHoldings)));
      }
    }
    const currency = await currencyOf(ctx, accountId);
    await refuseShort(ctx, investment, currency, tx);
    await rebuild(ctx, investment, currency, event.on, tx);
  });
}
