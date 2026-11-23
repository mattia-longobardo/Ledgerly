// Writing events (§1.5): an event and its legs, the rate of a leg, a buy that adds an asset.
import { z } from "zod";
import { getAccount } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { convertCents, crossRate } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import type { Cents } from "../../../shared/money";
import {
  type AdjustmentClass,
  atRate,
  type EventOrigin,
  type Leg,
  type OperationKind,
  PRICE_SCALE,
  PRODUCT_PATTERN,
  positionCents,
  QUANTITY_SCALE,
  RATE_SCALE,
} from "../rules";
import { investmentEvents, investmentOperations } from "../schema";
import { civilDate } from "../../../shared/inputs";
import { checkPortfolio } from "./guards";
import { assetInputSchema, assetOfInstrument, createAsset, holdingFor, requireAsset } from "./assets";
import { loadBook, type LoadedBook, lockInvestmentAccount, rebuild } from "./book";
import {
  decimal,
  InvestmentError,
  type InvestmentEvent,
  type InvestmentPeriod,
  notFuture,
  translated,
  type WriteCtx,
} from "./types";

// ——— Events ———————————————————————————————————————————————————————————————————————————————

export interface LegInput {
  leg: Leg;
  kind: OperationKind;
  holdingId?: string | null;
  quantity?: bigint | null;
  unitPrice?: bigint | null;
  priceCurrency?: string | null;
  nativeAmount?: bigint | null;
  nativeCurrency?: string | null;
  fxRate?: bigint | null;
  fxSource?: string | null;
  amountCents: Cents;
  validUntil?: CivilDate | null;
  /** `inferred` for the opening a provider's history implies (A6); `reported` otherwise. */
  quantityBasis?: "reported" | "reconstructed" | "inferred";
  /** A correction's class (§4.9 of the UX design); only on an `adjustment`. */
  adjustmentClass?: AdjustmentClass | null;
  /** The instalment of a purchase plan the purchase is (R5d); only on its `buy`. */
  planRunId?: string | null;
}

export async function insertEvent(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  investmentAccountId: string,
  input: {
    on: CivilDate;
    occurredAt: Date;
    origin: EventOrigin;
    note?: string | null;
    transactionId?: string | null;
    legs: readonly LegInput[];
  },
): Promise<InvestmentEvent> {
  const [event] = await translated(
    tx
      .insert(investmentEvents)
      .values(
        userScoped(ctx).stamp({
          investmentAccountId,
          on: input.on,
          occurredAt: input.occurredAt,
          origin: input.origin,
          note: input.note ?? null,
          transactionId: input.transactionId ?? null,
        }),
      )
      .returning(),
  );
  await insertLegs(ctx, tx, event.id, input.legs);
  return event;
}

export async function insertLegs(
  ctx: Pick<Ctx, "userId">,
  tx: Tx,
  eventId: string,
  legs: readonly LegInput[],
) {
  if (legs.length === 0) return;
  await tx
    .insert(investmentOperations)
    .values(legs.map((leg) => userScoped(ctx).stamp({ eventId, ...legColumns(leg) })));
}

/** The columns of a leg: what it moves, and what qualifies it. */
function legColumns(leg: LegInput) {
  return {
    leg: leg.leg,
    kind: leg.kind,
    holdingId: leg.holdingId ?? null,
    amountCents: leg.amountCents,
    ...legNumbers(leg),
    validUntil: leg.validUntil ?? null,
    quantityBasis: leg.quantityBasis ?? "reported",
    adjustmentClass: leg.adjustmentClass ?? null,
    planRunId: leg.planRunId ?? null,
  };
}

/** The fixed-point numbers of a leg as `numeric` text, and their currencies. */
function legNumbers(leg: LegInput) {
  return {
    quantity: decimal(leg.quantity ?? null, QUANTITY_SCALE),
    unitPrice: decimal(leg.unitPrice ?? null, PRICE_SCALE),
    priceCurrency: leg.priceCurrency ?? null,
    nativeAmount: decimal(leg.nativeAmount ?? null, PRICE_SCALE),
    nativeCurrency: leg.nativeCurrency ?? null,
    fxRate: decimal(leg.fxRate ?? null, RATE_SCALE),
    fxSource: leg.fxSource ?? null,
  };
}

/** The period in force at the end of `on` (the book's), or `null` before the first one. */
export function periodOn(book: LoadedBook, on: CivilDate): InvestmentPeriod | null {
  let found: InvestmentPeriod | null = null;
  for (const period of book.periodRows) if (period.fromOn <= on) found = period;
  return found;
}

interface Rate {
  fxRate: bigint | null;
  fxSource: string | null;
  /** A price typed in the asset's currency, in cents of the account's (rounded once). */
  inAccount: (cents: Cents) => Cents;
}

/**
 * The rate from an asset's quote currency to the account's on a day (§1.8): the one typed, or the
 * ECB one, saved with its source on the operation (A5). `null` when neither exists. At the ECB rate
 * an amount is fx's `convertCents`, the conversion of every screen (audit PLT-1, D11).
 */
export async function rateOf(from: string, to: string, on: CivilDate, typed: bigint | null): Promise<Rate> {
  const none: Rate = { fxRate: null, fxSource: null, inAccount: (cents) => cents };
  if (from === to) return none;
  if (typed !== null)
    return { fxRate: typed, fxSource: "manual", inAccount: (cents) => atRate(cents, typed) };
  const rates = await ratesOn([from, to], on, on);
  const fxRate = crossRate(rates, from, to, on);
  if (fxRate === null) return none;
  return {
    fxRate,
    fxSource: `ecb:${on}`,
    inAccount: (cents) => convertCents(cents, from, to, on, rates)!,
  };
}

export const optionalNote = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

export const positive = z.bigint().positive();

export const buyInputSchema = z.object({
  asset: z.union([
    z.object({ id: z.uuid() }),
    z.object({ create: assetInputSchema }),
    // An instrument of the registry on the market of the order (R5d).
    z.object({
      instrument: z.object({
        instrumentId: z.uuid(),
        mic: z
          .string()
          .regex(/^[A-Z0-9]{4}$/)
          .nullable(),
      }),
    }),
  ]),
  product: z.string().regex(new RegExp(PRODUCT_PATTERN)).default("custody"),
  on: civilDate(),
  /** Quantity and unit price, or only the total (a BTP, a fund bought for an amount, A3). */
  quantity: positive.nullable().default(null),
  unitPrice: z.bigint().nonnegative().nullable().default(null),
  /** The total in the asset's currency, when no quantity is typed. */
  totalCents: positive.nullable().default(null),
  feeCents: z.bigint().nonnegative().default(0n),
  fxRate: positive.nullable().default(null),
  note: optionalNote,
});
export type BuyInput = z.input<typeof buyInputSchema>;

/**
 * "Add asset" (§4.4): a `buy` event with its legs — the position, and the fee as its own leg — and
 * the points rewritten from its day. Only where the period of that day keeps assets.
 */
export async function addAsset(
  ctx: WriteCtx,
  accountId: string,
  input: BuyInput,
): Promise<{ eventId: string }> {
  const parsed = buyInputSchema.parse(input);
  const account = await getAccount(ctx, accountId);
  if (!account) throw new InvestmentError("not_found");
  return getDb().transaction(async (tx) => buyWithin(ctx, tx, { account, input: parsed }));
}

/** The asset a purchase names: one of the person's, a new one, or one of the registry (R5d). */
function assetOf(ctx: WriteCtx, tx: Tx, asset: z.output<typeof buyInputSchema>["asset"]) {
  if ("id" in asset) return requireAsset(ctx, asset.id, tx);
  if ("create" in asset) return createAsset(ctx, asset.create, tx);
  return assetOfInstrument(ctx, asset.instrument, tx);
}

/**
 * A purchase inside the caller's transaction (R5d): the instalment of a plan is written with its state,
 * or not at all. `planRunId` ties the purchase to its due date; a second one for it breaks the unique key.
 */
export async function buyWithin(
  ctx: WriteCtx,
  tx: Tx,
  buy: {
    account: { id: string; currency: string };
    input: z.output<typeof buyInputSchema>;
    planRunId?: string | null;
  },
): Promise<{ eventId: string }> {
  const { account, input: parsed } = buy;
  const planRunId = buy.planRunId ?? null;
  notFuture(ctx, parsed.on);
  if (parsed.quantity === null ? parsed.totalCents === null : parsed.unitPrice === null) {
    throw new RangeError("A buy needs a quantity and a price, or a total");
  }
  const investment = await lockInvestmentAccount(ctx, account.id, tx);
  const book = await loadBook(ctx, investment, account.currency, tx);
  const period = periodOn(book, parsed.on);
  if (period === null) throw new InvestmentError("before_period");
  if (period.mode !== "assets") throw new InvestmentError("wrong_mode");
  const asset = await assetOf(ctx, tx, parsed.asset);
  const holding = await holdingFor(ctx, tx, investment.id, asset.id, parsed.product, parsed.on);
  const rate = await rateOf(asset.currency, account.currency, parsed.on, parsed.fxRate);
  const native =
    parsed.quantity !== null && parsed.unitPrice !== null
      ? positionCents(parsed.quantity, parsed.unitPrice)
      : (parsed.totalCents ?? 0n);
  const legs: LegInput[] = [
    {
      leg: "main",
      kind: "buy",
      holdingId: holding.id,
      quantity: parsed.quantity,
      unitPrice: parsed.quantity === null ? null : parsed.unitPrice,
      priceCurrency: asset.currency,
      nativeAmount: native * 10n ** BigInt(PRICE_SCALE - 2),
      nativeCurrency: asset.currency,
      fxRate: rate.fxRate,
      fxSource: rate.fxSource,
      amountCents: -rate.inAccount(native),
      planRunId,
    },
  ];
  if (parsed.feeCents > 0n)
    legs.push({ leg: "fee", kind: "fee", amountCents: -rate.inAccount(parsed.feeCents) });
  const event = await insertEvent(ctx, tx, investment.id, {
    on: parsed.on,
    occurredAt: new Date(),
    origin: "manual",
    note: parsed.note,
    legs,
  });
  await checkPortfolio(ctx, investment, account.currency, tx);
  await rebuild(ctx, investment, account.currency, parsed.on, tx);
  return { eventId: event.id };
}
