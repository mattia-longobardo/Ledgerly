// src/modules/investments/positions.ts — the rows of the Positions tab (docs/design/investments-ux.md
// §3.4, U4): what each position added to the period, the open ones and the sold ones together, and
// the closes grouped by position. Pure: it reads what `pnl.ts` measured and adds nothing to it, so the
// rows close on the service's P&L to the cent (PERS-113 · 1, 4, 5, 9).
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import type { Exit, HoldingPnl, ServicePnl } from "./pnl";

const abs = (value: bigint) => (value < 0n ? -value : value);

export interface ContributionRow {
  key: string;
  holdingId: string | null;
  assetId: string | null;
  product: string | null;
  /** Realized + the change of the unrealized; the realized only while the cost is unknown. */
  cents: Cents;
  realizedCents: Cents;
  unrealizedChangeCents: Cents | null;
  /** Open on the period's last day. */
  open: boolean;
  /** Some of it left in the period: a sale, a close, a coin fee, a transfer out. */
  sold: boolean;
  /** The positions of a day are unknown, so is its unrealized (a day of history with a total only). */
  costUnknown: boolean;
  /** The divergent bar (§4.8): −1…1, scaled on the largest |cents| of the rows. */
  bar: number;
}

export interface Contributions {
  rows: ContributionRow[];
  incomeCents: Cents;
  feesCents: Cents;
  correctionsCents: Cents;
  /** The change of value a service kept by value only has without positions (§4.2). */
  valueChangeCents: Cents;
  /** What no part explains: zero on consistent data (PERS-145). */
  unattributedCents: Cents;
  /** Σ rows + the parts above: the service's P&L in its own currency, the Overview's number. */
  totalCents: Cents;
}

/**
 * What each position added to the period (PERS-113 · 9), the largest first, and the parts that are
 * not a position's — income, fees, corrections, the change of a value without positions — so that
 * the rows add up to the service's P&L in its currency. `null` when it is undetermined.
 */
export function contributionsOf(service: ServicePnl): Contributions | null {
  const local = service.local;
  if (local === null) return null;
  const rows = service.holdings
    .map((one: HoldingPnl) => ({
      key: one.key,
      holdingId: one.holdingId,
      assetId: one.assetId,
      product: one.product,
      cents: one.realizedCents + (one.unrealizedChangeCents ?? 0n),
      realizedCents: one.realizedCents,
      unrealizedChangeCents: one.unrealizedChangeCents,
      open: one.open,
      sold: one.sold,
      costUnknown: one.unrealizedChangeCents === null && (one.start !== null || one.end !== null),
    }))
    .filter((row) => row.cents !== 0n || row.costUnknown)
    .sort((a, b) =>
      abs(a.cents) > abs(b.cents) ? -1 : abs(a.cents) < abs(b.cents) ? 1 : a.key < b.key ? -1 : 1,
    );
  const largest = rows.reduce((max, row) => (abs(row.cents) > max ? abs(row.cents) : max), 0n);
  const byPosition = service.holdings.reduce((sum, one) => sum + (one.unrealizedChangeCents ?? 0n), 0n);
  return {
    rows: rows.map((row) => ({ ...row, bar: largest === 0n ? 0 : Number(row.cents) / Number(largest) })),
    incomeCents: local.incomeCents,
    feesCents: local.feesCents,
    correctionsCents: local.correctionsCents,
    valueChangeCents: (local.unrealizedChangeCents ?? 0n) - byPosition,
    unattributedCents: local.unattributedCents,
    totalCents: local.pnlCents,
  };
}

export interface ClosedGroup {
  holdingId: string;
  /** How many exits: an eToro position per close, a sale, a coin fee, a transfer out. */
  count: number;
  /** eToro closes matched with their opening by `positionId` (§4.4). */
  positions: number;
  openedOn: CivilDate | null;
  closedOn: CivilDate;
  costCents: Cents;
  proceedsCents: Cents;
  /** `null` when more left than the book ever held: the cost of some exit is unknown. */
  realizedCents: Cents | null;
  /** Realized ÷ cost: the return on what was invested, not the period's (PERS-113 · 4). */
  onCost: number | null;
}

/** The exits by position (§3.4): one row per holding, the latest close first. */
export function closedGroups(exits: readonly Exit[]): ClosedGroup[] {
  const groups = new Map<string, ClosedGroup>();
  for (const exit of exits) {
    const group = groups.get(exit.holdingId) ?? {
      holdingId: exit.holdingId,
      count: 0,
      positions: 0,
      openedOn: null,
      closedOn: exit.on,
      costCents: 0n,
      proceedsCents: 0n,
      realizedCents: 0n,
      onCost: null,
    };
    group.count += 1;
    if (exit.matched === "position") group.positions += 1;
    if (exit.openedOn !== null && (group.openedOn === null || exit.openedOn < group.openedOn)) {
      group.openedOn = exit.openedOn;
    }
    if (exit.on > group.closedOn) group.closedOn = exit.on;
    group.costCents += exit.costCents;
    group.proceedsCents += exit.proceedsCents;
    group.realizedCents =
      group.realizedCents === null || exit.realizedCents === null
        ? null
        : group.realizedCents + exit.realizedCents;
    groups.set(exit.holdingId, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      onCost:
        group.realizedCents === null || group.costCents <= 0n
          ? null
          : Number(group.realizedCents) / Number(group.costCents),
    }))
    .sort((a, b) =>
      a.closedOn !== b.closedOn ? (a.closedOn > b.closedOn ? -1 : 1) : a.holdingId < b.holdingId ? -1 : 1,
    );
}

/**
 * The return of an open position over the period (PERS-113 · 4), apart from its return on cost: what
 * it added ÷ its value at s⁻, or its cost when it was bought after. `null` below 1 unit of currency.
 */
export function periodReturnOf(one: HoldingPnl): number | null {
  if (one.contributionCents === null) return null;
  const base = one.start?.valueCents ?? one.end?.costCents ?? null;
  if (base === null || base < 100n) return null;
  return Number(one.contributionCents) / Number(base);
}

/** Unrealized ÷ cost of a position open on a day: the "% on cost" (§3.4). */
export function onCostOf(position: {
  costCents: Cents | null;
  unrealizedCents: Cents | null;
}): number | null {
  if (position.costCents === null || position.unrealizedCents === null || position.costCents <= 0n)
    return null;
  return Number(position.unrealizedCents) / Number(position.costCents);
}
