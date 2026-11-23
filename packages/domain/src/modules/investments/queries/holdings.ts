// The positions of a service today (§4.3), and the rows of its page.
import { type Account } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate } from "../../../shared/dates";
import { type Cents } from "../../../shared/money";
import {
  type AdjustmentClass,
  type DayValue,
  type HoldingState,
  holdingStates,
  type Mode,
  type AccountOrigin,
  PRICE_SCALE,
  QUANTITY_SCALE,
} from "../rules";
import { formatDecimal, parseDecimal } from "../../../shared/money";
import {
  type AssetPrice,
  assetPrices,
  type InvestmentAsset,
  type InvestmentPeriod,
  type InvestmentReading,
  listAssets,
} from "../service";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { type SyncStatus } from "../sync";
import { readingPositionsOf } from "./home";
import { type InvestmentsSnapshot, type Loaded, servicesOf, snapshotOf } from "./snapshot";
import { type ServiceSummary } from "./summary";

// ——— Service page (§4.3) ———————————————————————————————————————————————————————————————————

export interface HoldingRow {
  id: string;
  asset: InvestmentAsset;
  origin: "manual" | "provider";
  product: string;
  state: HoldingState;
  quantityText: string | null;
  priceText: string | null;
  weight: number | null;
  gainCents: Cents | null;
  conflict: boolean;
}

export interface OperationLeg {
  id: string;
  holdingId: string | null;
  leg: string;
  kind: string;
  holdingName: string | null;
  quantityText: string | null;
  priceText: string | null;
  priceCurrency: string | null;
  amountCents: Cents;
  validUntil: CivilDate | null;
  fxSource: string | null;
}

export interface OperationRow {
  id: string;
  on: CivilDate;
  origin: string;
  note: string | null;
  kind: string;
  legs: OperationLeg[];
  linked: { payee: string | null; on: CivilDate; cents: Cents } | null;
  transactionId: string | null;
  revisions: number;
  /** The other service of a transfer between the person's accounts (§2.4), if this is one leg. */
  transfer: { accountId: string; accountName: string } | null;
}

/** A transfer the UI proposes to link (§2.4): this account's leg and the other service's. */
export interface TransferProposalRow {
  withdrawalId: string;
  depositId: string;
  /** Whether the money leaves this account (`out`) or comes in (`in`). */
  direction: "in" | "out";
  on: CivilDate;
  amountCents: Cents;
  other: { accountId: string; accountName: string; on: CivilDate };
}

export interface ServiceDetail {
  summary: ServiceSummary;
  currency: string;
  day: DayValue;
  periods: { fromOn: CivilDate; mode: Mode; origin: AccountOrigin; reason: InvestmentPeriod["reason"] }[];
  holdings: HoldingRow[];
  operations: OperationRow[];
  readings: {
    id: string;
    on: CivilDate;
    status: InvestmentReading["status"];
    totalCents: Cents;
    products: string[];
    /** Products the reading saw but did not read (B4, E2): its value leaves them out. */
    unread: string[];
    missingPrices: number;
  }[];
  /** The rebuilt history (PERS-100, PERS-145): how many reconstructed readings, from when to when. */
  reconstructedReadings: { count: number; from: CivilDate; to: CivilDate } | null;
  /** The first reading the provider really gave. */
  firstReadOn: CivilDate | null;
  adjustments: {
    eventId: string;
    on: CivilDate;
    amountCents: Cents;
    validUntil: CivilDate | null;
    note: string | null;
    stale: boolean;
    adjustmentClass: AdjustmentClass | null;
  }[];
  /** The connection, its key and what its flows cover (§4.3, §5.3); `null` for a manual service. */
  sync: SyncStatus | null;
  /** Products the provider's latest reading covers: a manual position there would conflict (R4). */
  coveredProducts: string[];
  assets: InvestmentAsset[];
  linkOptions: { out: LinkOption[]; in: LinkOption[] };
  transferProposals: TransferProposalRow[];
}

export interface LinkOption {
  id: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

/**
 * The open positions of a service on `todayOn` (§4.3): the manual ones from the engine and, for a
 * synced account, the provider's from its latest reading — never rebuilt from its trades (A6).
 */
export async function holdingsOf(
  ctx: Pick<Ctx, "userId">,
  one: Loaded,
  todayOn: CivilDate,
): Promise<HoldingRow[]> {
  const states = holdingStates(one.book, todayOn, one.rates);
  const conflicted = new Set(one.day.conflicts.map((conflict) => conflict.holdingId));
  const assetsValue = [...states.values()].reduce<Cents>(
    (sum, state) => sum + (state.open && state.valueCents !== null ? state.valueCents : 0n),
    0n,
  );
  const syncedNow = one.day.origin === "synced";
  const holdings: HoldingRow[] = one.book.holdingRows.flatMap((holding) => {
    const state = states.get(holding.id);
    if (!state?.open) return [];
    // A synced account's provider positions are the reading's, never rebuilt from its trades (A6).
    if (syncedNow && holding.origin === "provider") return [];
    return [
      {
        id: holding.id,
        asset: holding.asset,
        origin: holding.origin,
        product: holding.product,
        state,
        quantityText: state.quantity === null ? null : formatDecimal(state.quantity, QUANTITY_SCALE),
        priceText: state.unitPrice === null ? null : formatDecimal(state.unitPrice, PRICE_SCALE),
        weight:
          state.valueCents === null || assetsValue <= 0n
            ? null
            : Number(state.valueCents) / Number(assetsValue),
        gainCents: state.valueCents === null ? null : state.valueCents - state.costCents,
        conflict: conflicted.has(holding.id),
      },
    ];
  });

  if (syncedNow) {
    const reading = [...one.book.readingRows]
      .filter((row) => row.on <= todayOn && row.status !== "pending_zero")
      .at(-1);
    const positions = reading ? await readingPositionsOf(ctx, reading.id) : [];
    const catalog = new Map((await listAssets(ctx)).map((asset) => [asset.id, asset]));
    const total = positions.reduce<Cents>((sum, position) => sum + (position.valueCents ?? 0n), 0n);
    for (const position of positions) {
      const asset = catalog.get(position.assetId);
      if (!asset || reading === undefined) continue;
      const quantity = position.quantity === null ? null : parseDecimal(position.quantity, QUANTITY_SCALE);
      holdings.push({
        id: position.id,
        asset,
        origin: "provider",
        product: position.product,
        state: {
          holdingId: position.id,
          quantity,
          unitPrice: position.price === null ? null : parseDecimal(position.price, PRICE_SCALE),
          priceCurrency: position.priceCurrency,
          pricedOn: reading.on,
          valueCents: position.valueCents,
          costCents: 0n,
          fxEffectCents: 0n,
          staleRate: false,
          open: true,
        },
        quantityText: quantity === null ? null : formatDecimal(quantity, QUANTITY_SCALE),
        priceText: position.price === null ? null : trimmed(position.price),
        weight:
          position.valueCents === null || total <= 0n ? null : Number(position.valueCents) / Number(total),
        gainCents: null,
        conflict: false,
      });
    }
  }

  return holdings;
}

/** The positions of one service, for `get_investment_holdings` and `/api/v1/investments/{id}/holdings`. */
export async function serviceHoldings(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  source: Date | InvestmentsSnapshot = new Date(),
): Promise<{
  account: Account;
  currency: string;
  on: CivilDate;
  holdings: HoldingRow[];
  /** A manual portfolio's cash today (R5d); null for another service. */
  cashCents: Cents | null;
  /** The price state of each asset of the rows, by asset id. */
  prices: Map<string, AssetPrice>;
} | null> {
  const snapshot = await snapshotOf(ctx, source, accountId);
  const { todayOn } = snapshot;
  const one = servicesOf(snapshot, accountId)[0];
  if (!one) return null;
  const holdings = await holdingsOf(ctx, one, todayOn);
  const pricedOn = new Map(holdings.map((row) => [row.asset.id, row.state.pricedOn]));
  return {
    account: one.account,
    currency: one.account.currency,
    on: todayOn,
    holdings,
    cashCents: one.investment.provider === PORTFOLIO_PROVIDER ? one.day.cashCents : null,
    prices: await assetPrices(
      holdings.map((row) => row.asset),
      todayOn,
      pricedOn,
    ),
  };
}

/** A `numeric` as text without its trailing zeros: "0.500000000000000000" → "0.5". */
export function trimmed(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}
