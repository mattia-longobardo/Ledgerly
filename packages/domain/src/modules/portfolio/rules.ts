// The read model of Investments (rewrite plan R5b, 10-modularity.md §10.2 row 6; 11-standardization.md
// §11.4): the services, the manual portfolios and the pension funds as one list in two groups, with one
// total. It reads nothing and imports no module: the application hands it what the other modules read,
// so the same partition gives the home of Investments and the groups of Overview (decision O1).
import { type CivilDate, daysBetween } from "../../shared/dates";
import { type Cents, sumCents } from "../../shared/money";

export const PORTFOLIO_KINDS = ["service", "manual_portfolio", "pension_fund"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

/** The groups of decision B1, named by ST-2: «Azioni e crypto», «Fondi pensione». */
export const PORTFOLIO_GROUPS = ["stocks_crypto", "pension_funds"] as const;
export type PortfolioGroup = (typeof PORTFOLIO_GROUPS)[number];

export const RATE_REASONS = ["ok", "mixed_ranges", "not_computable", "none"] as const;
type RateReason = (typeof RATE_REASONS)[number];

/**
 * Two groups' rates add up only when their last days are this close: the tolerance Funds already
 * takes between its funds (`AGGREGATE_RATE_DAYS` of `funds/home.ts`).
 */
const SPAN_DAYS = 45;

/** An account as Overview reads it today, in its currency and in the display one. */
export interface HeldAccount {
  accountId: string;
  name: string;
  currency: string;
  /** The account's type (`investment`, `crypto`, `pension`…): it alone gives the group. */
  type: string;
  valueCents: Cents | null;
  displayCents: Cents | null;
  /** In Overview's «Investments» bucket today: what the totals add up. */
  counted: boolean;
}

/** A service as its kind reads it: its provider (`manual` for none) and who writes its account. */
interface ServiceOrigin {
  provider: string;
  accountOrigin: string;
}

/** What holds an account: a service or a fund. */
export interface Holders {
  services: ReadonlyMap<string, ServiceOrigin>;
  funds: ReadonlyMap<string, { id: string; name: string }>;
}

/**
 * A service a provider or a bank reads is a `service`; one whose value is typed by hand — kept by
 * value (decision Q1 of R5b) or as positions and cash (R5d) — is a `manual_portfolio`.
 */
export const serviceKind = (service: ServiceOrigin): "service" | "manual_portfolio" =>
  (service.provider === "manual" || service.provider === "portfolio") && service.accountOrigin !== "synced"
    ? "manual_portfolio"
    : "service";

export interface PortfolioRow extends HeldAccount {
  kind: PortfolioKind;
  group: PortfolioGroup;
  fundId: string | null;
}

/**
 * The group of an account, by its type as Overview's buckets are: a `pension` account — every fund's
 * account is one — is in «Fondi pensione», the others in «Azioni e crypto». Overview reads no fund, so
 * its two groups cost no query, and the home's subtotals are its own on the same rule.
 */
const groupOf = (account: { type: string }): PortfolioGroup =>
  account.type === "pension" ? "pension_funds" : "stocks_crypto";

/**
 * The rows: every account of Overview's bucket, and every service and open fund off it (shown, not
 * counted). A fund's account is a `pension_fund`, a service has {@link serviceKind}, and an account
 * that is neither — kept as a total — is a `manual_portfolio`.
 */
export function portfolioRows(accounts: readonly HeldAccount[], holders: Holders): PortfolioRow[] {
  return accounts
    .filter((one) => one.counted || holders.services.has(one.accountId) || holders.funds.has(one.accountId))
    .map((one) => {
      const fund = holders.funds.get(one.accountId) ?? null;
      const service = holders.services.get(one.accountId);
      const kind: PortfolioKind =
        fund !== null ? "pension_fund" : service ? serviceKind(service) : "manual_portfolio";
      return { ...one, name: fund?.name ?? one.name, kind, group: groupOf(one), fundId: fund?.id ?? null };
    });
}

export interface GroupTotal {
  group: PortfolioGroup;
  total: Cents | null;
  partial: boolean;
  count: number;
}

/** Each group's sum of its counted rows, as Overview sums a bucket; a group with no row is left out. */
export function groupTotals(rows: readonly PortfolioRow[]): GroupTotal[] {
  return PORTFOLIO_GROUPS.flatMap((group) => {
    const own = rows.filter((row) => row.group === group);
    if (own.length === 0) return [];
    const counted = own.filter((row) => row.counted);
    return [{ group, ...sumCents(counted.map((row) => row.displayCents)), count: counted.length }];
  });
}

/** What a group's own engine measured in the period, in the display currency. */
export interface GroupMeasure {
  paidInCents: Cents | null;
  gainCents: Cents | null;
  rate: number | null;
  /** The average capital `rate` divides by; `null` with it. */
  capital: number | null;
  /** The last day the measure stands on. */
  to: CivilDate | null;
}

/** The four KPIs of «Tutti» and of each chip (decision Q2 of R5b). */
export interface Kpis {
  valueCents: Cents | null;
  valuePartial: boolean;
  paidInCents: Cents | null;
  gainCents: Cents | null;
  rate: number | null;
  rateReason: RateReason;
}

const sumOf = (values: readonly (Cents | null)[]) =>
  values.length === 0 || values.some((value) => value === null)
    ? null
    : values.reduce<Cents>((total, value) => total + value!, 0n);

/**
 * The KPIs of a set of groups: the value of their counted rows; the money in, the gain and the
 * rate of the period from each group's engine. The rate of more groups is Σ gain over Σ average
 * capital, only when each has one and their last days are within {@link SPAN_DAYS}.
 */
function kpisOf(total: Pick<GroupTotal, "total" | "partial">, measures: readonly GroupMeasure[]): Kpis {
  const value = { valueCents: total.total, valuePartial: total.partial };
  const gained = measures.filter((one) => one.gainCents !== null);
  const money = {
    paidInCents: sumOf(measures.map((one) => one.paidInCents)),
    gainCents: gained.length === 0 ? null : sumOf(gained.map((one) => one.gainCents)),
  };
  if (gained.length === 0) return { ...value, ...money, rate: null, rateReason: "none" };
  if (gained.length === 1) {
    const { rate } = gained[0];
    return { ...value, ...money, rate, rateReason: rate === null ? "not_computable" : "ok" };
  }
  if (gained.some((one) => one.capital === null || one.to === null))
    return { ...value, ...money, rate: null, rateReason: "not_computable" };
  const days = gained.map((one) => one.to!).sort();
  if (daysBetween(days[0], days[days.length - 1]) > SPAN_DAYS)
    return { ...value, ...money, rate: null, rateReason: "mixed_ranges" };
  const capital = gained.reduce((sum, one) => sum + one.capital!, 0);
  if (capital <= 0) return { ...value, ...money, rate: null, rateReason: "not_computable" };
  return { ...value, ...money, rate: Number(money.gainCents!) / capital, rateReason: "ok" };
}

export interface PortfolioView {
  total: Kpis;
  groups: { group: PortfolioGroup; kpis: Kpis; rows: PortfolioRow[] }[];
}

/** The home of Investments: one total, and each group with its KPIs and its rows. */
export function portfolioView(
  rows: readonly PortfolioRow[],
  measures: Readonly<Record<PortfolioGroup, GroupMeasure | null>>,
): PortfolioView {
  const totals = groupTotals(rows);
  const measured = (groups: readonly PortfolioGroup[]) =>
    groups.flatMap((group) => (measures[group] === null ? [] : [measures[group]!]));
  const all = sumCents(totals.filter((one) => one.count > 0).map((one) => one.total));
  return {
    total: kpisOf(
      { total: all.total, partial: all.partial || totals.some((one) => one.partial) },
      measured(totals.map((one) => one.group)),
    ),
    groups: totals.map((one) => ({
      group: one.group,
      kpis: kpisOf(one, measured([one.group])),
      rows: rows.filter((row) => row.group === one.group),
    })),
  };
}
