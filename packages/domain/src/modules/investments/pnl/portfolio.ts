// The P&L of the portfolio (§4.6, §4.8, §4.9): the services summed, the transfers between them, the rate.
import { addDays, type CivilDate, daysBetween } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { MIN_CAPITAL_CENTS, MIN_CAPITAL_SHARE } from "../../../shared/returns";
import { abs } from "../../../shared/money";
import { type PeriodFlow, type PnlParts, type PnlReason, type PnlStatus, type ServicePnl } from "./types";

// ——— The portfolio (§4.6, §4.8, §4.9) ——————————————————————————————————————————————————————

interface Contribution {
  accountId: string;
  cents: Cents;
  /** The divergent bar (§4.8): −1…1, scaled on the largest |P&L| of the rows. */
  bar: number;
  /** Share of the net P&L; `null` ("not computable") when the net is zero or almost. */
  shareOfNet: number | null;
}

export interface PortfolioPnl {
  currency: string;
  status: PnlStatus;
  /** Some service starts later, stands on an old price or is left out: the hero says "P&L available". */
  available: boolean;
  services: ServicePnl[];
  /** In the total: not `undetermined`, with a display amount. */
  included: string[];
  excluded: { accountId: string; reasons: PnlReason[] }[];
  partial: { accountId: string; from: CivilDate }[];
  /** The services whose first or last day used an old price or rate. */
  stale: string[];
  /** Σ services + transfers between them = P&L (§4.6). */
  parts: PnlParts | null;
  /** Both legs of a transfer inside the portfolio and the period, in the display currency (§4.9). */
  transfersCents: Cents;
  /** The aggregate Dietz, only over one range for every service (§4.8). */
  rate: number | null;
  rateReason: "ok" | "mixed_ranges" | "not_computable" | "none";
  contributions: Contribution[];
}

/**
 * The portfolio (§4.6, §4.8): the services that can be measured summed in the display currency,
 * the transfers between them closing the sum, its status down to the hero, an aggregate return only
 * when every service covers the same days, and each service's contribution in money.
 */
export function portfolioPnl(services: readonly ServicePnl[], currency: string): PortfolioPnl {
  const included = services.filter((one) => one.status !== "undetermined" && one.display !== null);
  const excluded = services
    .filter((one) => !included.includes(one))
    .map((one) => ({ accountId: one.accountId, reasons: one.reasons }));
  const partial = included
    .filter((one) => one.partial)
    .map((one) => ({ accountId: one.accountId, from: one.from! }));
  const stale = included.filter((one) => one.status === "stale").map((one) => one.accountId);

  // A transfer is internal when both legs are in included services, each inside its own period.
  const legs = new Map<string, { accountId: string; flow: PeriodFlow }[]>();
  for (const one of included) {
    for (const flow of one.flows) {
      if (flow.transferGroupId === null) continue;
      legs.set(flow.transferGroupId, [
        ...(legs.get(flow.transferGroupId) ?? []),
        { accountId: one.accountId, flow },
      ]);
    }
  }
  let transfersCents = 0n;
  const internal: PeriodFlow[] = [];
  for (const group of legs.values()) {
    if (new Set(group.map((leg) => leg.accountId)).size < 2) continue;
    for (const leg of group) {
      transfersCents += leg.flow.displayCents ?? 0n;
      internal.push(leg.flow);
    }
  }

  let parts: PnlParts | null = null;
  if (included.length > 0) {
    const sum = (pick: (parts: PnlParts) => Cents | null) =>
      included.reduce((total, one) => total + (pick(one.display!) ?? 0n), 0n);
    // Part by part, the sum of the services (PERS-145): a service's unknown unrealized stays in its
    // own unattributed, never moves another service's known one there.
    const unrealizedKnown = included.some((one) => one.display!.unrealizedChangeCents !== null);
    parts = {
      pnlCents: sum((p) => p.pnlCents) + transfersCents,
      realizedCents: sum((p) => p.realizedCents),
      unrealizedChangeCents: unrealizedKnown ? sum((p) => p.unrealizedChangeCents) : null,
      incomeCents: sum((p) => p.incomeCents),
      feesCents: sum((p) => p.feesCents),
      correctionsCents: sum((p) => p.correctionsCents),
      fxCents: sum((p) => p.fxCents),
      unattributedCents: sum((p) => p.unattributedCents),
    };
  }

  // §4.8: one numerator and one denominator over the same days, or no aggregate rate.
  let rate: number | null = null;
  let rateReason: PortfolioPnl["rateReason"] = "none";
  if (parts !== null) {
    const ranges = new Set(included.map((one) => one.from));
    if (ranges.size > 1) rateReason = "mixed_ranges";
    else {
      const from = included[0].from!;
      const to = included[0].to;
      const days = daysBetween(addDays(from, -1), to);
      let capital = included.reduce((total, one) => total + (one.displayCapitalCents ?? 0), 0);
      for (const flow of internal)
        capital -= (Number(flow.displayCents ?? 0n) * daysBetween(flow.on, to)) / days;
      const moved = new Set(internal);
      const gross = included.reduce(
        (total, one) =>
          total +
          Math.max(0, Number(one.displayStartCents ?? 0n)) +
          one.flows
            .filter((flow) => !moved.has(flow))
            .reduce((sum, flow) => sum + Math.max(0, Number(flow.displayCents ?? 0n)), 0),
        0,
      );
      const floor = Math.max(Number(MIN_CAPITAL_CENTS), MIN_CAPITAL_SHARE * gross);
      if (capital <= 0 || capital < floor) rateReason = "not_computable";
      else {
        rate = Number(parts.pnlCents) / capital;
        rateReason = "ok";
      }
    }
  }

  // Contributions (§4.8): money first, a divergent bar, the share of the net only when it means something.
  const amounts = included.map((one) => ({ accountId: one.accountId, cents: one.display!.pnlCents }));
  const largest = amounts.reduce((max, one) => (abs(one.cents) > max ? abs(one.cents) : max), 0n);
  const gross = amounts.reduce((total, one) => total + abs(one.cents), 0n);
  const net = parts?.pnlCents ?? 0n;
  const meaningful =
    abs(net) >= MIN_CAPITAL_CENTS && Number(abs(net)) >= MIN_CAPITAL_SHARE * Number(gross) && net !== 0n;
  const contributions = amounts
    .map((one) => ({
      accountId: one.accountId,
      cents: one.cents,
      bar: largest === 0n ? 0 : Number(one.cents) / Number(largest),
      shareOfNet: meaningful ? Number(one.cents) / Number(net) : null,
    }))
    .sort((a, b) =>
      abs(a.cents) > abs(b.cents) ? -1 : abs(a.cents) < abs(b.cents) ? 1 : a.accountId < b.accountId ? -1 : 1,
    );

  const status: PnlStatus = included.length === 0 ? "undetermined" : stale.length > 0 ? "stale" : "verified";
  return {
    currency,
    status,
    available: excluded.length > 0 || partial.length > 0 || stale.length > 0,
    services: [...services],
    included: included.map((one) => one.accountId),
    excluded,
    partial,
    stale,
    parts,
    transfersCents,
    rate,
    rateReason,
    contributions,
  };
}
