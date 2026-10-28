import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Account, balancesOn, listAccounts } from "@/modules/accounts/queries";
import { dailyBalancesOf } from "@/modules/accounts/service";
import { fundsView } from "@/modules/funds/queries";
import { linkCandidates, transactionsByIds } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { addDays, civilDateIn, type CivilDate, type MonthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { convertCents, NO_RATES, type RateTable } from "@/platform/fx/rules";
import { ratesOn } from "@/platform/fx/service";
import { externalIdsOf } from "@/platform/integrations/service";
import { type Cents, sumCents } from "@/platform/money";
import { INVESTMENT_PROVIDERS, type InvestmentProvider, providerOf } from "./catalog";
import {
  type AssetClass,
  type DayValue,
  type FlowEntry,
  flowEntriesOn,
  formatDecimal,
  type HoldingState,
  holdingStates,
  investorFlows,
  type Mode,
  monthsBack,
  type AccountOrigin,
  parseDecimal,
  type Performance,
  performance,
  PRICE_SCALE,
  QUANTITY_SCALE,
  sumFlows,
  transferProposals,
  valueOn,
} from "./rules";
import {
  investmentAssets,
  investmentOperationRevisions,
  investmentReadingPositions,
  investmentReadingScopes,
} from "./schema";
import {
  eligibleAccounts,
  type InvestmentAccount,
  type InvestmentAsset,
  listAssets,
  listInvestmentAccounts,
  type LoadedBook,
  loadBook,
  ratesFor,
  transferLegs,
} from "./service";
import {
  type CoverageWindow,
  type PeriodParams,
  periodOf,
  type PnlPeriod,
  pnlOf,
  type PnlService,
  portfolioPnl,
  type PortfolioPnl,
} from "./pnl";
import { type SyncStatus, syncStatus } from "./sync";
import { type ChartGrain, type ChartWindow, chartDays } from "./window";
import { type Xirr, xirr } from "./xirr";

/** The home chart looks back this far, as the legacy page did. */
const HISTORY_MONTHS = 36;
/** An adjustment without an end older than this is flagged (R3). */
const OPEN_ADJUSTMENT_DAYS = 30;
/** How far back a bank movement can be picked to document a deposit or a withdrawal. */
const LINK_WINDOW_DAYS = 400;

export interface ServiceSummary {
  account: Account;
  investment: InvestmentAccount;
  provider: InvestmentProvider | null;
  mode: Mode | null;
  origin: AccountOrigin | null;
  /** V today in the account's currency, and its counter-value in the display currency. */
  valueCents: Cents | null;
  displayCents: Cents | null;
  /** The change over 30 days, in the account's currency. */
  change30Cents: Cents | null;
  performance: Performance;
  /** The money-weighted return in the account's currency (§2.4); `null` where gain is hidden. */
  xirr: Xirr | null;
  /** Share of the portfolio's counter-value. */
  weight: number | null;
  lastUpdate: CivilDate | null;
  warnings: { conflicts: number; pendingZero: boolean; missingPrices: number; openAdjustments: number };
  /**
   * Whether gain and return can be shown (§2.4): always for a manual account; for a synced one
   * only when the coverage of its flows is complete. Otherwise `reliableFrom` says from when.
   */
  reliable: boolean;
  reliableFrom: Date | null;
}

interface Loaded {
  account: Account;
  investment: InvestmentAccount;
  book: LoadedBook;
  rates: RateTable;
  day: DayValue;
  sync: SyncStatus | null;
}

async function loadAll(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  todayOn: CivilDate,
  only?: string,
): Promise<{ loaded: Loaded[]; accounts: Account[] }> {
  const [investments, accounts] = await Promise.all([
    listInvestmentAccounts(ctx),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const loaded: Loaded[] = [];
  for (const investment of investments) {
    if (only !== undefined && investment.accountId !== only) continue;
    const account = byId.get(investment.accountId);
    if (!account) continue;
    const book = await loadBook(ctx, investment, account.currency);
    const rates = await ratesFor(book, todayOn);
    const day = valueOn(book, todayOn, rates);
    // Also after a disconnection: the retired key still asks to be revoked (SEC-07).
    const sync = await syncStatus(ctx, investment);
    loaded.push({ account, investment, book, rates, day, sync });
  }
  return { loaded, accounts };
}

function warningsOf(one: Loaded, todayOn: CivilDate): ServiceSummary["warnings"] {
  const latest = one.book.readingRows.at(-1) ?? null;
  const openAdjustments = one.book.events.filter((event) =>
    event.operations.some(
      (op) =>
        op.kind === "adjustment" &&
        op.validUntil === null &&
        event.on <= addDays(todayOn, -OPEN_ADJUSTMENT_DAYS),
    ),
  ).length;
  return {
    conflicts: one.day.conflicts.length,
    pendingZero: latest?.status === "pending_zero",
    missingPrices: one.day.missing,
    openAdjustments,
  };
}

function lastUpdateOf(book: LoadedBook): CivilDate | null {
  const days = [...book.eventRows.map((event) => event.on), ...book.readingRows.map((reading) => reading.on)];
  return days.length === 0 ? null : days.reduce((a, b) => (a > b ? a : b));
}

function summaryOf(one: Loaded, todayOn: CivilDate, displayCurrency: string, displayRates: RateTable) {
  const valueCents = one.day.valueCents;
  const before = valueOn(one.book, addDays(todayOn, -30), one.rates).valueCents;
  const reliable = one.day.origin !== "synced" || (one.sync?.complete ?? false);
  const entries = flowEntriesOn(one.book, todayOn);
  const measured = performance(sumFlows(entries), valueCents);
  return {
    account: one.account,
    investment: one.investment,
    provider: providerOf(one.investment.provider),
    mode: one.day.mode,
    origin: one.day.origin,
    valueCents,
    displayCents:
      valueCents === null
        ? null
        : convertCents(valueCents, one.account.currency, displayCurrency, todayOn, displayRates),
    change30Cents: valueCents === null || before === null ? null : valueCents - before,
    performance: reliable ? measured : { ...measured, gainCents: null, simpleReturn: null },
    xirr: reliable && valueCents !== null ? xirr(investorFlows(entries, todayOn, valueCents)) : null,
    weight: null as number | null,
    lastUpdate: lastUpdateOf(one.book),
    warnings: warningsOf(one, todayOn),
    reliable,
    reliableFrom: reliable ? null : (one.sync?.reliableFrom ?? null),
  } satisfies ServiceSummary;
}

export interface AllocationSlice {
  key: string;
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
  byClass: AllocationSlice[];
  byService: AllocationSlice[];
  funds: { id: string; name: string; valueCents: Cents | null; kind: string }[];
}

function slices(parts: Map<string, Cents>): AllocationSlice[] {
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
  live: Loaded[];
  /** The portfolio's flows, transfers between its services left out, in the display currency. */
  flows: FlowEntry[];
  displayRates: RateTable;
  months: MonthKey[];
}

/**
 * Every live service with its value in its currency and in the display currency, and the
 * portfolio's totals in the display currency (§1.8, §2.4): net invested, gain, simple return and
 * XIRR, each flow converted at the rate of its own day and the value at today's.
 */
async function portfolioState(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  now: Date,
): Promise<PortfolioState> {
  const todayOn = today(ctx.timeZone, now);
  const currency = ctx.displayCurrency;
  const { loaded } = await loadAll(ctx, todayOn);
  const months = monthsBack(todayOn, HISTORY_MONTHS);
  const firstDay = months[0];
  const live = loaded.filter((one) => one.account.state !== "archived");

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
  const portfolio = sumFlows(flows);
  const investedCents = unconverted
    ? null
    : portfolio.openingCents + portfolio.depositedCents - portfolio.withdrawnCents;
  const shown =
    value.total !== null && investedCents !== null && !value.partial && services.every((one) => one.reliable);
  const gainCents = shown ? (value.total as Cents) - (investedCents as Cents) : null;
  const base = portfolio.openingCents + portfolio.depositedCents;

  return {
    currency,
    todayOn,
    services,
    totals: {
      valueCents: value.total,
      partial: value.partial,
      investedCents,
      gainCents,
      simpleReturn: gainCents === null || base <= 0n ? null : Number(gainCents) / Number(base),
      xirr: gainCents === null ? null : xirr(investorFlows(flows, todayOn, value.total as Cents)),
      fxEffect,
    },
    live,
    flows,
    displayRates,
    months,
  };
}

/** The services and the portfolio's totals, for `/api/v1/investments` and the MCP (§5.5). */
export async function investmentsPortfolio(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  now: Date = new Date(),
): Promise<Portfolio> {
  const { currency, todayOn, services, totals } = await portfolioState(ctx, now);
  return { currency, todayOn, services, totals };
}

/**
 * The home of the section (§4.1): every service with its value in its currency and in the display
 * currency, the totals in the display currency (§1.8), the value-vs-invested chart from the
 * `portfolio` balances, the allocation by asset class and by service, and the funds read only.
 */
export async function investmentsHome(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  now: Date = new Date(),
): Promise<InvestmentsHome> {
  const { currency, todayOn, services, totals, live, displayRates } = await portfolioState(ctx, now);

  // Allocation: positions by class; cash, and accounts kept as a total, by their own key.
  const byClass = new Map<string, Cents>();
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

  const funds = await fundsView(ctx, now);
  return {
    currency,
    services,
    totals,
    byClass: slices(byClass),
    byService: slices(byService),
    funds: funds.rows.map((row) => ({
      id: row.fund.id,
      name: row.fund.name,
      valueCents: row.metrics.valueCents,
      kind: row.fund.type,
    })),
  };
}

export interface InvestmentHistory {
  currency: string;
  grain: ChartGrain;
  /** The window's months, after those before the history were dropped. */
  months: MonthKey[];
  /** The days the chart values: month ends (today for this month), or every day. */
  days: CivilDate[];
  value: (Cents | null)[];
  /** What had gone in by each day: opening, deposits, withdrawals (§2.4). */
  invested: (Cents | null)[];
  /** Days that stand on an estimated reading (PERS-100): drawn dashed and said so. */
  estimated: boolean[];
}

/**
 * The value-vs-invested chart of the home (every live service, in the display currency, each day
 * at its own rate) or of one service (in its currency), over a window (PERS-100): the `portfolio`
 * balances held day by day, and the flows up to each day. `null` for a service that is not one.
 */
export async function investmentHistory(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  options: { window: ChartWindow; accountId?: string; now?: Date },
): Promise<InvestmentHistory | null> {
  const now = options.now ?? new Date();
  const todayOn = today(ctx.timeZone, now);
  const { loaded } = await loadAll(ctx, todayOn, options.accountId);
  const live = options.accountId ? loaded : loaded.filter((one) => one.account.state !== "archived");
  if (options.accountId && live.length === 0) return null;
  const currency = options.accountId ? live[0].account.currency : ctx.displayCurrency;
  const firsts = live.flatMap((one) => (one.book.periods[0] ? [one.book.periods[0].fromOn] : []));
  const firstOn = firsts.length === 0 ? null : firsts.reduce((a, b) => (a < b ? a : b));
  const { months, days } = chartDays(options.window, todayOn, firstOn);

  const read = await dailyBalancesOf(
    ctx,
    live.map((one) => one.account.id),
    { from: days[0], to: days[days.length - 1] },
  );
  const indexOf = new Map(read.days.map((day, index) => [day, index]));
  const converts = live.some((one) => one.account.currency !== currency);
  const rates = converts
    ? await ratesOn(
        new Set([currency, ...live.map((one) => one.account.currency)]),
        addDays(days[0], -7),
        todayOn,
      )
    : NO_RATES;
  const valueSeries = live.map((one) => {
    const values = read.series.get(one.account.id)?.values ?? [];
    return days.map((day) => {
      const cents = values[indexOf.get(day) ?? -1] ?? null;
      return cents === null ? null : convertCents(cents, one.account.currency, currency, day, rates);
    });
  });
  const estimatedThrough = live.map(
    (one) => one.book.readingRows.filter((reading) => reading.status === "estimated").at(-1)?.on ?? null,
  );

  // What went in, each flow in the chart's currency at the rate of its own day (§2.4); a transfer
  // between two of the services shown moves no money in or out.
  const groups = new Map<string, Set<string>>();
  for (const one of live) {
    for (const event of one.book.events) {
      if (event.transferGroupId === null) continue;
      const accounts = groups.get(event.transferGroupId) ?? new Set<string>();
      accounts.add(one.account.id);
      groups.set(event.transferGroupId, accounts);
    }
  }
  const flowRates = converts
    ? await ratesOn(
        new Set([currency, ...live.map((one) => one.account.currency)]),
        addDays(firstOn ?? todayOn, -7),
        todayOn,
      )
    : NO_RATES;
  let unconverted = false;
  const flows = live.flatMap((one) =>
    flowEntriesOn(one.book, todayOn)
      .filter((entry) => entry.transferGroupId === null || (groups.get(entry.transferGroupId)?.size ?? 0) < 2)
      .flatMap((entry) => {
        const cents = convertCents(entry.cents, one.account.currency, currency, entry.on, flowRates);
        if (cents === null) unconverted = true;
        return cents === null ? [] : [{ ...entry, cents }];
      }),
  );

  return {
    currency,
    grain: options.window.grain,
    months,
    days,
    value: days.map((_, index) => sumCents(valueSeries.map((series) => series[index])).total),
    invested: days.map((day) => {
      if (unconverted || firstOn === null || day < firstOn) return null;
      const by = sumFlows(flows.filter((entry) => entry.on <= day));
      return by.openingCents + by.depositedCents - by.withdrawnCents;
    }),
    estimated: days.map((day, index) =>
      live.some(
        (one, at) =>
          estimatedThrough[at] !== null && day <= estimatedThrough[at]! && valueSeries[at][index] !== null,
      ),
    ),
  };
}

async function readingPositionsOf(ctx: Pick<Ctx, "userId">, readingId: string) {
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

// ——— Catalog (§4.2) ————————————————————————————————————————————————————————————————————————

export interface CatalogView {
  providers: (InvestmentProvider & { connected: { accountId: string; name: string }[] })[];
  /** "Use the existing account": every investment or crypto account, with why it cannot be picked. */
  existing: {
    id: string;
    name: string;
    currency: string;
    type: string;
    balanceCents: Cents | null;
    reason: string | null;
    /** A manual service a provider can be connected to (manual → synced, §2.5). */
    manualService: boolean;
  }[];
}

export async function catalogView(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<CatalogView> {
  const [investments, eligible] = await Promise.all([listInvestmentAccounts(ctx), eligibleAccounts(ctx)]);
  const accounts = new Map(eligible.map((one) => [one.account.id, one.account]));
  const candidates = eligible.filter((one) => one.reason !== "type" && one.account.state !== "archived");
  const balances = await balancesOn(
    ctx,
    candidates.map((one) => one.account.id),
    today(ctx.timeZone),
  );
  return {
    providers: INVESTMENT_PROVIDERS.map((provider) => ({
      ...provider,
      connected: investments
        .filter((investment) => investment.provider === provider.id)
        .flatMap((investment) => {
          const account = accounts.get(investment.accountId);
          return account && account.state !== "archived"
            ? [{ accountId: account.id, name: account.name }]
            : [];
        }),
    })),
    existing: candidates.map((one) => ({
      id: one.account.id,
      name: one.account.name,
      currency: one.account.currency,
      type: one.account.type,
      balanceCents: balances.get(one.account.id) ?? null,
      reason: one.reason,
      manualService:
        one.reason === "managed" &&
        investments.some(
          (investment) => investment.accountId === one.account.id && investment.provider === "manual",
        ),
    })),
  };
}

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
  periods: { fromOn: CivilDate; mode: Mode; origin: AccountOrigin; reason: string }[];
  holdings: HoldingRow[];
  operations: OperationRow[];
  readings: {
    id: string;
    on: CivilDate;
    status: string;
    totalCents: Cents;
    products: string[];
    /** Products the reading saw but did not read (B4, E2): its value leaves them out. */
    unread: string[];
    missingPrices: number;
  }[];
  adjustments: {
    eventId: string;
    on: CivilDate;
    amountCents: Cents;
    validUntil: CivilDate | null;
    note: string | null;
    stale: boolean;
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
async function holdingsOf(ctx: Pick<Ctx, "userId">, one: Loaded, todayOn: CivilDate): Promise<HoldingRow[]> {
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
  now: Date = new Date(),
): Promise<{ account: Account; currency: string; on: CivilDate; holdings: HoldingRow[] } | null> {
  const todayOn = today(ctx.timeZone, now);
  const { loaded } = await loadAll(ctx, todayOn, accountId);
  const one = loaded[0];
  if (!one) return null;
  return {
    account: one.account,
    currency: one.account.currency,
    on: todayOn,
    holdings: await holdingsOf(ctx, one, todayOn),
  };
}

/** A `numeric` as text without its trailing zeros: "0.500000000000000000" → "0.5". */
function trimmed(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export async function serviceDetail(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  now: Date = new Date(),
): Promise<ServiceDetail | null> {
  const todayOn = today(ctx.timeZone, now);
  const { loaded, accounts } = await loadAll(ctx, todayOn, accountId);
  const one = loaded[0];
  if (!one) return null;
  const currency = ctx.displayCurrency;
  const displayRates = await ratesOn(
    one.account.currency !== currency ? [currency, one.account.currency] : [],
    todayOn,
    todayOn,
  );
  const summary = summaryOf(one, todayOn, currency, displayRates);
  summary.weight = null;

  const holdings = await holdingsOf(ctx, one, todayOn);

  // Operations, grouped by event, newest first, with their bank link and their revisions.
  const names = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
  const transactionIds = one.book.eventRows.flatMap((event) =>
    event.transactionId ? [event.transactionId] : [],
  );
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const [linked, revisionRows, legs] = await Promise.all([
    transactionsByIds(ctx, transactionIds),
    getDb()
      .select({ eventId: investmentOperationRevisions.eventId })
      .from(investmentOperationRevisions)
      .where(
        and(
          userScoped(ctx).owns(investmentOperationRevisions),
          eq(investmentOperationRevisions.investmentAccountId, one.investment.id),
        ),
      ),
    transferLegs(ctx),
  ]);
  const partnerOf = (event: { id: string; transferGroupId: string | null }) => {
    if (event.transferGroupId === null) return null;
    const other = legs.find(
      (leg) => leg.transferGroupId === event.transferGroupId && leg.eventId !== event.id,
    );
    return other
      ? { accountId: other.accountId, accountName: accountNames.get(other.accountId) ?? "" }
      : null;
  };
  const revisions = new Map<string, number>();
  for (const row of revisionRows) revisions.set(row.eventId, (revisions.get(row.eventId) ?? 0) + 1);
  const operations: OperationRow[] = [...one.book.eventRows].reverse().map((event) => {
    const legs = one.book.operationRows
      .filter((op) => op.eventId === event.id)
      .sort((a, b) => (a.leg === "main" ? -1 : b.leg === "main" ? 1 : a.leg < b.leg ? -1 : 1))
      .map((op) => ({
        id: op.id,
        holdingId: op.holdingId,
        leg: op.leg,
        kind: op.kind,
        holdingName: op.holdingId ? (names.get(op.holdingId) ?? null) : null,
        quantityText: op.quantity === null ? null : trimmed(op.quantity),
        priceText: op.unitPrice === null ? null : trimmed(op.unitPrice),
        priceCurrency: op.priceCurrency,
        amountCents: op.amountCents,
        validUntil: op.validUntil,
        fxSource: op.fxSource,
      }));
    const transaction = event.transactionId ? linked.get(event.transactionId) : undefined;
    return {
      id: event.id,
      on: event.on,
      origin: event.origin,
      note: event.note,
      kind: legs[0]?.kind ?? "deposit",
      legs,
      linked: transaction ? { payee: transaction.payee, on: event.on, cents: transaction.amountCents } : null,
      transactionId: event.transactionId,
      revisions: revisions.get(event.id) ?? 0,
      transfer: partnerOf(event),
    };
  });
  const amountOf = new Map(operations.map((row) => [row.id, row.legs[0]?.amountCents ?? 0n]));
  const proposals: TransferProposalRow[] = transferProposals(legs).flatMap(({ withdrawal, deposit }) => {
    const out = withdrawal.accountId === accountId;
    if (!out && deposit.accountId !== accountId) return [];
    const mine = out ? withdrawal : deposit;
    const other = out ? deposit : withdrawal;
    return [
      {
        withdrawalId: withdrawal.eventId,
        depositId: deposit.eventId,
        direction: out ? ("out" as const) : ("in" as const),
        on: mine.on,
        amountCents: amountOf.get(mine.eventId) ?? 0n,
        other: {
          accountId: other.accountId,
          accountName: accountNames.get(other.accountId) ?? "",
          on: other.on,
        },
      },
    ];
  });

  const scopeRows =
    one.book.readingRows.length === 0
      ? []
      : await getDb()
          .select({
            readingId: investmentReadingScopes.readingId,
            product: investmentReadingScopes.product,
            complete: investmentReadingScopes.complete,
          })
          .from(investmentReadingScopes)
          .where(
            and(
              userScoped(ctx).owns(investmentReadingScopes),
              inArray(
                investmentReadingScopes.readingId,
                one.book.readingRows.map((reading) => reading.id),
              ),
            ),
          );
  const readings = [...one.book.readingRows]
    .reverse()
    .slice(0, 20)
    .map((reading) => ({
      id: reading.id,
      on: reading.on,
      status: reading.status,
      totalCents: reading.totalCents,
      missingPrices: reading.missingPrices,
      products: [
        ...new Set(
          scopeRows.filter((row) => row.readingId === reading.id && row.complete).map((row) => row.product),
        ),
      ].sort(),
      // A wallet or account type the provider reports but the adapter does not read (B4, E2).
      unread: [
        ...new Set(
          scopeRows.filter((row) => row.readingId === reading.id && !row.complete).map((row) => row.product),
        ),
      ].sort(),
    }));
  const coveredProducts = readings[0]?.products ?? [];

  const adjustments = one.book.eventRows.flatMap((event) =>
    one.book.operationRows
      .filter((op) => op.eventId === event.id && op.kind === "adjustment")
      .filter((op) => op.validUntil === null || op.validUntil >= todayOn)
      .map((op) => ({
        eventId: event.id,
        on: event.on,
        amountCents: op.amountCents,
        validUntil: op.validUntil,
        note: event.note,
        stale: op.validUntil === null && event.on <= addDays(todayOn, -OPEN_ADJUSTMENT_DAYS),
      })),
  );

  const from = addDays(todayOn, -LINK_WINDOW_DAYS);
  const [out, incoming, assets] = await Promise.all([
    linkCandidates(ctx, { direction: "out", from, to: todayOn }),
    linkCandidates(ctx, { direction: "in", from, to: todayOn }),
    listAssets(ctx),
  ]);
  const option = (row: {
    id: string;
    accountId: string;
    on: CivilDate;
    cents: Cents;
    payee: string | null;
  }) => ({
    id: row.id,
    on: row.on,
    cents: row.cents < 0n ? -row.cents : row.cents,
    payee: row.payee,
    accountName: accountNames.get(row.accountId) ?? null,
  });

  return {
    summary,
    currency: one.account.currency,
    day: one.day,
    periods: one.book.periodRows.map((period) => ({
      fromOn: period.fromOn,
      mode: period.mode,
      origin: period.origin,
      reason: period.reason,
    })),
    holdings,
    operations,
    readings,
    adjustments,
    sync: one.sync,
    coveredProducts,
    assets,
    linkOptions: { out: out.map(option), in: incoming.map(option) },
    transferProposals: proposals,
  };
}

/** For the export and the ⌘K palette: every service by name with its value and returns today. */
export async function investmentServices(ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">): Promise<
  {
    accountId: string;
    name: string;
    category: string;
    provider: string;
    mode: Mode | null;
    currency: string;
    valueCents: Cents | null;
    investedCents: Cents;
    gainCents: Cents | null;
    simpleReturn: number | null;
    xirr: Xirr | null;
    reliableFrom: Date | null;
  }[]
> {
  const todayOn = today(ctx.timeZone);
  const { loaded } = await loadAll(ctx, todayOn);
  return loaded.map((one) => {
    const summary = summaryOf(one, todayOn, one.account.currency, NO_RATES);
    return {
      accountId: one.account.id,
      name: one.account.name,
      category: one.investment.category,
      provider: one.investment.provider,
      mode: one.day.mode,
      currency: one.account.currency,
      valueCents: one.day.valueCents,
      investedCents: summary.performance.investedCents,
      gainCents: summary.performance.gainCents,
      simpleReturn: summary.performance.simpleReturn,
      xirr: summary.xirr,
      reliableFrom: summary.reliableFrom,
    };
  });
}

/** For the export: every operation leg of every service, oldest first, with its transfer (§2.4). */
export async function investmentOperationsExport(ctx: Pick<Ctx, "userId" | "timeZone">) {
  const todayOn = today(ctx.timeZone);
  const { loaded } = await loadAll(ctx, todayOn);
  const names = new Map(loaded.map((one) => [one.investment.id, one.account.name]));
  const groups = new Map<string, string[]>();
  for (const one of loaded) {
    for (const event of one.book.eventRows) {
      if (event.transferGroupId === null) continue;
      groups.set(event.transferGroupId, [
        ...(groups.get(event.transferGroupId) ?? []),
        event.investmentAccountId,
      ]);
    }
  }
  return loaded.flatMap((one) => {
    const holdingNames = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
    return one.book.eventRows.flatMap((event) => {
      const other =
        event.transferGroupId === null
          ? undefined
          : groups.get(event.transferGroupId)?.find((id) => id !== event.investmentAccountId);
      return one.book.operationRows
        .filter((op) => op.eventId === event.id)
        .map((op) => ({
          on: event.on,
          service: one.account.name,
          currency: one.account.currency,
          kind: op.kind,
          leg: op.leg,
          asset: op.holdingId ? (holdingNames.get(op.holdingId) ?? null) : null,
          quantity: op.quantity === null ? null : trimmed(op.quantity),
          unitPrice: op.unitPrice === null ? null : trimmed(op.unitPrice),
          amountCents: op.amountCents,
          transferWith: other === undefined ? null : (names.get(other) ?? null),
          note: event.note,
        }));
    });
  });
}

// ——— Profit and loss of a period (docs/design/investments-ux.md §4, U1) ——————————————————————————

export interface InvestmentsPnl {
  period: PnlPeriod;
  todayOn: CivilDate;
  currency: string;
  /** Every live service with its own P&L, and the portfolio's (§4.6, §4.8). */
  portfolio: PortfolioPnl;
}

/**
 * The flows a provider's coverage says it holds, by day (§4.6): the `flows` windows but the
 * `quantities` stream, which says whether the quantities add up and nothing about the flows.
 */
function coverageOf(sync: SyncStatus, timeZone: string): { windows: CoverageWindow[]; mismatch: boolean } {
  const flows = sync.coverage.filter((row) => row.kind === "flows");
  return {
    windows: flows
      .filter((row) => row.stream !== "quantities")
      .map((row) => ({
        stream: row.stream,
        fromOn: civilDateIn(row.fromAt, timeZone),
        toOn: civilDateIn(row.toAt, timeZone),
        complete: row.status === "complete",
      })),
    // `quantity_mismatch` or `negative_opening` (A6): either way the quantities do not add up.
    mismatch: flows.some((row) => row.stream === "quantities" && row.status !== "complete"),
  };
}

/**
 * The P&L of the period (§4) of every live service and of the portfolio, in the display currency:
 * the engine of `pnl.ts` on each book, with its coverage, its provider ids (eToro's `positionId`)
 * and the rates from the earliest day measured. Nothing is shown with it yet (U2–U5).
 */
export async function investmentsPnl(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  now: Date = new Date(),
): Promise<InvestmentsPnl> {
  const todayOn = today(ctx.timeZone, now);
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const currency = ctx.displayCurrency;
  const { loaded } = await loadAll(ctx, todayOn);
  const live = loaded.filter((one) => one.account.state !== "archived");

  const services: PnlService[] = [];
  for (const one of live) {
    const synced = one.investment.provider !== "manual" && one.sync !== null;
    const coverage = synced ? coverageOf(one.sync!, ctx.timeZone) : null;
    const externalIds = synced
      ? await externalIdsOf(
          ctx,
          one.investment.provider,
          "investment_event",
          one.book.events.map((event) => event.id),
        )
      : new Map<string, string>();
    services.push({
      accountId: one.account.id,
      currency: one.account.currency,
      book: one.book,
      rates: one.rates,
      coverage: coverage?.windows ?? null,
      quantityMismatch: coverage?.mismatch ?? false,
      externalIds,
    });
  }

  const firsts = live.flatMap((one) => [
    ...one.book.periods.map((p) => p.fromOn),
    ...one.book.events.map((event) => event.on),
  ]);
  const earliest = period.from ?? (firsts.length === 0 ? todayOn : firsts.reduce((a, b) => (a < b ? a : b)));
  const converts = live.some((one) => one.account.currency !== currency);
  const rates = converts
    ? await ratesOn(
        new Set([currency, ...live.map((one) => one.account.currency)]),
        addDays(earliest, -8),
        period.to,
      )
    : NO_RATES;
  const display = { currency, rates };
  return {
    period,
    todayOn,
    currency,
    portfolio: portfolioPnl(
      services.map((one) => pnlOf(one, period.from, period.to, display)),
      currency,
    ),
  };
}
