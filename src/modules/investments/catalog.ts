// src/modules/investments/catalog.ts — the providers of the section (docs/design/investments.md
// §1.1, D12): static, in the code. Phase 2 makes only the manual account available; eToro (phase 3)
// and the ccxt exchanges (phase 4) are listed as planned, with no "Connect".
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
    readOnlyCheck: id === "binance" ? "api" : "declared",
    ipWhitelist: "supported",
    ccxtId: id,
    products: ["spot", "funding"],
    revokeUrl,
    defaultCurrency: "EUR",
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
    status: "planned",
    url: "https://www.etoro.com",
    credentialFields: ["api_key", "user_key"],
    readOnlyCheck: "declared",
    ipWhitelist: "unsupported",
    ccxtId: null,
    products: ["custody"],
    revokeUrl: "https://www.etoro.com/settings/trade",
    defaultCurrency: "USD",
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
  exchange(
    "binance",
    "Binance",
    "https://www.binance.com",
    "https://www.binance.com/en/my/settings/api-management",
  ),
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
