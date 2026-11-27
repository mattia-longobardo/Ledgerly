// An operation as «Edit» reads it (PERS-695): the values «Record operation» took, so that the same
// values sent back to the edit write the operation again unchanged.
import { and, asc, eq } from "drizzle-orm";
import { getAccount } from "../../accounts";
import { transferSideOf } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { CivilDate } from "../../../shared/dates";
import { type Cents, divRound, parseDecimal } from "../../../shared/money";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { type EventOrigin, type OperationKind, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE } from "../rules";
import { investmentAssets, investmentHoldings, investmentOperations } from "../schema";
import { requireInvestmentAccount } from "./book";
import { rateOf } from "./events";
import { requireEvent } from "./revisions";
import { InvestmentError } from "./types";

/** The kinds the form of «Record operation» writes on a manual portfolio, and so edits. */
const EDITABLE_KINDS: ReadonlySet<OperationKind> = new Set([
  "buy",
  "deposit",
  "withdrawal",
  "fee",
  "valuation",
  "sell",
  "close",
  "income",
]);

/**
 * Whether «Edit» rewrites an event, the rule of the edit: the person's own, on a manual portfolio, of
 * a kind the form writes; a purchase only of an instrument of the registry, the one the form names.
 */
export function isEditable(
  provider: string,
  event: { origin: EventOrigin; kind: OperationKind; instrumentId: string | null },
): boolean {
  return (
    provider === PORTFOLIO_PROVIDER &&
    event.origin === "manual" &&
    EDITABLE_KINDS.has(event.kind) &&
    (event.kind !== "buy" || event.instrumentId !== null)
  );
}

type Side = Awaited<ReturnType<typeof transferSideOf>>;

export type OperationForEdit = { on: CivilDate; note: string | null } & (
  | {
      kind: "buy";
      instrumentId: string;
      mic: string | null;
      quantity: bigint | null;
      unitPrice: bigint | null;
      totalCents: Cents | null;
      feeCents: Cents;
      fxRate: bigint | null;
    }
  | {
      kind: "deposit" | "withdrawal";
      amountCents: Cents;
      transactionId: string | null;
      counterpart: Side;
    }
  | { kind: "fee"; amountCents: Cents }
  | { kind: "income"; holdingId: string | null; amountCents: Cents }
  | { kind: "valuation"; holdingId: string; unitPrice: bigint | null; amountCents: Cents | null }
  | {
      kind: "sell" | "close";
      holdingId: string;
      quantity: bigint | null;
      unitPrice: bigint | null;
      amountCents: Cents | null;
      feeCents: Cents;
    }
);

const fixed = (value: string | null, scale: number) => (value === null ? null : parseDecimal(value, scale));

/**
 * The amount typed in the asset's currency that `inAccount` turned into `cents` of the account's.
 * The rate rounds, so the guess is checked against it and its neighbours.
 */
function typedOf(cents: Cents, rate: Awaited<ReturnType<typeof rateOf>>): Cents {
  if (rate.fxRate === null) return cents;
  const guess = divRound(cents * 10n ** BigInt(RATE_SCALE), rate.fxRate);
  for (const step of [0n, -1n, 1n, -2n, 2n]) if (rate.inAccount(guess + step) === cents) return guess + step;
  return guess;
}

type Leg = typeof investmentOperations.$inferSelect;
type Asset = typeof investmentAssets.$inferSelect;
type EventRow = Awaited<ReturnType<typeof requireEvent>>["event"];

/** A deposit, a withdrawal, a fee or an income: amounts in the account's currency, as typed. */
async function cashForm(
  ctx: Pick<Ctx, "userId">,
  event: EventRow,
  leg: Leg,
): Promise<OperationForEdit | null> {
  const base = { on: event.on, note: event.note };
  switch (leg.kind) {
    case "deposit":
    case "withdrawal":
      return {
        ...base,
        kind: leg.kind,
        amountCents: leg.amountCents < 0n ? -leg.amountCents : leg.amountCents,
        transactionId: event.transactionId,
        counterpart:
          event.transactionId === null && event.legTransactionId !== null
            ? await transferSideOf(ctx, event.legTransactionId)
            : null,
      };
    case "fee":
      return { ...base, kind: "fee", amountCents: -leg.amountCents };
    case "income":
      return { ...base, kind: "income", holdingId: leg.holdingId, amountCents: leg.amountCents };
    default:
      return null;
  }
}

/** A purchase, a sale, a close or a valuation: amounts typed in the asset's currency (`legsOf`, `buyLegs`). */
async function positionForm(
  event: EventRow,
  leg: Leg,
  asset: Asset,
  fee: { feeCents: Cents; currency: string },
): Promise<OperationForEdit> {
  const base = { on: event.on, note: event.note, holdingId: leg.holdingId! };
  const quantity = fixed(leg.quantity, QUANTITY_SCALE);
  const unitPrice = fixed(leg.unitPrice, PRICE_SCALE);
  const typedRate = leg.kind === "buy" && leg.fxSource === "manual" ? fixed(leg.fxRate, RATE_SCALE) : null;
  const rate = await rateOf(asset.currency, fee.currency, event.on, typedRate);
  const feeCents = typedOf(fee.feeCents, rate);
  const amountCents = unitPrice === null ? typedOf(leg.amountCents, rate) : null;
  if (leg.kind === "valuation") return { ...base, kind: "valuation", unitPrice, amountCents };
  if (leg.kind === "sell" || leg.kind === "close")
    return { ...base, kind: leg.kind, quantity, unitPrice, amountCents, feeCents };
  const native = fixed(leg.nativeAmount, PRICE_SCALE);
  return {
    on: event.on,
    note: event.note,
    kind: "buy",
    instrumentId: asset.instrumentId!,
    mic: asset.mic,
    quantity,
    unitPrice,
    totalCents: quantity === null && native !== null ? native / 10n ** BigInt(PRICE_SCALE - 2) : null,
    feeCents,
    fxRate: typedRate,
  };
}

/**
 * The operation of a manual portfolio as «Edit» shows it: `not_found` for another service's or none,
 * `not_editable` where the edit refuses it ({@link isEditable}).
 */
export async function readOperation(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  eventId: string,
): Promise<OperationForEdit> {
  const { event } = await requireEvent(ctx, eventId, getDb(), accountId);
  const [investment, account] = await Promise.all([
    requireInvestmentAccount(ctx, accountId),
    getAccount(ctx, accountId),
  ]);
  if (!account) throw new InvestmentError("not_found");
  const legs = await getDb()
    .select({ op: investmentOperations, asset: investmentAssets })
    .from(investmentOperations)
    .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
    .leftJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
    .where(and(eq(investmentOperations.eventId, eventId), userScoped(ctx).owns(investmentOperations)))
    .orderBy(asc(investmentOperations.leg));
  const main = legs.find((one) => one.op.leg === "main");
  const editable =
    main !== undefined &&
    isEditable(investment.provider, {
      origin: event.origin,
      kind: main.op.kind,
      instrumentId: main.asset?.instrumentId ?? null,
    });
  if (!editable) throw new InvestmentError("not_editable");
  const cash = await cashForm(ctx, event, main.op);
  if (cash !== null) return cash;
  const { asset } = main;
  if (asset === null) throw new InvestmentError("not_editable");
  const feeCents = -(legs.find((one) => one.op.leg === "fee")?.op.amountCents ?? 0n);
  return positionForm(event, main.op, asset, { feeCents, currency: account.currency });
}
