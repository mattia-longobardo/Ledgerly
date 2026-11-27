// The operations of a service (§1.5): recorded, corrected with their revisions, deleted.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../../accounts";
import { getTransaction, transferSideOf } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { MANUAL_PROVIDER } from "../catalog";
import { cashLegs } from "../ports";
import { ADJUSTMENT_CLASSES, oldestDay, positionCents } from "../rules";
import { investmentEvents, investmentOperations } from "../schema";
import { civilDate } from "../../../shared/inputs";
import { currencyOf, loadBook, type LoadedBook, lockInvestmentAccount, rebuild } from "./book";
import { writeCashLegs } from "./cash-legs";
import {
  type BuyInput,
  buyInputSchema,
  buyLegs,
  insertEvent,
  insertLegs,
  type LegInput,
  optionalNote,
  periodOn,
  positive,
  rateOf,
} from "./events";
import { checkPortfolio } from "./guards";
import { dropUnusedHoldings, keepRevisions, requireEvent } from "./revisions";
import { clearTransferGroup } from "./transfers";
import { type InvestmentAccount, InvestmentError, notFuture, translated, type WriteCtx } from "./types";
import { startPortfolioBy } from "./periods";

/** The other side of a deposit's leg, as the person chose it (PERS-651). */
const counterpartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), accountId: z.uuid() }),
  z.object({ kind: z.literal("outside") }),
  z.object({ kind: z.literal("none") }),
]);

export const operationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["deposit", "withdrawal"]),
    on: civilDate(),
    amountCents: positive,
    transactionId: z.uuid().nullable().default(null),
    /**
     * The other side of the account's leg (PERS-651), as the person chose it: one of their accounts,
     * one outside, or "not a giroconto". `null`: the bank movement `transactionId` names, else the
     * rules of the giroconti, else an account outside.
     */
    counterpart: counterpartSchema.nullable().default(null),
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
    // A fee of its own, from the cash (R5d): a manual portfolio's custody or stamp duty.
    kind: z.literal("fee"),
    on: civilDate(),
    amountCents: positive,
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
    case "fee":
      return { legs: [{ leg: "main", kind: "fee", amountCents: -input.amountCents }], transactionId: null };
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
  const { eventId, cash } = await getDb().transaction(async (tx) => {
    const locked = await lockInvestmentAccount(ctx, accountId, tx);
    refuseValueChange(locked);
    const investment = await startPortfolioBy(ctx, locked, parsed.on, tx);
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
    await checkPortfolio(ctx, investment, account.currency, tx);
    await rebuild(ctx, investment, account.currency, parsed.on, tx);
    return {
      eventId: event.id,
      cash: await cashLegsOf(ctx, tx, parsed, { investment, currency: account.currency, eventId: event.id }),
    };
  });
  if (cash) await cashLegs().settleLegs(ctx, cash);
  return { eventId };
}

/**
 * The account's legs after a deposit or a withdrawal changed, in its transaction (PERS-651), with
 * the side the person chose for the leg of `eventId`; `null` for any other operation.
 */
async function cashLegsOf(
  ctx: WriteCtx,
  trx: Tx,
  parsed: z.output<typeof operationInputSchema>,
  target: { investment: InvestmentAccount; currency: string; eventId: string },
) {
  if (parsed.kind !== "deposit" && parsed.kind !== "withdrawal") return null;
  const { written, legOf } = await writeCashLegs(ctx, trx, target.investment, target.currency);
  const legId = legOf.get(target.eventId);
  if (legId !== undefined && parsed.counterpart !== null) written.choices.set(legId, parsed.counterpart);
  return written;
}

/**
 * A manual event changed (A2): the legs before go to the revisions, the new ones take their place,
 * and the points are rewritten from the older of the two days. Its kind stays; an event a conversion
 * or a provider wrote is not the person's to edit. With `ofAccount`, an event of another service is
 * `not_found` (a route names the service in its path). A day before the portfolio was made moves its
 * start back, as a new operation's does.
 */
export async function updateOperation(
  ctx: WriteCtx,
  eventId: string,
  input: OperationInput,
  ofAccount?: string,
): Promise<void> {
  const parsed = await keepingSide(ctx, eventId, operationInputSchema.parse(input));
  const cash = await rewriteEvent(
    ctx,
    { eventId, ofAccount, kind: parsed.kind, on: parsed.on },
    {
      legsFor: async (edit) => {
        refuseValueChange(edit.investment);
        const { legs, transactionId } = await legsOf(ctx, edit.book, parsed, edit.account);
        return { legs, note: parsed.note, transactionId };
      },
      after: (tx, investment, currency) => cashLegsOf(ctx, tx, parsed, { investment, currency, eventId }),
    },
  );
  if (cash) await cashLegs().settleLegs(ctx, cash);
}

/**
 * The side a deposit's leg has already is no new choice (PERS-695): sent back as «Edit» read it, it
 * leaves the leg's pair alone instead of choosing it again.
 */
async function keepingSide(
  ctx: WriteCtx,
  eventId: string,
  parsed: z.output<typeof operationInputSchema>,
): Promise<z.output<typeof operationInputSchema>> {
  if ((parsed.kind !== "deposit" && parsed.kind !== "withdrawal") || parsed.counterpart === null)
    return parsed;
  const [event] = await getDb()
    .select({ legTransactionId: investmentEvents.legTransactionId })
    .from(investmentEvents)
    .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents)));
  if (!event?.legTransactionId) return parsed;
  const side = await transferSideOf(ctx, event.legTransactionId);
  const chosen = parsed.counterpart;
  const same =
    side?.kind === chosen.kind &&
    (side.kind !== "account" || (chosen.kind === "account" && side.accountId === chosen.accountId));
  return same ? { ...parsed, counterpart: null } : parsed;
}

/**
 * A purchase changed (PERS-683): its day, instrument, quantity, price, fee and note, checked as a new
 * one is. It keeps the instalment of the plan that wrote it; a position nothing refers to any more
 * goes, as after a deletion.
 */
export async function updateBuy(
  ctx: WriteCtx,
  eventId: string,
  input: BuyInput,
  ofAccount?: string,
): Promise<void> {
  const parsed = buyInputSchema.parse(input);
  await rewriteEvent(
    ctx,
    { eventId, ofAccount, kind: "buy", on: parsed.on },
    {
      legsFor: async (edit) => {
        const legs = await buyLegs(ctx, edit.tx, {
          investmentId: edit.investment.id,
          book: edit.book,
          account: edit.account,
          parsed,
          planRunId: edit.before.planRunId,
        });
        return { legs, note: parsed.note, transactionId: null };
      },
      after: async () => null,
    },
  );
}

/**
 * The common steps of an edit, in one transaction: the event found and locked, its legs kept in the
 * revisions and taken away, the new ones `legsFor` builds written, the portfolio checked, its points
 * rewritten, and `after` run last (the account's leg of a deposit).
 */
async function rewriteEvent<T>(
  ctx: WriteCtx,
  edit: { eventId: string; ofAccount?: string; kind: string; on: CivilDate },
  steps: {
    legsFor: (state: {
      tx: Tx;
      investment: InvestmentAccount;
      book: LoadedBook;
      account: { currency: string };
      before: { planRunId: string | null };
    }) => Promise<{ legs: LegInput[]; note: string | null; transactionId: string | null }>;
    after: (tx: Tx, investment: InvestmentAccount, currency: string) => Promise<T>;
  },
): Promise<T> {
  notFuture(ctx, edit.on);
  return getDb().transaction(async (tx) => {
    const { event, accountId } = await requireEvent(ctx, edit.eventId, tx, edit.ofAccount);
    if (event.origin !== "manual") throw new InvestmentError("not_editable");
    const account = await getAccount(ctx, accountId);
    if (!account) throw new InvestmentError("not_found");
    const locked = await lockInvestmentAccount(ctx, accountId, tx);
    const [main] = await tx
      .select({ kind: investmentOperations.kind, planRunId: investmentOperations.planRunId })
      .from(investmentOperations)
      .where(and(eq(investmentOperations.eventId, edit.eventId), eq(investmentOperations.leg, "main")));
    if (!main || main.kind !== edit.kind) throw new InvestmentError("not_editable");
    const investment = await startPortfolioBy(ctx, locked, edit.on, tx);
    await keepRevisions(ctx, tx, event, "edited");
    const removed = await tx
      .delete(investmentOperations)
      .where(and(eq(investmentOperations.eventId, edit.eventId), userScoped(ctx).owns(investmentOperations)))
      .returning({ holdingId: investmentOperations.holdingId });
    const book = await loadBook(ctx, investment, account.currency, tx);
    const { legs, note, transactionId } = await steps.legsFor({
      tx,
      investment,
      book,
      account,
      before: main,
    });
    await translated(
      tx
        .update(investmentEvents)
        .set({ on: edit.on, note, transactionId })
        .where(and(eq(investmentEvents.id, edit.eventId), userScoped(ctx).owns(investmentEvents))),
    );
    await insertLegs(ctx, tx, edit.eventId, legs);
    await dropUnusedHoldings(ctx, tx, removed);
    await checkPortfolio(ctx, investment, account.currency, tx);
    await rebuild(ctx, investment, account.currency, oldestDay(event.on, edit.on) as CivilDate, tx);
    return steps.after(tx, investment, account.currency);
  });
}

/**
 * A manual event deleted, its legs kept in the revisions, the points rewritten from its day. With
 * `ofAccount`, an event of another service is `not_found` (a route names the service in its path).
 */
export async function deleteOperation(ctx: WriteCtx, eventId: string, ofAccount?: string): Promise<void> {
  const cash = await getDb().transaction(async (tx) => {
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
    await dropUnusedHoldings(ctx, tx, legs);
    const currency = await currencyOf(ctx, accountId);
    await checkPortfolio(ctx, investment, currency, tx);
    await rebuild(ctx, investment, currency, event.on, tx);
    // Its leg in the account goes too; the bank's movement waits again (PERS-651).
    return event.legTransactionId === null
      ? null
      : (await writeCashLegs(ctx, tx, investment, currency)).written;
  });
  if (cash) await cashLegs().settleLegs(ctx, cash);
}
