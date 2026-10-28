// src/modules/investments/catalog.ts — the providers of the section (docs/design/investments.md
// §1.1, D12): static, in the code. The manual account, eToro (phase 3) and Binance (phase 4) are
// available; the other exchanges — Kraken too: there is no account to test it on — and the other
// brokers are listed as planned, with no "Connect".
import { z } from "zod";
import type { InvestmentCategory } from "./rules";

export interface InvestmentProvider {
  /** Equal to `integration_connections.provider` once the provider can connect. */
  id: string;
  name: string;
  category: InvestmentCategory;
  connect: "apikey" | "manual";
  status: "available" | "planned";
  url: string | null;
  credentialFields: readonly string[];
  readOnlyCheck: "api" | "declared" | null;
  ipWhitelist: "supported" | "unsupported" | null;
  ccxtId: string | null;
  products: readonly string[];
  revokeUrl: string | null;
  /** The account currency offered first when a new account is created for it. */
  defaultCurrency: string;
  /** The account currencies the provider can report in (eToro `displayCurrency`, E8); `null`: any. */
  currencies: readonly string[] | null;
}

const manual = {
  connect: "manual",
  credentialFields: [],
  readOnlyCheck: null,
  ipWhitelist: null,
  ccxtId: null,
  products: ["custody"],
  revokeUrl: null,
  defaultCurrency: "EUR",
  currencies: null,
} as const;

const exchange = (id: string, name: string, url: string, revokeUrl: string) =>
  ({
    id: `ccxt:${id}`,
    name,
    category: "crypto",
    connect: "apikey",
    status: "planned",
    url,
    credentialFields: ["api_key", "secret"],
    readOnlyCheck: "declared",
    ipWhitelist: "supported",
    ccxtId: id,
    products: ["spot", "funding"],
    revokeUrl,
    defaultCurrency: "EUR",
    currencies: null,
  }) as const satisfies InvestmentProvider;

export const MANUAL_PROVIDER = "manual";

export const INVESTMENT_PROVIDERS: readonly InvestmentProvider[] = [
  {
    id: MANUAL_PROVIDER,
    name: "Manual account",
    category: "accounts",
    status: "available",
    url: null,
    ...manual,
  },
  {
    id: "etoro",
    name: "eToro",
    category: "broker",
    connect: "apikey",
    status: "available",
    url: "https://www.etoro.com",
    credentialFields: ["api_key", "user_key"],
    // D17 · E1: `GET /api/v1/me` lists the key's scopes, checked on every pass.
    readOnlyCheck: "api",
    ipWhitelist: "unsupported",
    ccxtId: null,
    products: ["trading", "cash", "crypto", "copy"],
    revokeUrl: "https://www.etoro.com/settings/trade",
    defaultCurrency: "USD",
    currencies: ["EUR", "USD", "GBP", "CHF"],
  },
  {
    id: "ibkr",
    name: "Interactive Brokers",
    category: "broker",
    status: "planned",
    url: "https://www.interactivebrokers.com",
    ...manual,
  },
  {
    id: "degiro",
    name: "Degiro",
    category: "broker",
    status: "planned",
    url: "https://www.degiro.com",
    ...manual,
  },
  {
    id: "trade-republic",
    name: "Trade Republic",
    category: "broker",
    status: "planned",
    url: "https://traderepublic.com",
    ...manual,
  },
  {
    id: "scalable",
    name: "Scalable Capital",
    category: "broker",
    status: "planned",
    url: "https://scalable.capital",
    ...manual,
  },
  {
    ...exchange(
      "binance",
      "Binance",
      "https://www.binance.com",
      "https://www.binance.com/en/my/settings/api-management",
    ),
    status: "available",
    // D18 · B1: `GET /sapi/v1/account/apiRestrictions`, an allowlist checked on every pass.
    readOnlyCheck: "api",
    // B4: Spot, Funding and Simple Earn; any other wallet with a value makes a reading partial.
    products: ["spot", "funding", "earn"],
    // The pairs the prices go through (§1.8): EUR on the exchange, USD through USDT/USD.
    currencies: ["EUR", "USD"],
  },
  exchange("kraken", "Kraken", "https://www.kraken.com", "https://pro.kraken.com/app/settings/api"),
  exchange("coinbase", "Coinbase", "https://www.coinbase.com", "https://www.coinbase.com/settings/api"),
  exchange("bitvavo", "Bitvavo", "https://bitvavo.com", "https://account.bitvavo.com/user/api"),
  exchange(
    "cryptocom",
    "Crypto.com",
    "https://crypto.com/exchange",
    "https://crypto.com/exchange/user/settings/api-management",
  ),
];

export function providerOf(id: string): InvestmentProvider | null {
  return INVESTMENT_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** A provider a key can connect today: `apikey`, available. */
export function connectableProvider(id: string): InvestmentProvider | null {
  const provider = providerOf(id);
  return provider && provider.connect === "apikey" && provider.status === "available" ? provider : null;
}

/**
 * The credentials of a provider as a strict object of its own fields (SEC-03): a field more — a
 * proxy, a host, an option — is refused, never passed on. Each value is one header-safe line.
 */
export function credentialSchemaOf(provider: InvestmentProvider) {
  const value = z
    .string()
    .trim()
    .min(8)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/);
  return z.strictObject(Object.fromEntries(provider.credentialFields.map((field) => [field, value])));
}

/** The account type a service of a category is (D13): exchanges are `crypto`, the rest `investment`. */
export function accountTypeOf(category: InvestmentCategory): "investment" | "crypto" {
  return category === "crypto" ? "crypto" : "investment";
}

/** The editable seed of the asset catalog (§1.4): the main crypto and the most common ETFs. */
export const ASSET_SEED = [
  { class: "crypto", name: "Bitcoin", symbol: "BTC", isin: null, mic: null, currency: "EUR" },
  { class: "crypto", name: "Ethereum", symbol: "ETH", isin: null, mic: null, currency: "EUR" },
  { class: "crypto", name: "Solana", symbol: "SOL", isin: null, mic: null, currency: "EUR" },
  { class: "crypto", name: "BNB", symbol: "BNB", isin: null, mic: null, currency: "EUR" },
  { class: "crypto", name: "Cardano", symbol: "ADA", isin: null, mic: null, currency: "EUR" },
  { class: "stablecoin", name: "Tether", symbol: "USDT", isin: null, mic: null, currency: "USD" },
  { class: "stablecoin", name: "USD Coin", symbol: "USDC", isin: null, mic: null, currency: "USD" },
  {
    class: "etf",
    name: "Vanguard FTSE All-World UCITS ETF (Acc)",
    symbol: "VWCE",
    isin: "IE00BK5BQT80",
    mic: "XETR",
    currency: "EUR",
  },
  {
    class: "etf",
    name: "iShares Core MSCI World UCITS ETF (Acc)",
    symbol: "SWDA",
    isin: "IE00B4L5Y983",
    mic: "XMIL",
    currency: "EUR",
  },
  {
    class: "etf",
    name: "iShares Core S&P 500 UCITS ETF (Acc)",
    symbol: "CSPX",
    isin: "IE00B5BMR087",
    mic: "XLON",
    currency: "USD",
  },
  {
    class: "etf",
    name: "iShares Core MSCI EM IMI UCITS ETF (Acc)",
    symbol: "EIMI",
    isin: "IE00BKM4GZ66",
    mic: "XMIL",
    currency: "EUR",
  },
  {
    class: "etf",
    name: "Xtrackers MSCI World UCITS ETF 1C",
    symbol: "XDWD",
    isin: "IE00BJ0KDQ92",
    mic: "XETR",
    currency: "EUR",
  },
] as const;
