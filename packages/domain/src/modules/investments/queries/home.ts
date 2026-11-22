// The home of the section and the portfolio of /api/v1/investments (§1.8, §2.4, §4.1).
import { and, asc, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, type MonthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { convertCents, type RateTable } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import { type Cents, sumCents } from "../../../shared/money";
import {
  type AssetClass,
  type FlowEntry,
  flowEntriesOn,
  holdingStates,
  investorFlows,
  monthsBack,
  performance,
  sumFlows,
} from "../rules";
import { investmentAssets, investmentReadingPositions } from "../schema";
import { type Xirr, xirr } from "../../../shared/returns";
import { type InvestmentsSnapshot, type Loaded, snapshotOf } from "./snapshot";
import { HISTORY_MONTHS, type ServiceSummary, summaryOf } from "./summary";

export interface AllocationSlice<K extends string = string> {
  key: K;
  cents: Cents;
  share: number;
}

export interface InvestmentsHome {
  currency: string;
  services: ServiceSummary[];
  totals: {
    valueCents: Cents | null;
    partial: boolean;
    investedCents: Cents | null;
    gainCents: Cents | null;
    simpleReturn: number | null;
    xirr: Xirr | null;
    /** Some service is in another currency: gain and returns include the exchange effect (§2.4). */
    fxEffect: boolean;
  };
  /** `unclassified`: a manual account kept as a total. */
  byClass: AllocationSlice<AssetClass | "unclassified">[];
  byService: AllocationSlice[];
}

function slices<K extends string>(parts: Map<K, Cents>): AllocationSlice<K>[] {
  const total = [...parts.values()].reduce<Cents>((sum, cents) => sum + (cents > 0n ? cents : 0n), 0n);
  return [...parts.entries()]
    .filter(([, cents]) => cents > 0n)
    .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0] < b[0] ? -1 : 1))
    .map(([key, cents]) => ({ key, cents, share: total > 0n ? Number(cents) / Number(total) : 0 }));
}

export interface Portfolio {
  currency: string;
  todayOn: CivilDate;
  services: ServiceSummary[];
  totals: InvestmentsHome["totals"];
}

interface PortfolioState extends Portfolio {
  now: Date;
  live: Loaded[];
  /** The portfolio's flows, transfers between its services left out, in the display currency. */
  flows: FlowEntry[];
  displayRates: RateTable;
  months: MonthKey[];
}

/** Which services a read takes: the live ones, or every one for the export (audit INV-5, D10). */
export interface ArchivedOption {
  includeArchived?: boolean;
}

/**
 * Every live service with its value in its currency and in the display currency, and the
 * portfolio's totals in the display currency (§1.8, §2.4): net invested, gain, simple return and
 * XIRR, each flow converted at the rate of its own day and the value at today's.
 */
async function portfolioState(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  source: Date | InvestmentsSnapshot,
  options: ArchivedOption = {},
): Promise<PortfolioState> {
  const { now, todayOn, loaded } = await snapshotOf(ctx, source);
  const currency = ctx.displayCurrency;
  const months = monthsBack(todayOn, HISTORY_MONTHS);
  const firstDay = months[0];
  const live = options.includeArchived ? loaded : loaded.filter((one) => one.account.state !== "archived");

  // The portfolio's flows (§2.4): a transfer between two of its services moves no money in or out,
  // so both legs drop out — but only when both are here; a lone leg is a flow like any other.
  const groups = new Map<string, Set<string>>();
  for (const one of live) {
    for (const event of one.book.events) {
      if (event.transferGroupId === null) continue;
      const accounts = groups.get(event.transferGroupId) ?? new Set<string>();
      accounts.add(one.account.id);
      groups.set(event.transferGroupId, accounts);
    }
  }
  const internal = (entry: FlowEntry) =>
    entry.transferGroupId !== null && (groups.get(entry.transferGroupId)?.size ?? 0) > 1;
  const external = live.map((one) => flowEntriesOn(one.book, todayOn).filter((entry) => !internal(entry)));
  const earliest = external
    .flat()
    .reduce<CivilDate>((min, entry) => (entry.on < min ? entry.on : min), firstDay);
  const fxEffect = live.some((one) => one.account.currency !== currency);
  const displayRates = await ratesOn(
    fxEffect ? [currency, ...live.map((one) => one.account.currency)] : [],
    addDays(earliest, -7),
    todayOn,
  );
  const services = live.map((one) => summaryOf(one, todayOn, currency, displayRates));
  const value = sumCents(services.map((one) => one.displayCents));
  for (const one of services) {
    one.weight =
      one.displayCents === null || value.total === null || value.total <= 0n
        ? null
        : Number(one.displayCents) / Number(value.total);
  }
  // Each flow in the display currency at the rate of its own day; the value at today's (§2.4).
  let unconverted = false;
  const flows: FlowEntry[] = live.flatMap((one, index) =>
    external[index].flatMap((entry) => {
      const cents = convertCents(entry.cents, one.account.currency, currency, entry.on, displayRates);
      if (cents === null) {
        unconverted = true;
        return [];
      }
      return [{ ...entry, cents }];
    }),
  );
  const shown =
    value.total !== null && !unconverted && !value.partial && services.every((one) => one.reliable);
  const measured = performance(sumFlows(flows), shown ? value.total : null);
  const investedCents = unconverted ? null : measured.investedCents;
  const { gainCents } = measured;

  return {
    currency,
    now,
    todayOn,
    services,
    totals: {
      valueCents: value.total,
      partial: value.partial,
      investedCents,
      gainCents,
      simpleReturn: measured.simpleReturn,
      xirr: gainCents === null ? null : xirr(investorFlows(flows, todayOn, value.total!)),
      fxEffect,
    },
    live,
    flows,
    displayRates,
    months,
  };
}

/** The services and the portfolio's totals, for `/api/v1/investments`, the MCP (§5.5) and the export. */
export async function investmentsPortfolio(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  source: Date | InvestmentsSnapshot = new Date(),
  options: ArchivedOption = {},
): Promise<Portfolio> {
  const { currency, todayOn, services, totals } = await portfolioState(ctx, source, options);
  return { currency, todayOn, services, totals };
}

/**
 * The home of the section (§4.1): every service with its value in its currency and in the display
 * currency, the totals in the display currency (§1.8), the value-vs-invested chart from the
 * `portfolio` balances, the allocation by asset class and by service. The funds are not read here:
 * the application adds them (R5b, end of the cycle with funds, INV-9).
 */
export async function investmentsHome(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  source: Date | InvestmentsSnapshot = new Date(),
): Promise<InvestmentsHome> {
  const { currency, todayOn, services, totals, live, displayRates } = await portfolioState(ctx, source);

  // Allocation: positions by class; cash, and accounts kept as a total, by their own key.
  const byClass = new Map<AssetClass | "unclassified", Cents>();
  const byService = new Map<string, Cents>();
  const add = (map: Map<string, Cents>, key: string, cents: Cents) =>
    map.set(key, (map.get(key) ?? 0n) + cents);
  for (const one of live) {
    const display = (cents: Cents) =>
      convertCents(cents, one.account.currency, currency, todayOn, displayRates);
    const total = one.day.valueCents === null ? null : display(one.day.valueCents);
    if (total === null) continue;
    add(byService, one.account.name, total);
    if (one.day.mode === "total" && one.day.origin === "manual") {
      add(byClass, "unclassified", total);
      continue;
    }
    const states = holdingStates(one.book, todayOn, one.rates);
    let placed = 0n;
    for (const holding of one.book.holdingRows) {
      const state = states.get(holding.id);
      if (!state?.open || state.valueCents === null) continue;
      if (one.day.origin === "synced" && holding.origin === "provider") continue;
      const cents = display(state.valueCents);
      if (cents === null) continue;
      add(byClass, holding.asset.class, cents);
      placed += cents;
    }
    if (one.day.origin === "synced") {
      const reading = one.book.readingRows.filter((row) => row.on <= todayOn).at(-1);
      if (reading) {
        const positions = await readingPositionsOf(ctx, reading.id);
        for (const position of positions) {
          if (position.valueCents === null) continue;
          const cents = display(position.valueCents);
          if (cents === null) continue;
          add(byClass, position.assetClass, cents);
          placed += cents;
        }
      }
    }
    if (total - placed > 0n) add(byClass, "cash", total - placed);
  }

  return { currency, services, totals, byClass: slices(byClass), byService: slices(byService) };
}

export async function readingPositionsOf(ctx: Pick<Ctx, "userId">, readingId: string) {
  const rows = await getDb()
    .select({ position: investmentReadingPositions, asset: investmentAssets })
    .from(investmentReadingPositions)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadingPositions),
        eq(investmentReadingPositions.readingId, readingId),
      ),
    )
    .orderBy(asc(investmentAssets.name), asc(investmentReadingPositions.id));
  return rows.map(({ position, asset }) => ({
    id: position.id,
    assetId: asset.id,
    assetName: asset.name,
    assetClass: asset.class as AssetClass,
    symbol: asset.symbol,
    product: position.product,
    quantity: position.quantity,
    price: position.price,
    priceCurrency: position.priceCurrency,
    valueCents: position.valueCents,
  }));
}
