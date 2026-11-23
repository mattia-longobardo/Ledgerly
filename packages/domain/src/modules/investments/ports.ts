// The ports of investments (10-modularity.md §10.3). Out: the adapter of the port
// `ManagedAccountsPort` of accounts (audit ACC-8), which accounts Investments manages. In: the
// accounts that hold a fund's value, which no service may use; declared here and realised by funds,
// so this module never imports funds (R5b, INV-9). The application wires both (`wireDomain`).
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import { managedSinceOf, serviceAccountIds } from "./managed";

export const managedAccountsOfInvestments = { managedSinceOf, serviceAccountIds };

/** The accounts of the funds, as investments reads them. */
interface FundAccounts {
  accountIds(ctx: Pick<Ctx, "userId">): Promise<Set<string>>;
}

/** A market of an instrument, as an asset names it. */
export interface MarketKey {
  instrumentId: string;
  mic: string;
}

interface Close {
  listingId: string;
  on: CivilDate;
  close: string;
  currency: string;
  source: string;
}

/** An instrument of the registry with its markets, as a purchase names it. */
export interface RegistryInstrument {
  instrumentId: string;
  isin: string | null;
  name: string;
  class: "stock" | "etf" | "fund" | "bond" | "other";
  currency: string;
  listings: { mic: string; ticker: string | null; currency: string; priced: boolean }[];
}

/**
 * The registry of instruments and its daily closes (R5d), as investments reads them: declared here
 * and realised by `instruments`, so this module never imports it (M2).
 */
export interface MarketPrices {
  /** The market Xetra: the price of an asset whose market has no source (S3). */
  fallbackMic: string;
  instrumentById(id: string): Promise<RegistryInstrument | null>;
  listingsOf(
    markets: readonly MarketKey[],
  ): Promise<Map<string, { listingId: string; priceSource: string | null }>>;
  marketKey(market: MarketKey): string;
  closesUpTo(listingIds: readonly string[], to: CivilDate): Promise<Close[]>;
  lastCloses(listingIds: readonly string[], day: CivilDate): Promise<Map<string, Close>>;
  isStale(lastOn: CivilDate | null, today: CivilDate): boolean;
}

declare global {
  var ledgerlyFundAccounts: FundAccounts | undefined;
  var ledgerlyMarketPrices: MarketPrices | undefined;
}

/** Wires the ports; the application calls it once per process, before any request or job. */
export function wireInvestments(ports: { funds: FundAccounts; prices: MarketPrices }): void {
  globalThis.ledgerlyFundAccounts = ports.funds;
  globalThis.ledgerlyMarketPrices = ports.prices;
}

export function marketPrices(): MarketPrices {
  const wired = globalThis.ledgerlyMarketPrices;
  if (!wired) throw new Error("investments: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}

export function fundAccounts(): FundAccounts {
  const wired = globalThis.ledgerlyFundAccounts;
  if (!wired) throw new Error("investments: the ports are not wired (wireDomain of @ledgerly/api)");
  return wired;
}
