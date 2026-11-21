// What the engine of the P&L takes and gives (docs/design/investments-ux.md §4): a service, its parts, its result.
import { type CivilDate } from "../../../shared/dates";
import { type RateTable } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import { type AdjustmentClass, type Book } from "../rules";
import { type PeriodReturn } from "../../../shared/returns";
import { type PositionAt } from "./positions";
import { type Exit, type TransferRecord } from "./replay";

// ——— Inputs ——————————————————————————————————————————————————————————————————————————————————

/** §4.9: what a correction (R3) stands for; stored on its leg since U3, `data` when unset. */
export type { AdjustmentClass };

/** A window of what a provider's flows cover (`investment_sync_coverage`, kind `flows`), by day. */
export interface CoverageWindow {
  stream: string;
  fromOn: CivilDate;
  /** The day the window ends in; a gap ending in it is closed from that day on. */
  toOn: CivilDate;
  complete: boolean;
}

export interface PnlService {
  accountId: string;
  /** `accounts.currency`: the book's amounts are in it. */
  currency: string;
  book: Book;
  /** The rates the book is valued with (`ratesFor`). */
  rates: RateTable;
  /** The flow windows of a synced service; `null` for a manual one, whose book is every flow. */
  coverage: readonly CoverageWindow[] | null;
  /** The provider's id of each event (eToro `trade:<positionId>:open|close`), by event id. */
  externalIds: ReadonlyMap<string, string>;
  /** The class of each correction, by event id; missing = `data` (§4.9). */
  adjustmentClasses?: ReadonlyMap<string, AdjustmentClass>;
}

/** The display currency and the rates that convert every service into it (§4.5). */
export interface Display {
  currency: string;
  rates: RateTable;
}

// ——— The P&L of a service (§4.1–§4.6) ————————————————————————————————————————————————————————

/** The additive parts of a P&L (§4.2): their sum is `pnlCents`, to the cent. */
export interface PnlParts {
  pnlCents: Cents;
  /** Sales against the period's basis (§4.4), and what is left of a position closed below 1 € (dust). */
  realizedCents: Cents;
  /**
   * The unrealized of the positions open at e against the period's basis (PERS-145): zero when
   * none is open; `null` only where the positions of a day are unknown (then in `unattributedCents`).
   */
  unrealizedChangeCents: Cents | null;
  incomeCents: Cents;
  /** Negative: the fees of the period. */
  feesCents: Cents;
  /** Corrections of class `data` and `result` that started or ended in the period (§4.9). */
  correctionsCents: Cents;
  /** Only in the display currency (§4.5): P&L_D − the parts converted at the rate of the last day. */
  fxCents: Cents;
  /** What no part explains: zero on consistent data (PERS-145), never shown as a part of its own. */
  unattributedCents: Cents;
}

/** `stale`: a price or a rate of the first or the last day is an old one (§4.6). */
export type PnlStatus = "verified" | "stale" | "undetermined";

export type PnlReason =
  /** The value at the start or the end used a saved rate or misses a price. */
  | "stale_price"
  /** The flows are not covered for the whole period: it starts later (`partial`) or not at all. */
  | "flows_gap"
  /** The value before the first day is unknown: the period starts at the first value known. */
  | "base_unknown"
  /** No value on the last day: nothing to measure. */
  | "no_value"
  /** A rate to the display currency is missing. */
  | "no_rate";

/** A flow of the period, signed (in positive), in the account's currency and the display one. */
export interface PeriodFlow {
  on: CivilDate;
  cents: Cents;
  displayCents: Cents | null;
  transferGroupId: string | null;
  /** The currency it was booked in, when the provider converted it (eToro Money in EUR). */
  converted?: string | null;
}

export interface HoldingPnl {
  /** {@link PositionAt.key}: the holding, or the provider's asset and product. */
  key: string;
  holdingId: string | null;
  assetId: string | null;
  product: string | null;
  realizedCents: Cents;
  /** U(e) − U(s⁻) of this position; `null` when its cost is unknown at either end. */
  unrealizedChangeCents: Cents | null;
  /** Realized + the change of the unrealized: what the position added to the period (§4.2). */
  contributionCents: Cents | null;
  /** Open at e (dust left out, PERS-145). */
  open: boolean;
  /** Some of it left in the period: a sale, a close, a coin fee, a transfer out. */
  sold: boolean;
  /** The position at the end of `s⁻` and at the end of `e`; `null` when it was not open then. */
  start: PositionAt | null;
  end: PositionAt | null;
}

export interface ServicePnl {
  accountId: string;
  currency: string;
  status: PnlStatus;
  reasons: PnlReason[];
  /** The days measured, `[from, to]` (§4.6); `from` is `null` when nothing could be. */
  from: CivilDate | null;
  to: CivilDate;
  /** The period measured starts after the one asked: the badge "from <date>". */
  partial: boolean;
  startCents: Cents | null;
  endCents: Cents | null;
  /** The cash beside the positions on the last day (§3.4); `null` when the provider does not say it. */
  endCashCents: Cents | null;
  /** The positions open at e (dust left out): without one, the period has no unrealized (PERS-145). */
  openPositions: number;
  /** In the account's currency, fx zero; `null` when undetermined. */
  local: PnlParts | null;
  /** In the display currency, with the exchange effect (§4.5); `null` when a rate is missing. */
  display: PnlParts | null;
  localReturn: PeriodReturn | null;
  displayReturn: PeriodReturn | null;
  /** V(s⁻) in the display currency, at the rate of its day. */
  displayStartCents: Cents | null;
  /** The average capital of Dietz (§4.3) in the display currency; for the portfolio. */
  displayCapitalCents: number | null;
  flows: PeriodFlow[];
  exits: Exit[];
  transfers: TransferRecord[];
  holdings: HoldingPnl[];
}

/** Below this, an average capital is "almost nothing" (§4.3): 1 €, or 1 % of the gross capital. */
