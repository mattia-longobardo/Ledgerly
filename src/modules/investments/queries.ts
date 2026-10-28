import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Account, balancesOn, listAccounts, monthlyPoints } from "@/modules/accounts/queries";
import { monthEndSeries } from "@/modules/accounts/rules";
import { fundsView } from "@/modules/funds/queries";
import { linkCandidates, transactionsByIds } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, lastDayOfMonth, type MonthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { convertCents, type RateTable } from "@/platform/fx/rules";
import { ratesOn } from "@/platform/fx/service";
import { type Cents, sumCents } from "@/platform/money";
import { INVESTMENT_PROVIDERS, type InvestmentProvider, providerOf } from "./catalog";
import {
  type AssetClass,
  type DayValue,
  flowsOn,
  formatDecimal,
  type HoldingState,
  holdingStates,
  type Mode,
  monthsBack,
  type AccountOrigin,
  parseDecimal,
  type Performance,
  performance,
  PRICE_SCALE,
  QUANTITY_SCALE,
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
} from "./service";
import { type SyncStatus, syncStatus } from "./sync";

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
  const measured = performance(flowsOn(one.book, todayOn), valueCents);
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
  };
  months: MonthKey[];
  history: { value: (Cents | null)[]; invested: (Cents | null)[] };
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

/**
 * The home of the section (§4.1): every service with its value in its currency and in the display
 * currency, the totals in the display currency (§1.8), the value-vs-invested chart from the
 * `portfolio` balances, the allocation by asset class and by service, and the funds read only.
 */
export async function investmentsHome(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  now: Date = new Date(),
): Promise<InvestmentsHome> {
  const todayOn = today(ctx.timeZone, now);
  const currency = ctx.displayCurrency;
  const { loaded } = await loadAll(ctx, todayOn);
  const months = monthsBack(todayOn, HISTORY_MONTHS);
  const firstDay = months[0];
  const live = loaded.filter((one) => one.account.state !== "archived");
  const displayRates = await ratesOn(
    live.some((one) => one.account.currency !== currency)
      ? [currency, ...live.map((one) => one.account.currency)]
      : [],
    addDays(firstDay, -7),
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
  const invested = sumCents(
    services.map((one) =>
      convertCents(one.performance.investedCents, one.account.currency, currency, todayOn, displayRates),
    ),
  );
  const gainCents =
    value.total === null || invested.total === null || value.partial || services.some((one) => !one.reliable)
      ? null
      : value.total - invested.total;
  const base = sumCents(
    live.map((one) => {
      const flows = flowsOn(one.book, todayOn);
      return convertCents(
        flows.openingCents + flows.depositedCents,
        one.account.currency,
        currency,
        todayOn,
        displayRates,
      );
    }),
  );

  // The chart: month-end `portfolio` balances (held), and what had gone in by then.
  const points = await monthlyPoints(ctx, todayOn);
  const daysOf = months.map((month, index) =>
    index === months.length - 1 ? todayOn : lastDayOfMonth(month),
  );
  const valueSeries = live.map((one) =>
    monthEndSeries(points.get(one.account.id) ?? [], months, "hold").map((cents, index) =>
      cents === null
        ? null
        : convertCents(cents, one.account.currency, currency, daysOf[index], displayRates),
    ),
  );
  const investedSeries = live.map((one) => {
    const first = one.book.periods[0]?.fromOn ?? null;
    return daysOf.map((day) => {
      if (first === null || day < first) return null;
      const flows = flowsOn(one.book, day);
      return convertCents(
        flows.openingCents + flows.depositedCents - flows.withdrawnCents,
        one.account.currency,
        currency,
        day,
        displayRates,
      );
    });
  });
  const history = {
    value: months.map((_, index) => sumCents(valueSeries.map((series) => series[index])).total),
    invested: months.map((_, index) => sumCents(investedSeries.map((series) => series[index])).total),
  };

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
    totals: {
      valueCents: value.total,
      partial: value.partial,
      investedCents: invested.total,
      gainCents,
      simpleReturn:
        gainCents === null || base.total === null || base.total <= 0n
          ? null
          : Number(gainCents) / Number(base.total),
    },
    months,
    history,
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
  months: MonthKey[];
  history: { value: (Cents | null)[]; invested: (Cents | null)[] };
  /** The connection, its key and what its flows cover (§4.3, §5.3); `null` for a manual service. */
  sync: SyncStatus | null;
  /** Products the provider's latest reading covers: a manual position there would conflict (R4). */
  coveredProducts: string[];
  assets: InvestmentAsset[];
  linkOptions: { out: LinkOption[]; in: LinkOption[] };
}

export interface LinkOption {
  id: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
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
  const months = monthsBack(todayOn, HISTORY_MONTHS);
  const displayRates = await ratesOn(
    one.account.currency !== currency ? [currency, one.account.currency] : [],
    todayOn,
    todayOn,
  );
  const summary = summaryOf(one, todayOn, currency, displayRates);
  summary.weight = null;

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

  // Operations, grouped by event, newest first, with their bank link and their revisions.
  const names = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
  const transactionIds = one.book.eventRows.flatMap((event) =>
    event.transactionId ? [event.transactionId] : [],
  );
  const [linked, revisionRows] = await Promise.all([
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
  ]);
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
    };
  });

  const scopeRows =
    one.book.readingRows.length === 0
      ? []
      : await getDb()
          .select({ readingId: investmentReadingScopes.readingId, product: investmentReadingScopes.product })
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
        ...new Set(scopeRows.filter((row) => row.readingId === reading.id).map((row) => row.product)),
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

  const points = await monthlyPoints(ctx, todayOn);
  const daysOf = months.map((month, index) =>
    index === months.length - 1 ? todayOn : lastDayOfMonth(month),
  );
  const first = one.book.periods[0]?.fromOn ?? null;
  const history = {
    value: monthEndSeries(points.get(one.account.id) ?? [], months, "hold"),
    invested: daysOf.map((day) => {
      if (first === null || day < first) return null;
      const flows = flowsOn(one.book, day);
      return flows.openingCents + flows.depositedCents - flows.withdrawnCents;
    }),
  };

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
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
    months,
    history,
    sync: one.sync,
    coveredProducts,
    assets,
    linkOptions: { out: out.map(option), in: incoming.map(option) },
  };
}

/** For the export and the ⌘K palette: every service by name with its value today. */
export async function investmentServices(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<
  {
    accountId: string;
    name: string;
    category: string;
    provider: string;
    mode: Mode | null;
    currency: string;
    valueCents: Cents | null;
  }[]
> {
  const todayOn = today(ctx.timeZone);
  const { loaded } = await loadAll(ctx, todayOn);
  return loaded.map((one) => ({
    accountId: one.account.id,
    name: one.account.name,
    category: one.investment.category,
    provider: one.investment.provider,
    mode: one.day.mode,
    currency: one.account.currency,
    valueCents: one.day.valueCents,
  }));
}

/** For the export: every operation leg of every service, oldest first. */
export async function investmentOperationsExport(ctx: Pick<Ctx, "userId" | "timeZone">) {
  const todayOn = today(ctx.timeZone);
  const { loaded } = await loadAll(ctx, todayOn);
  return loaded.flatMap((one) => {
    const names = new Map(one.book.holdingRows.map((holding) => [holding.id, holding.asset.name]));
    return one.book.eventRows.flatMap((event) =>
      one.book.operationRows
        .filter((op) => op.eventId === event.id)
        .map((op) => ({
          on: event.on,
          service: one.account.name,
          currency: one.account.currency,
          kind: op.kind,
          leg: op.leg,
          asset: op.holdingId ? (names.get(op.holdingId) ?? null) : null,
          quantity: op.quantity === null ? null : trimmed(op.quantity),
          unitPrice: op.unitPrice === null ? null : trimmed(op.unitPrice),
          amountCents: op.amountCents,
          note: event.note,
        })),
    );
  });
}
