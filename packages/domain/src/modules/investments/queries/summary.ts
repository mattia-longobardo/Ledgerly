// A service as the home and its page sum it up (docs/design/investments.md §2.4): value, gain, returns, warnings.
import { type Account } from "../../accounts";
import { addDays, type CivilDate } from "../../../shared/dates";
import { convertCents, type RateTable } from "../../../platform/fx/rules";
import { type Cents } from "../../../shared/money";
import { type InvestmentProvider, providerOf } from "../catalog";
import {
  flowEntriesOn,
  accountPnl,
  type AccountPnl,
  investorFlows,
  type Mode,
  type AccountOrigin,
  type Performance,
  performance,
  sumFlows,
  valueAt,
} from "../rules";
import { type InvestmentAccount, type LoadedBook } from "../service";
import { type Xirr, xirr } from "../../../shared/returns";
import { type Loaded } from "./snapshot";

/** The home chart looks back this far, as the legacy page did. */
export const HISTORY_MONTHS = 36;
/** An adjustment without an end older than this is flagged (R3). */
export const OPEN_ADJUSTMENT_DAYS = 30;
/** How far back a bank movement can be picked to document a deposit or a withdrawal. */
export const LINK_WINDOW_DAYS = 400;
/** How many of the newest bank movements of each way the picker offers. */
export const LINK_LIMIT = 300;

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
  /**
   * A manual service's P&L since it started (PERS-335): the value typed from the broker against the
   * net money put in, with the day of that value. `null` for a synced service.
   */
  manualPnl: AccountPnl | null;
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

export function summaryOf(one: Loaded, todayOn: CivilDate, displayCurrency: string, displayRates: RateTable) {
  const valueCents = one.day.valueCents;
  const before = valueAt(one.book, addDays(todayOn, -30), one.rates).valueCents;
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
    manualPnl: one.day.origin === "manual" ? accountPnl(one.book, todayOn, valueCents) : null,
  } satisfies ServiceSummary;
}
