// Investments · the routes of the manual portfolio (rewrite plan R5d): the search of the registry, a
// purchase and the money in and out of a portfolio, the price mode of a holding, «Switch to positions».
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS } from "@ledgerly/api-contract";
import { searchInstruments } from "@ledgerly/domain/instruments";
import {
  addAsset,
  convertToPortfolio,
  hasUnpricedMarket,
  isPortfolio,
  type OperationForEdit,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  readOperation,
  recordOperation,
  setPriceMode,
  updateBuy,
  updateOperation,
} from "@ledgerly/domain/investments";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { pricesPlugin } from "@ledgerly/domain/platform/plugins";
import { formatDecimal, parseCents, parseDecimal } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { maybe, money } from "./dto";
import { cents, decimal, refusing } from "./refusals";

const { register, instruments } = INVESTMENTS;

/** The queue the routes put the first read of a market in (`InvestmentCases.queuePrices`). */
interface PricesQueue {
  queuePrices(ctx: Ctx): Promise<void>;
}

type OperationBody = z.output<typeof register.recordOperation.body>;
type BuyBody = Extract<OperationBody, { kind: "buy" }>;
type MoneyBody = Extract<OperationBody, { kind: "deposit" | "withdrawal" }>;
type ReadBody = z.input<typeof register.getOperation.response>["body"];

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

const plain = (value: bigint | null, scale: number) => (value === null ? null : formatDecimal(value, scale));

/** The body of the edit an operation is (PERS-695): what `editOperation` takes back unchanged. */
function bodyOf(found: OperationForEdit): ReadBody {
  const { on, note } = found;
  switch (found.kind) {
    case "buy":
      return {
        kind: "buy",
        instrumentId: found.instrumentId,
        mic: found.mic,
        on,
        quantity: plain(found.quantity, QUANTITY_SCALE),
        unitPrice: plain(found.unitPrice, PRICE_SCALE),
        amount: maybe(found.totalCents),
        fee: found.feeCents === 0n ? null : money(found.feeCents),
        fxRate: plain(found.fxRate, RATE_SCALE),
        note,
      };
    case "deposit":
    case "withdrawal":
      return {
        kind: found.kind,
        on,
        amount: money(found.amountCents),
        transactionId: found.transactionId,
        counterpart: found.counterpart,
        note,
      };
    case "fee":
      return { kind: "fee", on, amount: money(found.amountCents), note };
    case "income":
      return { kind: "income", holdingId: found.holdingId, on, amount: money(found.amountCents), note };
    case "valuation":
      return {
        kind: "valuation",
        holdingId: found.holdingId,
        on,
        unitPrice: plain(found.unitPrice, PRICE_SCALE),
        amount: maybe(found.amountCents),
        note,
      };
    default:
      return {
        kind: found.kind,
        holdingId: found.holdingId,
        on,
        quantity: plain(found.quantity, QUANTITY_SCALE),
        unitPrice: plain(found.unitPrice, PRICE_SCALE),
        amount: maybe(found.amountCents),
        fee: found.feeCents === 0n ? null : money(found.feeCents),
        note,
      };
  }
}

/**
 * After a purchase, an edit or «Switch to positions»: a market with no close yet is read now, not at
 * the daily job (PERS-694). The operation is already written: a failure here waits for that job.
 */
export async function readNewMarkets(ctx: Ctx, accountId: string, cases: PricesQueue): Promise<void> {
  try {
    if (await hasUnpricedMarket(ctx, accountId)) await cases.queuePrices(ctx);
  } catch (error) {
    console.error("[api] the first read of a market was not queued", redactForLog(error));
  }
}

export function servePortfolio(app: Hono<ApiEnv>, guard: Guard, cases: PricesQueue): void {
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
  serve(app, guard, register.getOperation, async ({ ctx, params }) => {
    const found = await refusing(() => readOperation(ctx, params.accountId, params.eventId));
    return { kind: found.kind, body: bodyOf(found) };
  });
  serve(app, guard, register.updateOperation, async ({ ctx, params, body }) => {
    await refusing(() => editOperation(ctx, params, body));
    if (body.kind === "buy") await readNewMarkets(ctx, params.accountId, cases);
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
    await readNewMarkets(ctx, params.accountId, cases);
  });
}
