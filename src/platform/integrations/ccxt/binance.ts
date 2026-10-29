/**
 * Binance through ccxt, mapped (docs/design/investments.md §3.2, D18 · B1–B7): pure functions over
 * the raw answers of `client.ts`, validated with zod and tested on the spike's fixtures. No
 * network, no database.
 *
 * Quantities are fixed-point integers of 18 decimals (V8), never floats: ccxt's unified numbers
 * are floats (`2.114e-5`), so the raw strings of `info` are read wherever Binance gives them.
 */
import { z } from "zod";
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import {
  type AssetRef,
  type CoverageWindow,
  type FxLookup,
  type HoldingsSnapshot,
  type KeyCheck,
  type ProviderEvent,
  type ProviderLeg,
  SourceError,
  type SnapshotPosition,
} from "../investments/source";
import { BINANCE_PROVIDER } from "../rules";

export { BINANCE_PROVIDER };

// ——— Decimals ————————————————————————————————————————————————————————————————————————————————

const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** A plain, unsigned decimal string as an integer of 18 decimals; anything else is `null`. */
export function units(input: string | number): bigint | null {
  const text = typeof input === "number" ? plain(input) : input.trim();
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * ONE + BigInt(fraction.padEnd(SCALE, "0").slice(0, SCALE) || "0");
}

function plain(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: SCALE });
}

/** An integer of 18 decimals as a plain decimal string without trailing zeros. */
export function decimal(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const fraction = (abs % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / ONE}${fraction ? `.${fraction}` : ""}`;
}

const mul = (a: bigint, b: bigint) => (a * b) / ONE;
const div = (a: bigint, b: bigint) => (b === 0n ? 0n : (a * ONE) / b);

/** Units of 18 decimals as cents, half away from zero. */
function cents(value: bigint): Cents {
  const scaled = value * 100n;
  const quotient = scaled / ONE;
  const rest = scaled % ONE;
  return rest * 2n >= ONE ? quotient + 1n : quotient;
}

const decimalString = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = units(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a decimal" });
    return z.NEVER;
  }
  return parsed;
});
const millis = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number);
const code = z.string().regex(/^[A-Z0-9]{1,20}$/);

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  // The issues stay here (§5.1): they may quote the provider's body.
  if (!result.success) throw new SourceError(BINANCE_PROVIDER, "schema_mismatch");
  return result.data;
}

// ——— Assets ——————————————————————————————————————————————————————————————————————————————————

/** Fiat currencies Binance holds; with an ECB rate they are cash, never a position to price (§1.8). */
const FIAT = new Set([
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "PLN",
  "CZK",
  "RON",
  "HUF",
  "SEK",
  "NOK",
  "DKK",
  "TRY",
  "BRL",
  "JPY",
  "AUD",
  "CAD",
  "MXN",
  "ZAR",
  "UAH",
]);
/** Stablecoins and the currency they track (A5): a class of their own, never cash, never at par. */
const STABLECOINS: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  FDUSD: "USD",
  BUSD: "USD",
  TUSD: "USD",
  USDP: "USD",
  DAI: "USD",
  USDE: "USD",
  USD1: "USD",
  PYUSD: "USD",
  RLUSD: "USD",
  EURC: "EUR",
  EURI: "EUR",
  AEUR: "EUR",
};
/** The quotes `fetchMyTrades` tries for every discovered asset (B3), plus the account's currency. */
export const TRADE_QUOTES = ["EUR", "USDT", "USDC", "BTC"] as const;

export const isFiat = (asset: string) => FIAT.has(asset);

export function assetRefOf(asset: string, currency: string): AssetRef {
  if (isFiat(asset)) return { externalId: asset, class: "cash", name: asset, symbol: asset, currency: asset };
  const tracked = STABLECOINS[asset];
  if (tracked)
    return { externalId: asset, class: "stablecoin", name: asset, symbol: asset, currency: tracked };
  return { externalId: asset, class: "crypto", name: asset, symbol: asset, currency };
}

// ——— The key (§5.2, B1) ——————————————————————————————————————————————————————————————————————

/** The flags of trading, withdrawal and transfer Binance knows today: all must be `false`. */
export const WRITE_FLAGS = [
  "enableSpotAndMarginTrading",
  "enableWithdrawals",
  "enableFutures",
  "enableMargin",
  "enableInternalTransfer",
  "permitsUniversalTransfer",
  "enableVanillaOptions",
  "enablePortfolioMarginTrading",
  "enableFixApiTrade",
] as const;
/** Permissions that only read: `enableReading` must be on, `enableFixReadOnly` may be. */
export const READ_FLAGS = ["enableReading", "enableFixReadOnly"] as const;
const FLAG = /^(enable|permits)[A-Za-z]+$/;

const restrictionsSchema = z.looseObject({ ipRestrict: z.boolean() });

/**
 * The allowlist of B1: read only when reading is on, every known write flag is off, and no flag
 * Ledgerly does not know is on. A known write flag that is missing cannot be checked, so it is a
 * refusal too. `ignored`: unknown flags that are off, for the log.
 */
export function keyCheckOf(raw: unknown): { check: KeyCheck; ignored: string[] } {
  const body = parse(restrictionsSchema, raw);
  const permissions: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(body)) {
    if (FLAG.test(name) && typeof value === "boolean") permissions[name] = value;
  }
  const known = new Set<string>([...WRITE_FLAGS, ...READ_FLAGS]);
  const unknown = Object.keys(permissions).filter((name) => !known.has(name));
  let result: KeyCheck["result"] = "read-only";
  if (WRITE_FLAGS.some((flag) => permissions[flag] === true)) result = "write";
  else if (
    permissions.enableReading !== true ||
    WRITE_FLAGS.some((flag) => permissions[flag] === undefined) ||
    unknown.some((name) => permissions[name])
  ) {
    result = "unknown-flag";
  }
  return {
    check: { result, permissions, ipRestricted: body.ipRestrict, externalAccountId: null },
    ignored: unknown.filter((name) => !permissions[name]),
  };
}

// ——— Prices (§1.8, B5) ————————————————————————————————————————————————————————————————————————

export interface Quote {
  /** Units of 18 decimals. */
  last: bigint;
  at: Date | null;
}

/** How one unit of an asset becomes the account's currency, as a reading position records it. */
export interface PricePath {
  /** The asset in `priceCurrency`, 18 decimals. */
  price: bigint;
  priceCurrency: string;
  priceSource: string;
  priceAt: Date | null;
  /** Account units per unit of `priceCurrency`; `null` when it already is the account's currency. */
  fxRate: bigint | null;
  fxSource: string | null;
}

/** A market's price, or its inverse (`EUR/USDT` for `USDT` in EUR, B5). */
function direct(
  base: string,
  quote: string,
  quotes: ReadonlyMap<string, Quote>,
): { value: bigint; symbol: string; at: Date | null } | null {
  if (base === quote) return { value: ONE, symbol: `${base}/${quote}`, at: null };
  const straight = quotes.get(`${base}/${quote}`);
  if (straight && straight.last > 0n)
    return { value: straight.last, symbol: `${base}/${quote}`, at: straight.at };
  const inverse = quotes.get(`${quote}/${base}`);
  if (inverse && inverse.last > 0n)
    return { value: div(ONE, inverse.last), symbol: `${quote}/${base}`, at: inverse.at };
  return null;
}

/**
 * The rule of §1.8 for a coin and the account's currency `K`, in order: the pair `X/K` (or its
 * inverse); `X/USDT` or `X/USDC` then that stablecoin in `K` on the exchange, or the stablecoin in
 * USD on the exchange × the ECB rate USD→K — never a stablecoin at par; the ECB rate for fiat.
 * `null` when no path prices it: the position is then unpriced, never zero.
 */
export function pricePath(
  asset: string,
  currency: string,
  quotes: ReadonlyMap<string, Quote>,
  fx: FxLookup | undefined,
  on: CivilDate,
  source = "binance",
): PricePath | null {
  if (asset === currency) {
    return {
      price: ONE,
      priceCurrency: currency,
      priceSource: "par",
      priceAt: null,
      fxRate: null,
      fxSource: null,
    };
  }
  if (isFiat(asset)) {
    const rate = fx?.(asset, currency, on) ?? null;
    const value = rate === null ? null : units(rate);
    return value === null
      ? null
      : {
          price: value,
          priceCurrency: currency,
          priceSource: `ecb:${on}`,
          priceAt: null,
          fxRate: null,
          fxSource: null,
        };
  }
  const own = direct(asset, currency, quotes);
  if (own) {
    return {
      price: own.value,
      priceCurrency: currency,
      priceSource: `${source}:${own.symbol}`,
      priceAt: own.at,
      fxRate: null,
      fxSource: null,
    };
  }
  for (const stable of ["USDT", "USDC"]) {
    const leg = direct(asset, stable, quotes);
    if (!leg) continue;
    const toAccount = direct(stable, currency, quotes);
    if (toAccount) {
      return {
        price: leg.value,
        priceCurrency: stable,
        priceSource: `${source}:${leg.symbol}`,
        priceAt: leg.at,
        fxRate: toAccount.value,
        fxSource: `exchange:${toAccount.symbol}${toAccount.at ? `@${toAccount.at.toISOString()}` : ""}`,
      };
    }
    const toUsd = direct(stable, "USD", quotes);
    const usd = currency === "USD" ? "1" : (fx?.("USD", currency, on) ?? null);
    const usdRate = usd === null ? null : units(usd);
    if (toUsd && usdRate !== null) {
      return {
        price: leg.value,
        priceCurrency: stable,
        priceSource: `${source}:${leg.symbol}`,
        priceAt: leg.at,
        fxRate: mul(toUsd.value, usdRate),
        fxSource: `exchange:${toUsd.symbol}${toUsd.at ? `@${toUsd.at.toISOString()}` : ""}*ecb:${on}`,
      };
    }
  }
  return null;
}

/** The symbols `fetchTickers` needs to price every asset in `currency` (§1.8): only existing markets. */
export function tickerSymbols(
  assets: Iterable<string>,
  currency: string,
  markets: ReadonlySet<string>,
): string[] {
  const wanted = new Set<string>();
  const both = (a: string, b: string) => {
    if (markets.has(`${a}/${b}`)) wanted.add(`${a}/${b}`);
    if (markets.has(`${b}/${a}`)) wanted.add(`${b}/${a}`);
  };
  for (const stable of ["USDT", "USDC"]) {
    both(stable, currency);
    both(stable, "USD");
  }
  for (const asset of assets) {
    if (asset === currency || isFiat(asset)) continue;
    both(asset, currency);
    both(asset, "USDT");
    both(asset, "USDC");
  }
  return [...wanted].sort();
}

const tickersSchema = z.record(
  z.string(),
  z.looseObject({
    last: z.number().nullable().optional(),
    close: z.number().nullable().optional(),
    timestamp: z.number().nullable().optional(),
  }),
);

export function quotesOf(raw: unknown): Map<string, Quote> {
  const quotes = new Map<string, Quote>();
  for (const [symbol, ticker] of Object.entries(parse(tickersSchema, raw))) {
    const value = ticker.last ?? ticker.close ?? null;
    const last = value === null ? null : units(value);
    if (last === null || last === 0n) continue;
    quotes.set(symbol, {
      last,
      at: typeof ticker.timestamp === "number" ? new Date(ticker.timestamp) : null,
    });
  }
  return quotes;
}

// ——— Holdings (§3.2, B4, B5, B6) —————————————————————————————————————————————————————————————

const accountSchema = z.looseObject({
  uid: z.union([z.number(), z.string()]).transform(String),
  balances: z.array(z.looseObject({ asset: code, free: decimalString, locked: decimalString })),
});
const fundingSchema = z.array(
  z.looseObject({
    asset: code,
    free: decimalString,
    locked: decimalString.optional(),
    freeze: decimalString.optional(),
    withdrawing: decimalString.optional(),
  }),
);
const walletsSchema = z.array(
  z.looseObject({
    walletName: z.string().min(1).max(60),
    balance: decimalString,
    activate: z.boolean().optional(),
  }),
);
const earnFlexibleSchema = z.looseObject({
  total: z.union([z.number(), z.string()]).transform(Number),
  rows: z.array(z.looseObject({ asset: code, totalAmount: decimalString })),
});
const earnLockedSchema = z.looseObject({
  total: z.union([z.number(), z.string()]).transform(Number),
  rows: z.array(z.looseObject({ asset: code, amount: decimalString })),
});

export type EarnPage = { total: number; rows: { asset: string; quantity: bigint }[] };

export function earnPageOf(raw: unknown, kind: "flexible" | "locked"): EarnPage {
  if (kind === "flexible") {
    const body = parse(earnFlexibleSchema, raw);
    return {
      total: body.total,
      rows: body.rows.map((row) => ({ asset: row.asset, quantity: row.totalAmount })),
    };
  }
  const body = parse(earnLockedSchema, raw);
  return { total: body.total, rows: body.rows.map((row) => ({ asset: row.asset, quantity: row.amount })) };
}

/** The wallets the adapter reads (B4); any other with a value makes the reading partial. */
const READ_WALLETS: Record<string, string> = { Spot: "spot", Funding: "funding", Earn: "earn" };

/** A wallet's name as the label of a product it does not read: `other:usd-m-futures`. */
export function walletProduct(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `other:${slug || "wallet"}`;
}

/** Dust (B5): too little to price, or worth less than a cent — visible, never a partial reading. */
const DUST_QUANTITY = units("0.001")!;

export interface BalancesRead {
  uid: string;
  /** Quantity by asset and product, > 0 only (B6). */
  quantities: { asset: string; product: string; quantity: bigint }[];
}

/** The quantities of Spot, Funding and Earn, > 0 only (B6), from the raw answers. */
export function balancesOf(input: {
  account: unknown;
  funding: unknown;
  earnFlexible: readonly EarnPage[];
  earnLocked: readonly EarnPage[];
}): BalancesRead {
  const account = parse(accountSchema, input.account);
  const funding = parse(fundingSchema, input.funding);
  const sums = new Map<string, bigint>();
  const add = (asset: string, product: string, quantity: bigint) => {
    if (quantity <= 0n) return;
    const key = `${product}|${asset}`;
    sums.set(key, (sums.get(key) ?? 0n) + quantity);
  };
  const flexible = new Set(input.earnFlexible.flatMap((page) => page.rows.map((row) => row.asset)));
  for (const row of account.balances) {
    // An `LD<X>` balance is a flexible Earn position the Earn call already counts: never twice.
    const ld = /^LD([A-Z0-9]+)$/.exec(row.asset);
    if (ld && flexible.has(ld[1])) continue;
    add(row.asset, "spot", row.free + row.locked);
  }
  for (const row of funding) {
    add(row.asset, "funding", row.free + (row.locked ?? 0n) + (row.freeze ?? 0n) + (row.withdrawing ?? 0n));
  }
  for (const page of [...input.earnFlexible, ...input.earnLocked]) {
    for (const row of page.rows) add(row.asset, "earn", row.quantity);
  }
  const quantities = [...sums.entries()]
    .map(([key, quantity]) => {
      const [product, asset] = key.split("|");
      return { asset, product, quantity };
    })
    .sort((a, b) => (a.asset === b.asset ? (a.product < b.product ? -1 : 1) : a.asset < b.asset ? -1 : 1));
  return { uid: account.uid, quantities };
}

/**
 * The reading of a pass (R1): the quantities priced in the account's currency with the path of
 * §1.8, the scope Spot/Funding/Earn, and every other wallet with a value as a product not read (B4).
 */
export function holdingsOf(input: {
  balances: BalancesRead;
  wallets: unknown;
  quotes: ReadonlyMap<string, Quote>;
  currency: string;
  fx?: FxLookup;
  observedAt: Date;
  on: CivilDate;
}): HoldingsSnapshot {
  const { balances, currency } = input;
  const wallets = parse(walletsSchema, input.wallets);
  const positions: SnapshotPosition[] = [];
  let total = 0n;
  let cash = 0n;
  let priced = true;
  for (const one of balances.quantities) {
    const path = pricePath(one.asset, currency, input.quotes, input.fx, input.on);
    const ref = assetRefOf(one.asset, currency);
    let valueCents: Cents | null = null;
    if (path) {
      valueCents = cents(mul(mul(one.quantity, path.price), path.fxRate ?? ONE));
      total += valueCents;
      if (ref.class === "cash") cash += valueCents;
    } else if (one.quantity >= DUST_QUANTITY) {
      priced = false;
    }
    positions.push({
      asset: ref,
      product: one.product,
      quantity: decimal(one.quantity),
      price: path ? decimal(path.price) : null,
      priceCurrency: path?.priceCurrency ?? null,
      priceSource: path?.priceSource ?? "binance:none",
      valueCents,
      priceAt: path?.priceAt ?? null,
      fxRate: path?.fxRate === null || path?.fxRate === undefined ? null : decimal(path.fxRate),
      fxSource: path?.fxSource ?? null,
    });
  }
  const earnRead = balances.quantities.some((one) => one.product === "earn");
  const scopes = [
    { product: "spot", complete: true },
    { product: "funding", complete: true },
    // An Earn wallet with a value and no position Ledgerly can read: a product it does not cover.
    {
      product: "earn",
      complete: earnRead || !wallets.some((one) => one.walletName === "Earn" && one.balance > 0n),
    },
  ];
  for (const wallet of wallets) {
    if (READ_WALLETS[wallet.walletName] || wallet.balance <= 0n) continue;
    scopes.push({ product: walletProduct(wallet.walletName), complete: false });
  }
  return {
    observedAt: input.observedAt,
    externalAccountId: balances.uid,
    totalCents: total,
    cashCents: cash,
    positions,
    scopes,
    empty: positions.length === 0 && wallets.every((one) => one.balance <= 0n),
    complete: priced && scopes.every((scope) => scope.complete),
  };
}

// ——— Flows (§3.2, B2, B3, B7) ————————————————————————————————————————————————————————————————

const transferSchema = z.array(
  z.looseObject({
    id: z.union([z.string(), z.number()]).transform(String),
    timestamp: z.number(),
    currency: code,
    status: z.string().nullable(),
    info: z.looseObject({
      amount: decimalString,
      transactionFee: decimalString.optional(),
    }),
  }),
);

export interface StreamRows {
  events: ProviderEvent[];
  /** Assets the rows name, for the discovery of the markets (B3). */
  assets: string[];
  /** The time of the oldest row still pending: the next pass reads again from there. */
  pendingFrom: number | null;
}

const leg = (
  fields: Partial<ProviderLeg> & Pick<ProviderLeg, "leg" | "kind" | "nativeAmount" | "nativeCurrency">,
): ProviderLeg => ({
  asset: null,
  product: null,
  quantity: null,
  unitPrice: null,
  priceCurrency: null,
  ...fields,
});

/** A coin moving in or out of the account: a leg with its quantity, or a cash leg for fiat. */
function coinLeg(
  name: ProviderLeg["leg"],
  kind: ProviderLeg["kind"],
  asset: string,
  quantity: bigint,
  currency: string,
  extra: Partial<ProviderLeg> = {},
): ProviderLeg {
  if (isFiat(asset))
    return leg({ leg: name, kind, nativeAmount: decimal(quantity), nativeCurrency: asset, ...extra });
  return leg({
    leg: name,
    kind,
    asset: assetRefOf(asset, currency),
    product: "spot",
    quantity: decimal(quantity),
    nativeAmount: decimal(quantity),
    nativeCurrency: asset,
    ...extra,
  });
}

/** Crypto deposits and withdrawals (B7): one event each, the network fee as a leg of the coin. */
export function transferEventsOf(raw: unknown, kind: "deposit" | "withdrawal", currency: string): StreamRows {
  const rows = parse(transferSchema, raw);
  const events: ProviderEvent[] = [];
  let pendingFrom: number | null = null;
  for (const row of rows) {
    if (row.status === "pending") {
      pendingFrom = pendingFrom === null ? row.timestamp : Math.min(pendingFrom, row.timestamp);
      continue;
    }
    if (row.status !== "ok" || row.info.amount <= 0n) continue;
    const legs = [coinLeg("main", kind, row.currency, row.info.amount, currency)];
    const fee = row.info.transactionFee ?? 0n;
    if (kind === "withdrawal" && fee > 0n) legs.push(coinLeg("fee", "fee", row.currency, fee, currency));
    events.push({ externalId: `${kind}:${row.id}`, occurredAt: new Date(row.timestamp), note: null, legs });
  }
  return { events, assets: rows.map((row) => row.currency), pendingFrom };
}

const fiatOrdersSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        orderNo: z.string().min(1).max(100),
        fiatCurrency: code,
        indicatedAmount: decimalString,
        amount: decimalString,
        totalFee: decimalString,
        status: z.string(),
        createTime: millis,
      }),
    )
    .nullable()
    .optional(),
});

/** One page of SEPA orders (B2) and whether another follows. */
export function fiatOrderEventsOf(
  raw: unknown,
  type: 0 | 1,
  pageSize: number,
): StreamRows & { full: boolean } {
  const rows = parse(fiatOrdersSchema, raw).data ?? [];
  const events: ProviderEvent[] = [];
  let pendingFrom: number | null = null;
  for (const row of rows) {
    if (row.status === "Processing") {
      pendingFrom = pendingFrom === null ? row.createTime : Math.min(pendingFrom, row.createTime);
      continue;
    }
    if (row.status !== "Successful") continue;
    // A deposit: what was sent, then the fee; a withdrawal: what arrived, then the fee (B2).
    const main = type === 0 ? row.indicatedAmount : row.amount;
    if (main <= 0n) continue;
    const legs = [
      leg({
        leg: "main",
        kind: type === 0 ? "deposit" : "withdrawal",
        nativeAmount: decimal(main),
        nativeCurrency: row.fiatCurrency,
      }),
    ];
    if (row.totalFee > 0n) {
      legs.push(
        leg({
          leg: "fee",
          kind: "fee",
          nativeAmount: decimal(row.totalFee),
          nativeCurrency: row.fiatCurrency,
        }),
      );
    }
    events.push({
      externalId: `fiat:${row.orderNo}`,
      occurredAt: new Date(row.createTime),
      note: "SEPA",
      legs,
    });
  }
  return { events, assets: rows.map((row) => row.fiatCurrency), pendingFrom, full: rows.length >= pageSize };
}

const fiatPaymentsSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        orderNo: z.string().min(1).max(100),
        sourceAmount: decimalString,
        fiatCurrency: code,
        obtainAmount: decimalString,
        cryptoCurrency: code,
        totalFee: decimalString,
        price: decimalString,
        status: z.string(),
        createTime: millis,
      }),
    )
    .nullable()
    .optional(),
});

/**
 * Card purchases (B2): the money comes from the card, not from the account, so the event is the
 * money in (`quote`, a deposit), the coin bought with it (`base`) and the fee.
 */
export function fiatPaymentEventsOf(
  raw: unknown,
  currency: string,
  pageSize: number,
): StreamRows & { full: boolean } {
  const rows = parse(fiatPaymentsSchema, raw).data ?? [];
  const events: ProviderEvent[] = [];
  let pendingFrom: number | null = null;
  for (const row of rows) {
    if (row.status === "Processing") {
      pendingFrom = pendingFrom === null ? row.createTime : Math.min(pendingFrom, row.createTime);
      continue;
    }
    if (row.status !== "Completed" || row.obtainAmount <= 0n) continue;
    const spent = row.sourceAmount - row.totalFee;
    const legs = [
      leg({
        leg: "quote",
        kind: "deposit",
        nativeAmount: decimal(row.sourceAmount),
        nativeCurrency: row.fiatCurrency,
      }),
      coinLeg("base", "buy", row.cryptoCurrency, row.obtainAmount, currency, {
        nativeAmount: decimal(spent > 0n ? spent : 0n),
        nativeCurrency: row.fiatCurrency,
        unitPrice: decimal(row.price),
        priceCurrency: row.fiatCurrency,
      }),
    ];
    if (row.totalFee > 0n) {
      legs.push(
        leg({
          leg: "fee",
          kind: "fee",
          nativeAmount: decimal(row.totalFee),
          nativeCurrency: row.fiatCurrency,
        }),
      );
    }
    events.push({
      externalId: `card:${row.orderNo}`,
      occurredAt: new Date(row.createTime),
      note: "Card",
      legs,
    });
  }
  return {
    events,
    assets: rows.flatMap((row) => [row.fiatCurrency, row.cryptoCurrency]),
    pendingFrom,
    full: rows.length >= pageSize,
  };
}

const convertSchema = z.looseObject({
  list: z
    .array(
      z.looseObject({
        orderId: z.union([z.string(), z.number()]).transform(String),
        orderStatus: z.string(),
        fromAsset: code,
        fromAmount: decimalString,
        toAsset: code,
        toAmount: decimalString,
        createTime: millis,
      }),
    )
    .nullable()
    .optional(),
});

/** Convert (B2): a trade — the asset received bought, the asset given sold, valued on one side. */
export function convertEventsOf(raw: unknown, currency: string): StreamRows & { count: number } {
  const rows = parse(convertSchema, raw).list ?? [];
  const events: ProviderEvent[] = [];
  for (const row of rows) {
    if (row.orderStatus !== "SUCCESS" || row.fromAmount <= 0n || row.toAmount <= 0n) continue;
    // The value of the trade: the fiat side when there is one, otherwise what was received.
    const [valueAmount, valueCurrency] = isFiat(row.fromAsset)
      ? [row.fromAmount, row.fromAsset]
      : [row.toAmount, row.toAsset];
    const common = { nativeAmount: decimal(valueAmount), nativeCurrency: valueCurrency };
    const legs: ProviderLeg[] = [];
    if (!isFiat(row.toAsset)) legs.push(coinLeg("base", "buy", row.toAsset, row.toAmount, currency, common));
    if (!isFiat(row.fromAsset))
      legs.push(coinLeg("quote", "sell", row.fromAsset, row.fromAmount, currency, common));
    if (legs.length === 0) continue;
    events.push({
      externalId: `convert:${row.orderId}`,
      occurredAt: new Date(row.createTime),
      note: "Convert",
      legs,
    });
  }
  return {
    events,
    assets: rows.flatMap((row) => [row.fromAsset, row.toAsset]),
    pendingFrom: null,
    count: rows.length,
  };
}

const dividendsSchema = z.looseObject({
  rows: z
    .array(
      z.looseObject({
        id: z.union([z.string(), z.number()]).transform(String),
        asset: code,
        amount: decimalString,
        divTime: millis,
        enInfo: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

/** Rewards, staking, airdrops, Launchpool (B2): `income` with the coin's quantity. */
export function dividendEventsOf(
  raw: unknown,
  currency: string,
): StreamRows & { count: number; oldest: number | null } {
  const rows = parse(dividendsSchema, raw).rows ?? [];
  const events: ProviderEvent[] = [];
  for (const row of rows) {
    if (row.amount <= 0n) continue;
    const note = row.enInfo?.trim().slice(0, 200) || null;
    events.push({
      externalId: `dividend:${row.id}`,
      occurredAt: new Date(row.divTime),
      note,
      legs: [coinLeg("main", "income", row.asset, row.amount, currency)],
    });
  }
  const oldest = rows.length === 0 ? null : Math.min(...rows.map((row) => row.divTime));
  return { events, assets: rows.map((row) => row.asset), pendingFrom: null, count: rows.length, oldest };
}

const dustSchema = z.looseObject({
  userAssetDribblets: z
    .array(
      z.looseObject({
        userAssetDribbletDetails: z.array(
          z.looseObject({
            transId: z.union([z.string(), z.number()]).transform(String),
            fromAsset: code,
            amount: decimalString,
            transferedAmount: decimalString,
            serviceChargeAmount: decimalString,
            operateTime: millis,
          }),
        ),
      }),
    )
    .nullable()
    .optional(),
});

const DUST_TARGET = "BNB";

/**
 * Small balances converted to BNB (PERS-141): one event per coin given, the coin sold and the BNB
 * bought. `transferedAmount` is what reached the wallet after the charge, so the BNB leg is the
 * gross and the charge a fee leg, as in a trade; a fiat coin given (EUR) leaves no leg, as in Convert.
 */
export function dustEventsOf(raw: unknown, currency: string): StreamRows {
  const details = (parse(dustSchema, raw).userAssetDribblets ?? []).flatMap(
    (one) => one.userAssetDribbletDetails,
  );
  const events: ProviderEvent[] = [];
  for (const row of details) {
    if (row.amount <= 0n || row.transferedAmount <= 0n) continue;
    const gross = row.transferedAmount + row.serviceChargeAmount;
    const value = { nativeAmount: decimal(gross), nativeCurrency: DUST_TARGET };
    const legs: ProviderLeg[] = [coinLeg("base", "buy", DUST_TARGET, gross, currency, value)];
    if (!isFiat(row.fromAsset))
      legs.push(coinLeg("quote", "sell", row.fromAsset, row.amount, currency, value));
    if (row.serviceChargeAmount > 0n)
      legs.push(coinLeg("fee", "fee", DUST_TARGET, row.serviceChargeAmount, currency));
    events.push({
      externalId: `dust:${row.transId}:${row.fromAsset}`,
      occurredAt: new Date(row.operateTime),
      note: "Dust to BNB",
      legs,
    });
  }
  return { events, assets: [DUST_TARGET, ...details.map((row) => row.fromAsset)], pendingFrom: null };
}

const paySchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        transactionId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
        orderType: z.string().max(40),
        transactionTime: millis,
        amount: z.string().regex(/^-?\d+(\.\d+)?$/),
        currency: code,
        fundsDetail: z
          .array(z.looseObject({ currency: code, amount: decimalString }))
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});

/**
 * Binance Pay (PERS-141): one event per order, a leg per coin it moved (`fundsDetail`). A `TAX`
 * order (the yearly stamp duty Binance collects for Italy) is a cost of holding, so a fee; any
 * other order is money leaving (`amount` < 0) or reaching the account. With one coin, the order's
 * own amount values it.
 */
export function payEventsOf(
  raw: unknown,
  currency: string,
): StreamRows & { count: number; oldest: number | null } {
  const rows = parse(paySchema, raw).data ?? [];
  const events: ProviderEvent[] = [];
  for (const row of rows) {
    const out = row.amount.startsWith("-");
    const total = units(out ? row.amount.slice(1) : row.amount);
    const funds = (row.fundsDetail ?? []).filter((one) => one.amount > 0n);
    if (total === null || total <= 0n || funds.length === 0) continue;
    const kind: ProviderLeg["kind"] = row.orderType === "TAX" ? "fee" : out ? "withdrawal" : "deposit";
    const value = funds.length === 1 ? { nativeAmount: decimal(total), nativeCurrency: row.currency } : {};
    events.push({
      externalId: `pay:${row.transactionId}`,
      occurredAt: new Date(row.transactionTime),
      note: `Binance Pay ${row.orderType}`.slice(0, 200),
      legs: funds.map((one) => coinLeg("main", kind, one.currency, one.amount, currency, value)),
    });
  }
  const oldest = rows.length === 0 ? null : Math.min(...rows.map((row) => row.transactionTime));
  return {
    events,
    assets: rows.flatMap((row) => (row.fundsDetail ?? []).map((one) => one.currency)),
    pendingFrom: null,
    count: rows.length,
    oldest,
  };
}

const tradesSchema = z.array(
  z.looseObject({
    timestamp: z.number(),
    symbol: z.string().regex(/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/),
    side: z.enum(["buy", "sell"]),
    info: z.looseObject({
      symbol: z.string().regex(/^[A-Z0-9]{2,40}$/),
      id: z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number),
      price: decimalString,
      qty: decimalString,
      quoteQty: decimalString,
      commission: decimalString,
      commissionAsset: code.nullable(),
    }),
  }),
);

/**
 * A market's trades (A6): one event per trade, id `trade:<market>:<id>`, the base bought or sold,
 * the quote the other way unless it is cash, the commission as a leg of its own coin (BNB).
 */
export function tradeEventsOf(
  raw: unknown,
  currency: string,
): StreamRows & { lastId: number | null; count: number } {
  const rows = parseTrades(raw);
  const events: ProviderEvent[] = [];
  for (const row of rows) {
    const [base, quote] = row.symbol.split("/");
    const { info } = row;
    if (info.qty <= 0n) continue;
    const value = { nativeAmount: decimal(info.quoteQty), nativeCurrency: quote };
    const buy = row.side === "buy";
    const legs: ProviderLeg[] = [
      coinLeg("base", buy ? "buy" : "sell", base, info.qty, currency, {
        ...value,
        unitPrice: decimal(info.price),
        priceCurrency: quote,
      }),
    ];
    if (!isFiat(quote))
      legs.push(coinLeg("quote", buy ? "sell" : "buy", quote, info.quoteQty, currency, value));
    if (info.commission > 0n && info.commissionAsset) {
      legs.push(coinLeg("fee", "fee", info.commissionAsset, info.commission, currency));
    }
    events.push({
      externalId: `trade:${info.symbol}:${info.id}`,
      occurredAt: new Date(row.timestamp),
      note: null,
      legs,
    });
  }
  const lastId = rows.length === 0 ? null : Math.max(...rows.map((row) => row.info.id));
  return {
    events,
    assets: rows.flatMap((row) => [
      ...row.symbol.split("/"),
      ...(row.info.commissionAsset ? [row.info.commissionAsset] : []),
    ]),
    pendingFrom: null,
    lastId,
    count: rows.length,
  };
}

function parseTrades(raw: unknown) {
  return parse(tradesSchema, raw);
}

/** The markets `fetchMyTrades` reads (B3): every asset seen, against the usual quotes, if listed. */
export function tradeSymbols(
  assets: Iterable<string>,
  currency: string,
  markets: ReadonlySet<string>,
): string[] {
  const quotes = [...new Set([currency, ...TRADE_QUOTES])];
  const symbols = new Set<string>();
  const seen = new Set(assets);
  for (const asset of seen) {
    for (const quote of quotes) {
      if (asset === quote) continue;
      if (markets.has(`${asset}/${quote}`)) symbols.add(`${asset}/${quote}`);
      // The same pair the other way round (`EUR/USDT` for EUR from SEPA and USDT).
      if (markets.has(`${quote}/${asset}`)) symbols.add(`${quote}/${asset}`);
    }
  }
  return [...symbols].sort();
}

// ——— Valuing the legs (§1.8) —————————————————————————————————————————————————————————————————

const candlesSchema = z.array(
  z.tuple([z.number(), z.unknown(), z.unknown(), z.unknown(), z.number()]).rest(z.unknown()),
);

/** Daily closes of a market by UTC day. */
export function closesOf(raw: unknown): Map<CivilDate, bigint> {
  const closes = new Map<CivilDate, bigint>();
  for (const candle of parse(candlesSchema, raw)) {
    const value = units(candle[4]);
    if (value === null || value === 0n) continue;
    closes.set(new Date(candle[0]).toISOString().slice(0, 10) as CivilDate, value);
  }
  return closes;
}

/** The closes of the markets a pass fetched, as a lookup of a coin's value on a day (§1.8). */
export interface DailyPrices {
  /** `symbol` → closes by day. */
  closes: ReadonlyMap<string, ReadonlyMap<CivilDate, bigint>>;
  markets: ReadonlySet<string>;
}

/** The markets a coin's daily value needs, in the order of §1.8: `X/K`, then via USDT or USDC. */
export function candleSymbols(asset: string, currency: string, markets: ReadonlySet<string>): string[] {
  const has = (a: string, b: string) =>
    markets.has(`${a}/${b}`) ? `${a}/${b}` : markets.has(`${b}/${a}`) ? `${b}/${a}` : null;
  const own = has(asset, currency);
  if (own) return [own];
  for (const stable of ["USDT", "USDC"]) {
    const first = asset === stable ? null : has(asset, stable);
    if (asset !== stable && first === null) continue;
    const second = has(stable, currency) ?? has(stable, "USD");
    if (second) return first ? [first, second] : [second];
  }
  return [];
}

function closeOn(
  prices: DailyPrices,
  a: string,
  b: string,
  on: CivilDate,
): { value: bigint; symbol: string } | null {
  if (a === b) return { value: ONE, symbol: `${a}/${b}` };
  const straight = prices.closes.get(`${a}/${b}`)?.get(on);
  if (straight) return { value: straight, symbol: `${a}/${b}` };
  const inverse = prices.closes.get(`${b}/${a}`)?.get(on);
  if (inverse) return { value: div(ONE, inverse), symbol: `${b}/${a}` };
  return null;
}

/** A coin in the account's currency on a day, from the daily closes and, for USD, the ECB (§1.8). */
export function dailyRate(
  asset: string,
  currency: string,
  on: CivilDate,
  prices: DailyPrices,
  fx: FxLookup,
): { rate: bigint; source: string } | null {
  const own = closeOn(prices, asset, currency, on);
  if (own) return { rate: own.value, source: `exchange:${own.symbol}@${on}` };
  for (const stable of ["USDT", "USDC"]) {
    const first = closeOn(prices, asset, stable, on);
    if (!first) continue;
    const toAccount = closeOn(prices, stable, currency, on);
    if (toAccount) {
      return {
        rate: mul(first.value, toAccount.value),
        source: `exchange:${first.symbol}*${toAccount.symbol}@${on}`,
      };
    }
    const toUsd = closeOn(prices, stable, "USD", on);
    const usd = currency === "USD" ? "1" : fx("USD", currency, on);
    const usdRate = usd === null ? null : units(usd);
    if (toUsd && usdRate !== null) {
      return {
        rate: mul(mul(first.value, toUsd.value), usdRate),
        source: `exchange:${first.symbol}*${toUsd.symbol}@${on}*ecb`,
      };
    }
  }
  return null;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/**
 * Prices every leg whose native currency is a coin (A5): the account units per coin at the daily
 * close of its day, with its source. A fiat leg is left to the module, which converts it at the
 * ECB rate; a coin with no market keeps its quantity and no amount (`fxSource` "unpriced"). A unit
 * price in a coin's quote (USDT) becomes a price in the account's currency, the only kind the
 * operations keep.
 */
export function priceLegs(
  events: readonly ProviderEvent[],
  currency: string,
  prices: DailyPrices,
  fx: FxLookup,
): ProviderEvent[] {
  return events.map((event) => {
    const on = event.occurredAt.toISOString().slice(0, 10) as CivilDate;
    return {
      ...event,
      legs: event.legs.map((one) => {
        if (one.nativeCurrency === currency || isFiat(one.nativeCurrency)) {
          if (one.priceCurrency !== null && !ISO_CURRENCY.test(one.priceCurrency)) {
            return { ...one, unitPrice: null, priceCurrency: null };
          }
          return one;
        }
        const rate = dailyRate(one.nativeCurrency, currency, on, prices, fx);
        if (!rate)
          return { ...one, unitPrice: null, priceCurrency: null, fxRate: null, fxSource: "unpriced" };
        let { unitPrice, priceCurrency } = one;
        if (unitPrice !== null && priceCurrency !== null && !ISO_CURRENCY.test(priceCurrency)) {
          const inQuote = units(unitPrice);
          unitPrice = inQuote === null ? null : decimal(mul(inQuote, rate.rate));
          priceCurrency = unitPrice === null ? null : currency;
        }
        return { ...one, unitPrice, priceCurrency, fxRate: decimal(rate.rate), fxSource: rate.source };
      }),
    };
  });
}

// ——— Windows and coverage (A7, D11) ————————————————————————————————————————————————————————————

const DAY_MS = 86_400_000;
/**
 * 12 months of history for ccxt (PERS-141, replaces the 24 of D11): what a connection rebuilds;
 * everything older is the opening, inferred on the first day, never rebuilt.
 */
export const HISTORY_DAYS = 365;
/** A7: each pass reads again the last 24 hours of every stream. */
export const OVERLAP_MS = DAY_MS;
/** The day Binance opened: where the history before the 12 months, the opening, starts. */
export const BINANCE_SINCE = new Date("2017-07-14T00:00:00Z");

/** `[from, until]` cut in windows of at most `days` days (B7: 90 for deposits, 30 for Convert). */
export function windowsOf(from: number, until: number, days: number): { since: number; until: number }[] {
  const windows: { since: number; until: number }[] = [];
  const span = days * DAY_MS;
  for (let since = from; since < until; since += span) {
    windows.push({ since, until: Math.min(since + span - 1, until) });
  }
  return windows;
}

/** The first moment a fresh connection reads: 12 months before now (PERS-141). */
export function historyStart(now: Date): Date {
  return new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
}

/** Binance Pay keeps 18 months of orders (PERS-141): the first day a pass may ask for. */
export const PAY_HISTORY_DAYS = 540;

/**
 * Every stream complete from the start of the history; before it, the opening (`opening_12m`).
 * A stream the API keeps for less (`starts`) is complete from where it was first read.
 */
export function binanceCoverage(
  streams: readonly string[],
  from: Date,
  now: Date,
  starts: Readonly<Record<string, Date>> = {},
): CoverageWindow[] {
  return streams.flatMap((stream) => {
    const start = starts[stream] && starts[stream] > from ? starts[stream] : from;
    const reason = start > from ? "api_limit_18m" : "opening_12m";
    return [
      { stream, fromAt: BINANCE_SINCE, toAt: start, status: "gap" as const, reason },
      { stream, fromAt: start, toAt: now, status: "complete" as const, reason: null },
    ];
  });
}

export const FLOW_STREAMS = [
  "deposits",
  "withdrawals",
  "fiat_orders",
  "fiat_payments",
  "convert",
  "dividends",
  "dust",
  "pay",
  "trades",
] as const;

const QUANTITY_SIGN: Partial<Record<ProviderLeg["kind"], 1n | -1n>> = {
  deposit: 1n,
  buy: 1n,
  income: 1n,
  withdrawal: -1n,
  sell: -1n,
  fee: -1n,
  close: -1n,
};

/** Σ of the legs' quantities by coin (A6): what the events move, for the check against a reading. */
export function netQuantities(events: readonly ProviderEvent[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const event of events) {
    for (const one of event.legs) {
      if (one.asset === null || one.quantity === null) continue;
      const quantity = units(one.quantity);
      const sign = QUANTITY_SIGN[one.kind] ?? 0n;
      if (quantity === null || sign === 0n) continue;
      net.set(one.asset.symbol, (net.get(one.asset.symbol) ?? 0n) + sign * quantity);
    }
  }
  return net;
}
