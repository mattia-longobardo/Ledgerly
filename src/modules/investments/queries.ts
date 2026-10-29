import "server-only";
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { type Account, balancesOn, listAccounts } from "@/modules/accounts/queries";
import { dailyBalancesOf } from "@/modules/accounts/service";
import { fundsView } from "@/modules/funds/queries";
import { escapeLike, linkCandidates, transactionsByIds } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { addDays, civilDateIn, type CivilDate, type MonthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { convertCents, NO_RATES, type RateTable } from "@/platform/fx/rules";
import { ratesOn } from "@/platform/fx/service";
import { externalIdsOf } from "@/platform/integrations/service";
import { type Cents, sumCents } from "@/platform/money";
import { ACTIVITY_FAMILIES, type ActivityFamily, type DescribedLeg, familyOf, kindsOf } from "./activity";
import { INVESTMENT_PROVIDERS, type InvestmentProvider, providerOf } from "./catalog";
import {
  type AdjustmentClass,
  type AssetClass,
  type DayValue,
  type FlowEntry,
  flowEntriesOn,
  formatDecimal,
  type HoldingState,
  holdingStates,
  investorFlows,
  isUnpricedDust,
  type Mode,
  monthsBack,
  type AccountOrigin,
  type OperationKind,
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
  investmentEvents,
  investmentHoldings,
  investmentOperationRevisions,
  investmentOperations,
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
  type Exit,
  type PeriodParams,
  periodOf,
  type PnlPeriod,
  pnlOf,
  type PnlService,
  portfolioPnl,
  type PortfolioPnl,
  replayHoldings,
  type ServicePnl,
} from "./pnl";
import { type BarGrain, barIntervals, type Interval, periodSpan, valueDays } from "./period";
import { type SyncStatus, syncStatus } from "./sync";
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
  /** The rebuilt history (PERS-100): how many estimated readings, from when to when. */
  estimatedReadings: { count: number; from: CivilDate; to: CivilDate } | null;
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
  // Enough of the latest to fold the runs of equal readings (§3.6); the estimated ones are one line.
  const readings = [...one.book.readingRows]
    .filter((reading) => reading.status !== "estimated")
    .reverse()
    .slice(0, 60)
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
  const estimated = one.book.readingRows.filter((reading) => reading.status === "estimated");
  const estimatedReadings =
    estimated.length === 0
      ? null
      : { count: estimated.length, from: estimated[0].on, to: estimated[estimated.length - 1].on };
  const firstReadOn = one.book.readingRows.find((reading) => reading.status !== "estimated")?.on ?? null;

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
        adjustmentClass: op.adjustmentClass,
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
    estimatedReadings,
    firstReadOn,
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

/** The inputs of the engine for every live service, and the rates to the display currency (§4.5). */
async function pnlInputs(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  live: Loaded[],
  period: PnlPeriod,
  todayOn: CivilDate,
): Promise<{ services: PnlService[]; display: { currency: string; rates: RateTable } }> {
  const currency = ctx.displayCurrency;
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
      adjustmentClasses: new Map(
        one.book.operationRows.flatMap((op) =>
          op.kind === "adjustment" && op.adjustmentClass ? [[op.eventId, op.adjustmentClass] as const] : [],
        ),
      ),
    });
  }

  const earliest = period.from ?? firstDayOf(live) ?? todayOn;
  const converts = live.some((one) => one.account.currency !== currency);
  const rates = converts
    ? await ratesOn(
        new Set([currency, ...live.map((one) => one.account.currency)]),
        addDays(earliest, -8),
        period.to,
      )
    : NO_RATES;
  return { services, display: { currency, rates } };
}

/** The first day any live service has something: its first period or its first event. */
function firstDayOf(live: Loaded[]): CivilDate | null {
  const firsts = live.flatMap((one) => [
    ...one.book.periods.map((p) => p.fromOn),
    ...one.book.events.map((event) => event.on),
  ]);
  return firsts.length === 0 ? null : firsts.reduce((a, b) => (a < b ? a : b));
}

/**
 * The P&L of the period (§4) of every live service and of the portfolio, in the display currency:
 * the engine of `pnl.ts` on each book, with its coverage, its provider ids (eToro's `positionId`)
 * and the rates from the earliest day measured.
 */
export async function investmentsPnl(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  now: Date = new Date(),
): Promise<InvestmentsPnl> {
  const todayOn = today(ctx.timeZone, now);
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const { loaded } = await loadAll(ctx, todayOn);
  const live = loaded.filter((one) => one.account.state !== "archived");
  const { services, display } = await pnlInputs(ctx, live, period, todayOn);
  return {
    period,
    todayOn,
    currency: display.currency,
    portfolio: portfolioPnl(
      services.map((one) => pnlOf(one, period.from, period.to, display)),
      display.currency,
    ),
  };
}

export interface PnlChartService {
  accountId: string;
  /** The P&L of each bar in the display currency; `null` before the service is measured. */
  bars: (Cents | null)[];
  /** Per bar, whether it stands on an estimated reading (PERS-100): drawn dashed. */
  barsEstimated: boolean[];
  /** The value at each point in the display currency, at the rate of its day. */
  values: (Cents | null)[];
  valuesEstimated: boolean[];
}

export interface InvestmentsPnlView extends InvestmentsPnl {
  /** The first day with data: where "All" starts and the stepper stops (§2.1). */
  firstOn: CivilDate | null;
  /** The days the period really spans, "All" from `firstOn`. */
  span: { from: CivilDate; to: CivilDate };
  /** The P&L chart (§2.2): bars by week, month or year, one layer per service. */
  barGrain: BarGrain;
  intervals: Interval[];
  /** The value chart (§2.2): every day, or month ends. */
  valueGrain: "day" | "month";
  valueDays: CivilDate[];
  chart: PnlChartService[];
  /** The place of each live service in Overview's account order: its colour (§0.6). */
  colorIndex: Map<string, number>;
}

/**
 * The home of the section (docs/design/investments-ux.md §3.1, U2): the P&L of the period, and the
 * chart that explains it — the P&L of each bar by service, and the value of each service. A bar is
 * the difference of the P&L measured from the service's first day to the bar's last one, so the
 * bars of a service add up to its P&L exactly, the last ending on the hero's own number.
 */
export async function investmentsPnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  now: Date = new Date(),
): Promise<InvestmentsPnlView> {
  return pnlView(ctx, params, now);
}

/**
 * One service's view of the period (§3.3, U3): the same engine, inputs and bars as the home, so the
 * service's P&L in the display currency is the number of its row there, to the cent (PERS-113 · 5).
 * `null` when the person has no such service.
 */
export async function servicePnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  params: PeriodParams | PnlPeriod,
  now: Date = new Date(),
): Promise<InvestmentsPnlView | null> {
  const view = await pnlView(ctx, params, now, accountId);
  return view.portfolio.services.length === 0 ? null : view;
}

export interface ServicePositions {
  period: PnlPeriod;
  todayOn: CivilDate;
  /** The display currency. */
  currency: string;
  firstOn: CivilDate | null;
  span: { from: CivilDate; to: CivilDate };
  service: ServicePnl;
  /** Every asset a row can name: the catalog, the provider's included. */
  assets: Map<string, InvestmentAsset>;
  /** Every holding of the service: what a closed row is. */
  holdings: Map<string, { assetId: string; product: string; origin: "manual" | "provider" }>;
  /** Every exit up to today: "All closed" (S10). */
  allExits: Exit[];
  /** The dust the reading in force on the period's last day leaves out (V4). */
  dust: { assetId: string; product: string; quantity: string }[];
}

/**
 * The Positions tab (docs/design/investments-ux.md §3.4, U4): the service's P&L of the period with
 * its positions at both ends — open on the last day, and the ones the period sold — from the same
 * engine and inputs as the Overview, so the rows add up to its number (PERS-113 · 1, 4, 5).
 */
export async function servicePositions(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  params: PeriodParams | PnlPeriod,
  now: Date = new Date(),
): Promise<ServicePositions | null> {
  const todayOn = today(ctx.timeZone, now);
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const { loaded } = await loadAll(ctx, todayOn, accountId);
  const one = loaded[0];
  if (!one) return null;
  const { services, display } = await pnlInputs(ctx, [one], period, todayOn);
  const firstOn = firstDayOf([one]);
  const reading = [...one.book.readingRows]
    .filter((row) => row.on <= period.to && row.status !== "pending_zero")
    .at(-1);
  const dust = reading
    ? (await readingPositionsOf(ctx, reading.id))
        .filter((position) =>
          isUnpricedDust({
            valueCents: position.valueCents,
            quantity: parseDecimal(position.quantity, QUANTITY_SCALE),
          }),
        )
        .map((position) => ({
          assetId: position.assetId,
          product: position.product,
          quantity: trimmed(position.quantity),
        }))
    : [];
  return {
    period,
    todayOn,
    currency: display.currency,
    firstOn,
    span: periodSpan(period, firstOn),
    service: pnlOf(services[0], period.from, period.to, display),
    assets: new Map((await listAssets(ctx)).map((asset) => [asset.id, asset])),
    holdings: new Map(
      one.book.holdingRows.map((holding) => [
        holding.id,
        { assetId: holding.assetId, product: holding.product, origin: holding.origin },
      ]),
    ),
    allExits: replayHoldings(one.book, todayOn, services[0].externalIds).exits,
    dust,
  };
}

async function pnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  now: Date,
  only?: string,
): Promise<InvestmentsPnlView> {
  const todayOn = today(ctx.timeZone, now);
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const { loaded, accounts } = await loadAll(ctx, todayOn, only);
  // A service asked by name is shown archived too, as its page always was.
  const live = loaded.filter((one) => only !== undefined || one.account.state !== "archived");
  const { services, display } = await pnlInputs(ctx, live, period, todayOn);
  const measured = services.map((one) => pnlOf(one, period.from, period.to, display));
  const portfolio = portfolioPnl(measured, display.currency);

  const firstOn = firstDayOf(live);
  const span = periodSpan(period, firstOn);
  const { grain: barGrain, intervals } = barIntervals(span.from, span.to);
  const { grain: valueGrain, days } = valueDays(span.from, span.to);

  const read = await dailyBalancesOf(
    ctx,
    live.map((one) => one.account.id),
    { from: days[0], to: days[days.length - 1] },
  );
  const indexOf = new Map(read.days.map((day, index) => [day, index]));
  // The rates of the engine start before the first day measured, so they reach every point.
  const rates = display.rates;

  const chart = live.map((one, at): PnlChartService => {
    const service = services[at];
    const whole = measured[at];
    const estimatedThrough =
      one.book.readingRows.filter((reading) => reading.status === "estimated").at(-1)?.on ?? null;
    const stored = read.series.get(one.account.id)?.values ?? [];
    const values = days.map((day) => {
      const cents = stored[indexOf.get(day) ?? -1] ?? null;
      return cents === null ? null : convertCents(cents, one.account.currency, display.currency, day, rates);
    });

    const bars: (Cents | null)[] = [];
    let before: Cents = 0n;
    intervals.forEach((interval, index) => {
      const from = whole.from;
      if (whole.display === null || from === null || interval.to < from) {
        bars.push(null);
        return;
      }
      const last = index === intervals.length - 1;
      const through = last
        ? whole.display.pnlCents
        : pnlOf(service, from, interval.to, display).display?.pnlCents;
      if (through === null || through === undefined) {
        bars.push(null);
        return;
      }
      bars.push(through - before);
      before = through;
    });
    return {
      accountId: one.account.id,
      bars,
      barsEstimated: intervals.map(
        (interval) => estimatedThrough !== null && interval.from <= estimatedThrough,
      ),
      values,
      valuesEstimated: days.map(
        (day, index) => estimatedThrough !== null && day <= estimatedThrough && values[index] !== null,
      ),
    };
  });

  const order = accounts.filter((account) => account.state !== "archived");
  return {
    period,
    todayOn,
    currency: display.currency,
    portfolio,
    firstOn,
    span,
    barGrain,
    intervals,
    valueGrain,
    valueDays: days,
    chart,
    colorIndex: new Map(order.map((account, index) => [account.id, index])),
  };
}

// ——— The Activity tab (docs/design/investments-ux.md §3.5, U3) ————————————————————————————————————

/** Rows per page of the Activity tab (§3.5): the page of 934 eToro events goes to ≈ 2,000 px. */
export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityQuery {
  /** The period's days; `from` `null` = from the first event ("All"). */
  from: CivilDate | null;
  to: CivilDate;
  family: ActivityFamily | null;
  /** Searched in the asset's name and symbol and in the note. */
  q: string | null;
  /** An asset id: a row of Positions opens the tab filtered on it (§1.1). */
  assetId: string | null;
  /** 1-based. */
  page: number;
}

export interface ActivityRow {
  id: string;
  on: CivilDate;
  origin: string;
  note: string | null;
  family: ActivityFamily;
  /** The leg that says what the event is: `main`, or a trade's `base` (never shown as a leg). */
  leg: DescribedLeg & { holdingId: string | null; amountCents: Cents; validUntil: CivilDate | null };
  adjustmentClass: AdjustmentClass | null;
  transactionId: string | null;
  linked: { payee: string | null; cents: Cents } | null;
  /** The other service of a transfer between the person's accounts (§4.9), if this is one leg. */
  transfer: { accountId: string; accountName: string } | null;
}

export interface ServiceActivity {
  rows: ActivityRow[];
  page: number;
  pages: number;
  /** The events of the period that the search and the chosen chip leave. */
  total: number;
  /** Every event of the service, whatever the period and the filters ("934 since the start"). */
  allTime: number;
  /** Per chip, in the period and with the search: the counts of §3.5. */
  counts: Record<ActivityFamily | "all", number>;
  /** The months of the filtered events, newest first, with how many each holds. */
  months: { month: MonthKey; count: number }[];
  /** The period's money in and out and its fees (every fee leg, also a trade's), in the account's currency. */
  sums: { depositsCents: Cents; withdrawalsCents: Cents; feesCents: Cents };
}

/** The leg that names an event: `main`, else a trade's `base`, else the first by name. */
const describingLeg = sql`case ${investmentOperations.leg} when 'main' then 0 when 'base' then 1 else 2 end`;

/**
 * One page of a service's events (§3.5) and what the tab says about them: paged in the database,
 * newest first by `occurred_at` then `id` — the same order on every page, so a row never shows
 * twice or goes missing between two of them — with the counts of every chip in the period.
 */
export async function serviceActivity(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  query: ActivityQuery,
): Promise<ServiceActivity | null> {
  const db = getDb();
  const investment = (await listInvestmentAccounts(ctx)).find((one) => one.accountId === accountId);
  if (!investment) return null;
  const events = investmentEvents;
  // Written out in full: inside a subquery Drizzle drops the table's name, and a bare "id" would
  // be the inner table's own.
  const eventId = sql.raw(`"investment_events"."id"`);
  const kindOf = sql<OperationKind>`(select o.kind from ${investmentOperations} o where o.event_id = ${eventId} and o.user_id = ${ctx.userId} order by case o.leg when 'main' then 0 when 'base' then 1 else 2 end, o.leg limit 1)`;

  const mine = and(userScoped(ctx).owns(events), eq(events.investmentAccountId, investment.id));
  const inPeriod = and(
    query.from === null ? undefined : gte(events.on, query.from),
    lte(events.on, query.to),
  );
  const term = query.q?.trim() || null;
  const searched =
    term === null
      ? undefined
      : or(
          ilike(events.note, `%${escapeLike(term)}%`),
          exists(
            db
              .select({ one: sql`1` })
              .from(investmentOperations)
              .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
              .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
              .where(
                and(
                  eq(investmentOperations.eventId, eventId),
                  userScoped(ctx).owns(investmentOperations),
                  or(
                    ilike(investmentAssets.name, `%${escapeLike(term)}%`),
                    ilike(investmentAssets.symbol, `%${escapeLike(term)}%`),
                  ),
                ),
              ),
          ),
        );
  const ofAsset =
    query.assetId === null
      ? undefined
      : exists(
          db
            .select({ one: sql`1` })
            .from(investmentOperations)
            .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
            .where(
              and(
                eq(investmentOperations.eventId, eventId),
                userScoped(ctx).owns(investmentOperations),
                eq(investmentHoldings.assetId, query.assetId),
              ),
            ),
        );
  const ofFamily = query.family === null ? undefined : inArray(kindOf, kindsOf(query.family));
  const filtered = and(mine, inPeriod, searched, ofAsset, ofFamily);

  const byKind = db
    .select({ kind: kindOf.as("kind") })
    .from(events)
    .where(and(mine, inPeriod, searched, ofAsset))
    .as("by_kind");
  const byMonth = db
    .select({ month: sql<MonthKey>`to_char(${events.on}, 'YYYY-MM')`.as("month") })
    .from(events)
    .where(filtered)
    .as("by_month");
  const [kindRows, monthRows, [{ allTime }], sumRows] = await Promise.all([
    db
      .select({ kind: byKind.kind, count: count() })
      .from(byKind)
      .groupBy(byKind.kind)
      .orderBy(asc(byKind.kind)),
    db
      .select({ month: byMonth.month, count: count() })
      .from(byMonth)
      .groupBy(byMonth.month)
      .orderBy(desc(byMonth.month)),
    db.select({ allTime: count() }).from(events).where(mine),
    db
      .select({
        kind: investmentOperations.kind,
        cents: sql<string>`coalesce(sum(${investmentOperations.amountCents}), 0)`,
      })
      .from(investmentOperations)
      .innerJoin(events, eq(events.id, investmentOperations.eventId))
      .where(
        and(
          mine,
          inPeriod,
          userScoped(ctx).owns(investmentOperations),
          inArray(investmentOperations.kind, ["deposit", "opening_cash", "withdrawal", "fee"]),
        ),
      )
      .groupBy(investmentOperations.kind)
      .orderBy(asc(investmentOperations.kind)),
  ]);

  const counts = Object.fromEntries(
    [...ACTIVITY_FAMILIES, "all"].map((key) => [key, 0]),
  ) as ServiceActivity["counts"];
  for (const row of kindRows) {
    if (row.kind === null) continue;
    counts[familyOf(row.kind)] += row.count;
    counts.all += row.count;
  }
  const total = monthRows.reduce((sum, row) => sum + row.count, 0);
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page) || 1), pages);
  const sumOf = (...kinds: string[]) =>
    sumRows
      .filter((row) => kinds.includes(row.kind))
      .reduce<Cents>((sum, row) => sum + BigInt(row.cents), 0n);

  const pageRows = await db
    .select()
    .from(events)
    .where(filtered)
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(ACTIVITY_PAGE_SIZE)
    .offset((page - 1) * ACTIVITY_PAGE_SIZE);
  const ids = pageRows.map((row) => row.id);
  const legRows =
    ids.length === 0
      ? []
      : await db
          .select({ op: investmentOperations, holding: investmentHoldings, asset: investmentAssets })
          .from(investmentOperations)
          .leftJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
          .leftJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
          .where(and(inArray(investmentOperations.eventId, ids), userScoped(ctx).owns(investmentOperations)))
          .orderBy(asc(investmentOperations.eventId), asc(describingLeg), asc(investmentOperations.leg));
  const firstLeg = new Map<string, (typeof legRows)[number]>();
  for (const row of legRows) if (!firstLeg.has(row.op.eventId)) firstLeg.set(row.op.eventId, row);

  const transfers = pageRows.some((row) => row.transferGroupId !== null) ? await transferLegs(ctx) : [];
  const accountNames =
    transfers.length === 0
      ? new Map<string, string>()
      : new Map((await listAccounts(ctx, { includeArchived: true })).map((one) => [one.id, one.name]));
  const linked = await transactionsByIds(
    ctx,
    pageRows.flatMap((row) => (row.transactionId ? [row.transactionId] : [])),
  );

  const rows: ActivityRow[] = pageRows.flatMap((event) => {
    const found = firstLeg.get(event.id);
    if (!found) return [];
    const { op, holding, asset } = found;
    const partner =
      event.transferGroupId === null
        ? undefined
        : transfers.find((leg) => leg.transferGroupId === event.transferGroupId && leg.eventId !== event.id);
    const transaction = event.transactionId ? linked.get(event.transactionId) : undefined;
    return [
      {
        id: event.id,
        on: event.on,
        origin: event.origin,
        note: event.note,
        family: familyOf(op.kind),
        leg: {
          kind: op.kind,
          holdingId: op.holdingId,
          assetName: asset?.name ?? null,
          assetClass: asset?.class ?? null,
          product: holding?.product ?? null,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          priceCurrency: op.priceCurrency,
          amountCents: op.amountCents,
          validUntil: op.validUntil,
        },
        adjustmentClass: op.adjustmentClass,
        transactionId: event.transactionId,
        linked: transaction ? { payee: transaction.payee, cents: transaction.amountCents } : null,
        transfer: partner
          ? { accountId: partner.accountId, accountName: accountNames.get(partner.accountId) ?? "" }
          : null,
      },
    ];
  });

  return {
    rows,
    page,
    pages,
    total,
    allTime,
    counts,
    months: monthRows,
    sums: {
      depositsCents: sumOf("deposit", "opening_cash"),
      withdrawalsCents: sumOf("withdrawal"),
      feesCents: sumOf("fee"),
    },
  };
}
