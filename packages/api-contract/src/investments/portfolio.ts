// The one list of Investments (rewrite plan R5b, 11-standardization.md §11.4; 10-modularity.md §10.2
// row 6): services, manual portfolios and pension funds in two groups with one total, the same total
// Overview's «Investments» shows. The vocabularies are the domain's (`@ledgerly/domain/portfolio`):
// `tools/contract.test.ts` holds them equal. No value `pac` exists here (decision H12).
import { z } from "zod";
import { civilDate, id, money } from "../primitives";
import { FUND_STATES } from "../funds/shared";
import { ACCOUNT_ID } from "./shared";

export const PORTFOLIO_KINDS = ["service", "manual_portfolio", "pension_fund"] as const;
export const PORTFOLIO_GROUPS = ["stocks_crypto", "pension_funds"] as const;
export const RATE_REASONS = ["ok", "mixed_ranges", "not_computable", "none"] as const;

/** The four KPIs of «Tutti» and of each chip, in the display currency. */
const kpis = z.object({
  /** Today's value of the rows Overview counts: the subtotal its «Investments» shows. */
  value: money().nullable(),
  valuePartial: z.boolean(),
  /**
   * The money put in during the period: what left the services is taken out; for the funds, the money
   * paid in, as Funds shows it. Null when an amount has no exchange rate.
   */
  paidIn: money().nullable(),
  /** The gain of the period: the services' P&L and the funds' gain. */
  gain: money().nullable(),
  /** Modified Dietz of the period; for more groups Σ gain over Σ average capital. */
  rate: z.number().nullable(),
  rateReason: z.enum(RATE_REASONS),
});

/** One row: a service, a manual portfolio or a pension fund, each on the account that holds it. */
const portfolioRow = z.object({
  kind: z.enum(PORTFOLIO_KINDS),
  accountId: id(),
  /** The fund of a `pension_fund`; null for the others. */
  fundId: id().nullable(),
  name: z.string(),
  currency: z.string(),
  value: money().nullable(),
  displayValue: money().nullable(),
  /** False for a row Overview does not count (out of the net worth, or liquid): shown, not summed. */
  inTotal: z.boolean(),
});

/** A group: «Azioni e crypto» or «Fondi pensione». A group with no row is not in the list. */
const portfolioGroup = z.object({ id: z.enum(PORTFOLIO_GROUPS), kpis, rows: z.array(portfolioRow) });

/** The total and the groups, added to the home and to `GET /investments?include=funds`. */
export const portfolioParts = { total: kpis, groups: z.array(portfolioGroup) };

export const FUND_ID = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";
const FUND_ACCOUNT_ID = "1c2d3e4f-5061-4728-93a4-b5c6d7e8f9a0";

const KPIS_EXAMPLE = {
  value: "12650.00",
  valuePartial: false,
  paidIn: "1200.00",
  gain: "650.00",
  rate: 0.054167,
  rateReason: "ok",
} as const;

const FUND_KPIS_EXAMPLE = {
  value: "12450.00",
  valuePartial: false,
  paidIn: "1050.00",
  gain: "412.30",
  rate: 0.0412,
  rateReason: "ok",
} as const;

export const PORTFOLIO_EXAMPLE = {
  total: {
    value: "25100.00",
    valuePartial: false,
    paidIn: "2250.00",
    gain: "1062.30",
    rate: 0.0478,
    rateReason: "ok",
  },
  groups: [
    {
      id: "stocks_crypto",
      kpis: KPIS_EXAMPLE,
      rows: [
        {
          kind: "manual_portfolio",
          accountId: ACCOUNT_ID,
          fundId: null,
          name: "Directa",
          currency: "EUR",
          value: "12650.00",
          displayValue: "12650.00",
          inTotal: true,
        },
      ],
    },
    {
      id: "pension_funds",
      kpis: FUND_KPIS_EXAMPLE,
      rows: [
        {
          kind: "pension_fund",
          accountId: FUND_ACCOUNT_ID,
          fundId: FUND_ID,
          name: "Fondo Pensione",
          currency: "EUR",
          value: "12450.00",
          displayValue: "12450.00",
          inTotal: true,
        },
      ],
    },
  ],
};

/** `GET /investments/funds` and `list_funds`: every pension fund, open and archived, with no type. */
export const fundsList = z.object({
  on: civilDate(),
  /** The display currency of `displayValue`. */
  currency: z.string(),
  funds: z.array(
    z.object({
      id: id(),
      /** The account that holds the fund's value: its row in Overview and Investments. */
      accountId: id(),
      name: z.string(),
      provider: z.string().nullable(),
      currency: z.string(),
      /** Today's value; null for an archived fund, which holds no money today. */
      value: money().nullable(),
      displayValue: money().nullable(),
      lastValuation: civilDate().nullable(),
      /** The money paid in and the gain since the fund started («All»), as its page has them, archived too. */
      paidIn: money().nullable(),
      gain: money().nullable(),
      state: z.enum(FUND_STATES),
    }),
  ),
});

export const FUNDS_LIST_EXAMPLE = {
  on: "2026-11-21",
  currency: "EUR",
  funds: [
    {
      id: FUND_ID,
      accountId: FUND_ACCOUNT_ID,
      name: "Fondo Pensione",
      provider: "Fondo Pensione",
      currency: "EUR",
      value: "12450.00",
      displayValue: "12450.00",
      lastValuation: "2026-10-01",
      paidIn: "11800.00",
      gain: "650.00",
      state: "active",
    },
  ],
};
