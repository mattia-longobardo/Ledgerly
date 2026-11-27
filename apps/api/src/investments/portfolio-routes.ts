// Investments · the routes of the manual portfolio (rewrite plan R5d): the search of the registry, a
// purchase and the money in and out of a portfolio, the price mode of a holding, «Switch to positions».
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS } from "@ledgerly/api-contract";
import { searchInstruments } from "@ledgerly/domain/instruments";
import {
  addAsset,
  convertToPortfolio,
  isPortfolio,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  recordOperation,
  setPriceMode,
  updateBuy,
  updateOperation,
} from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { pricesPlugin } from "@ledgerly/domain/platform/plugins";
import { parseCents, parseDecimal } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { cents, decimal, refusing } from "./refusals";

const { register, instruments } = INVESTMENTS;

type OperationBody = z.output<typeof register.recordOperation.body>;
type BuyBody = Extract<OperationBody, { kind: "buy" }>;
type MoneyBody = Extract<OperationBody, { kind: "deposit" | "withdrawal" }>;

/** The money in and out of the account a service reads or a provider writes: not the person's to type. */
const NOT_TYPED = new Set(["account_valuation", "adjustment"]);
const PORTFOLIO_ONLY = new Set(["buy", "deposit", "withdrawal", "fee"]);

function buyOf(body: BuyBody) {
  const quantity = decimal(body.quantity, QUANTITY_SCALE);
  return {
    asset: { instrument: { instrumentId: body.instrumentId, mic: body.mic } },
    on: body.on,
    quantity,
    unitPrice: quantity === null ? null : decimal(body.unitPrice, PRICE_SCALE),
    totalCents: quantity === null ? cents(body.amount) : null,
    feeCents: cents(body.fee) ?? 0n,
    fxRate: decimal(body.fxRate, RATE_SCALE),
    note: body.note,
  };
}

function moneyOf(body: MoneyBody) {
  if (body.on === undefined || body.amount === undefined) throw new ApiRefusal("invalid");
  return {
    kind: body.kind,
    on: body.on,
    amountCents: parseCents(body.amount),
    transactionId: body.transactionId ?? null,
    counterpart: body.counterpart ?? null,
    note: body.note ?? null,
  };
}

/**
 * «Record operation» (R5d): a purchase of an instrument and the money in and out of a manual
 * portfolio here; every other kind goes to `other`. On a service that is not a portfolio, a purchase
 * and the money in and out are not the person's to write.
 */
export async function writeOperation(
  ctx: Ctx,
  accountId: string,
  body: OperationBody,
  other: (body: OperationBody) => Promise<{ eventId: string }>,
): Promise<{ eventId: string }> {
  if (NOT_TYPED.has(body.kind)) throw new ApiRefusal("conflict", "not_editable");
  if (!PORTFOLIO_ONLY.has(body.kind)) return other(body);
  if (!(await isPortfolio(ctx, accountId))) throw new ApiRefusal("conflict", "not_editable");
  if (body.kind === "buy") return addAsset(ctx, accountId, buyOf(body));
  if (body.kind === "deposit" || body.kind === "withdrawal")
    return recordOperation(ctx, accountId, moneyOf(body));
  if (body.kind === "fee") {
    return recordOperation(ctx, accountId, {
      kind: "fee",
      on: body.on,
      amountCents: parseCents(body.amount),
      note: body.note,
    });
  }
  return other(body);
}

/** An operation as the domain takes it: a price wins over an amount, as the form's (`operationOf`). */
export function operationInput(body: OperationBody) {
  switch (body.kind) {
    case "valuation": {
      const unitPrice = decimal(body.unitPrice, PRICE_SCALE);
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        unitPrice,
        amountCents: unitPrice === null ? cents(body.amount) : null,
        note: body.note,
      };
    }
    case "sell":
    case "close": {
      const quantity = decimal(body.quantity, QUANTITY_SCALE);
      const unitPrice = decimal(body.unitPrice, PRICE_SCALE);
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        quantity,
        unitPrice: quantity === null ? null : unitPrice,
        amountCents: quantity === null || unitPrice === null ? cents(body.amount) : null,
        feeCents: cents(body.fee) ?? 0n,
        note: body.note,
      };
    }
    case "income":
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        amountCents: parseCents(body.amount),
        note: body.note,
      };
    default:
      throw new ApiRefusal("conflict", "not_editable");
  }
}

/**
 * «Edit» of an operation (PERS-683): only on a manual portfolio — a provider's service is the
 * provider's to write — and with the checks of a new one.
 */
async function editOperation(
  ctx: Ctx,
  where: { accountId: string; eventId: string },
  body: OperationBody,
): Promise<void> {
  const { accountId, eventId } = where;
  if (NOT_TYPED.has(body.kind) || !(await isPortfolio(ctx, accountId)))
    throw new ApiRefusal("conflict", "not_editable");
  if (body.kind === "buy") return updateBuy(ctx, eventId, buyOf(body), accountId);
  if (body.kind === "deposit" || body.kind === "withdrawal")
    return updateOperation(ctx, eventId, moneyOf(body), accountId);
  if (body.kind === "fee") {
    return updateOperation(
      ctx,
      eventId,
      { kind: "fee", on: body.on, amountCents: parseCents(body.amount), note: body.note },
      accountId,
    );
  }
  return updateOperation(ctx, eventId, operationInput(body), accountId);
}

export function servePortfolio(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, instruments.searchInstruments, async ({ query }) => {
    // A new market is read by the instance's prices plugin, when it has one.
    const plugin = await pricesPlugin();
    const found = await searchInstruments(query.q, { priceSourceId: plugin?.config.id ?? null });
    return {
      items: found.items.map(({ listings, ...instrument }) => ({
        ...instrument,
        listings: listings.map(({ mic, ticker, currency, priced }) => ({ mic, ticker, currency, priced })),
      })),
      complete: found.complete,
    };
  });
  serve(app, guard, register.updateOperation, async ({ ctx, params, body }) => {
    await refusing(() => editOperation(ctx, params, body));
  });
  serve(app, guard, register.setPriceMode, async ({ ctx, params, body }) => {
    await refusing(() => setPriceMode(ctx, params.accountId, params.holdingId, body.mode));
  });
  serve(app, guard, register.convertToPortfolio, async ({ ctx, params, body }) => {
    await refusing(() =>
      convertToPortfolio(ctx, params.accountId, {
        on: body.on,
        note: body.note,
        positions: body.positions.map((position) => ({
          instrumentId: position.instrumentId,
          mic: position.mic,
          quantity: parseDecimal(position.quantity, QUANTITY_SCALE),
          unitPrice: parseDecimal(position.unitPrice, PRICE_SCALE),
          fxRate: decimal(position.fxRate, RATE_SCALE),
        })),
      }),
    );
  });
}
