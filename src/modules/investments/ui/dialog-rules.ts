// src/modules/investments/ui/dialog-rules.ts — what the dialogs of a service start from and offer
// (docs/design/investments-ux.md §3.7, U5): pure, so the defaults are tested without a browser.
import { type CivilDate, daysBetween, isCivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import type { AssetClass, InvestmentCategory } from "../rules";

export interface LinkChoice {
  id: string;
  on: string;
  cents: Cents;
  payee: string | null;
  accountName: string | null;
}

export interface AssetChoice {
  id: string;
  name: string;
  class: AssetClass;
  symbol: string | null;
  isin: string | null;
  currency: string;
}

export interface AssetDialogDefaults {
  /** The class the search starts on; `""` is every class. */
  classFilter: AssetClass | "";
  /** The quote currency the search starts on; `""` is every currency. */
  currencyFilter: string;
  /** The class of a new asset. */
  draftClass: AssetClass;
  /** `""`: nothing chosen, the person picks it. */
  product: string;
}

/**
 * "Add asset" (D1, D2): the search starts on the class and the currency of the account — crypto and
 * EUR for Binance — and nothing is preselected. On a synced service the product is empty too: the
 * provider reads its own products, and a buy saved on one of them by mistake is counted twice. A
 * manual service has one product, custody.
 */
export function assetDialogDefaults(service: {
  category: InvestmentCategory;
  currency: string;
  synced: boolean;
}): AssetDialogDefaults {
  const crypto = service.category === "crypto";
  return {
    classFilter: crypto ? "crypto" : "",
    currencyFilter: service.currency,
    draftClass: crypto ? "crypto" : "etf",
    product: service.synced ? "" : "custody",
  };
}

/** Whether an asset passes the search of the dialog: class, quote currency and text. */
export function assetMatches(
  asset: AssetChoice,
  filter: { query: string; classFilter: string; currencyFilter: string },
): boolean {
  const needle = filter.query.trim().toLowerCase();
  return (
    (filter.classFilter === "" || asset.class === filter.classFilter) &&
    (filter.currencyFilter === "" || asset.currency === filter.currencyFilter) &&
    (needle === "" ||
      asset.name.toLowerCase().includes(needle) ||
      (asset.isin ?? "").toLowerCase().includes(needle) ||
      (asset.symbol ?? "").toLowerCase().includes(needle))
  );
}

/** How many days a bank movement may be from the operation and still be its candidate (§3.5). */
export const LINK_DAYS = 3;

/** How far a bank movement is from the date being typed; a half-typed date is no date. */
function daysApart(choice: string, on: string): number {
  return isCivilDate(on) ? Math.abs(daysBetween(choice, on as CivilDate)) : 0;
}

/**
 * The bank movements the link offers (D3, §3.5): only the candidates — the same amount, within
 * three days — or, with a search, any movement whose payee or account matches it, nearest first.
 * The movement already linked stays in the list, whatever it is.
 */
export function linkCandidates(
  choices: readonly LinkChoice[],
  on: string,
  cents: Cents | null,
  query: string,
  keep: string | null,
): LinkChoice[] {
  const needle = query.trim().toLowerCase();
  const offered = choices.filter((choice) =>
    needle === ""
      ? cents !== null && choice.cents === cents && daysApart(choice.on, on) <= LINK_DAYS
      : (choice.payee ?? "").toLowerCase().includes(needle) ||
        (choice.accountName ?? "").toLowerCase().includes(needle),
  );
  const ranked = offered
    .sort((a, b) => {
      const sameA = cents !== null && a.cents === cents ? 0 : 1;
      const sameB = cents !== null && b.cents === cents ? 0 : 1;
      return (
        sameA - sameB ||
        daysApart(a.on, on) - daysApart(b.on, on) ||
        (a.on > b.on ? -1 : a.on < b.on ? 1 : a.id < b.id ? -1 : 1)
      );
    })
    .slice(0, 40);
  const kept = keep ? choices.find((choice) => choice.id === keep) : undefined;
  return kept && !ranked.some((choice) => choice.id === kept.id) ? [kept, ...ranked] : ranked;
}
