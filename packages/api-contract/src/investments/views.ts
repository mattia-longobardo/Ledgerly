// The answers of the pages' reads of investments (rewrite plan R2, 05-refactor.md §5.5 «investments»):
// the home, a service's Overview and Activity, the catalog, and what the tabs share (`tabs.ts`). Each carries
// the numbers the page prints, summed by the server: the client of R3 adds nothing up. Amounts are
// decimal strings; a return, a share or a bar is a ratio. No text, no translation.
import { z } from "zod";
import { ACCOUNT_TYPES } from "../accounts/shared";
import { civilDate, id, instant, money } from "../primitives";
import {
  ACTIVITY_FAMILIES,
  ADJUSTMENT_CLASSES,
  ASSET_CLASSES,
  assetRef,
  CONNECTION_STATES,
  ELIGIBILITY_REASONS,
  EVENT_ORIGINS,
  INVESTMENT_CATEGORIES,
  modifiedDietz,
  OPERATION_KINDS,
  ORIGINS,
  PERIOD_KINDS,
  PNL_REASONS,
  PNL_STATUSES,
  portfolioTotals,
  serviceRow,
  XIRR_STATUSES,
  legacyParts,
} from "./shared";
import { portfolioParts } from "./portfolio";

const ratio = () => z.number().nullable();
const month = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The period measured: its days, the days it really spans («All» from `firstOn`), the first day with data. */
export const periodOut = z.object({
  kind: z.enum(PERIOD_KINDS),
  year: z.number().int().nullable(),
  from: civilDate().nullable(),
  to: civilDate(),
  span: z.object({ from: civilDate(), to: civilDate() }),
  /** Where «All» starts and the stepper stops; null with no data. */
  firstOn: civilDate().nullable(),
});

/** The parts of a P&L, with what no part explains (zero on consistent data). */
const parts = legacyParts.extend({
  unattributed: money(),
  /** `fees` + `fx`: the tile «Fees and exchange». */
  feesAndFx: money(),
  /** `pnl` − `fx`: the P&L before the exchange effect, the bridge from the account's currency. */
  beforeFx: money(),
});

/** The return of a period: Modified Dietz, or the P&L on the money put in when there is no capital. */
const periodReturn = z.object({
  modifiedDietz,
  method: z.enum(["dietz", "invested"]),
  /** XIRR over the period, only when it covers a year or more. */
  xirr: ratio(),
  xirrStatus: z.enum(XIRR_STATUSES),
  /** Σ |flows| above the starting capital: Dietz is further from a time-weighted return. */
  largeFlows: z.boolean(),
});

/** One service's P&L of the period: in its own currency (`local`) and in the display one. */
const servicePnl = z.object({
  accountId: id(),
  status: z.enum(PNL_STATUSES),
  reasons: z.array(z.enum(PNL_REASONS)),
  /** The days measured; `from` null when nothing could be. */
  from: civilDate().nullable(),
  to: civilDate(),
  /** The days measured start after the period's: the badge «from <date>». */
  partial: z.boolean(),
  /** The value at the start and at the end, and the cash beside the positions at the end (own currency). */
  start: money().nullable(),
  end: money().nullable(),
  endCash: money().nullable(),
  openPositions: z.number().int(),
  local: parts.nullable(),
  display: parts.nullable(),
  localReturn: periodReturn.nullable(),
  displayReturn: periodReturn.nullable(),
});

/** What the services' warnings count: the alerts of the home and the badge of Connection. */
export const warnings = z.object({
  conflicts: z.number().int(),
  pendingZero: z.boolean(),
  missingPrices: z.number().int(),
  openAdjustments: z.number().int(),
  /** How many of the four ask for an action. */
  alerts: z.number().int(),
});

/** The colour of a service: its account's, or null for the palette's colour at `colorIndex`. */
const colored = { color: z.string().nullable(), colorIndex: z.number().int() };

const slice = (key: z.ZodType) => z.object({ key, value: money(), share: z.number() });

/**
 * The charts of a period: the P&L by bar (week, month or year) and the value by day or month end,
 * one layer per service, with the sums the page draws. A null is a gap, never a zero.
 */
const chart = z.object({
  barGrain: z.enum(["week", "month", "year"]),
  intervals: z.array(z.object({ from: civilDate(), to: civilDate() })),
  valueGrain: z.enum(["day", "month"]),
  valueDays: z.array(civilDate()),
  services: z.array(
    z.object({
      accountId: id(),
      bars: z.array(money().nullable()),
      values: z.array(money().nullable()),
      /** The service's `bars` in the Return view, on the scale of `returns`. */
      returns: z.array(ratio()),
    }),
  ),
  /** Σ of the services per bar and its running total; Σ of the values per day. */
  bars: z.array(money().nullable()),
  cumulative: z.array(money().nullable()),
  values: z.array(money().nullable()),
  /**
   * The Return view: `bars` and `cumulative` as fractions of the period's capital, so the running total
   * ends on the period's return. All null when the period has no return to share.
   */
  returns: z.array(ratio()),
  cumulativeReturns: z.array(ratio()),
});

/** What one position added to the period, open or sold (PERS-113 · 9), in the account's currency. */
const contributionRow = z.object({
  key: z.string(),
  holdingId: id().nullable(),
  assetId: id().nullable(),
  product: z.string().nullable(),
  pnl: money(),
  realized: money(),
  unrealized: money().nullable(),
  open: z.boolean(),
  sold: z.boolean(),
  costUnknown: z.boolean(),
  /** −1…1, on the largest |pnl| of the rows. */
  bar: z.number(),
});

/** The rows and the parts that are no position's: they add up to `total`, the local P&L. Null when undetermined. */
export const contributions = z
  .object({
    rows: z.array(contributionRow),
    income: money(),
    fees: money(),
    corrections: money(),
    /** The change of a value kept without positions. */
    valueChange: money(),
    unattributed: money(),
    total: money(),
  })
  .nullable();

/** An asset of the catalog, as the dialogs and the rows name it. */
export const asset = assetRef.extend({ id: id() });

/** A provider a key connects, as the key dialogs take it. Never a credential, only the fields' names. */
export const connectable = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(INVESTMENT_CATEGORIES),
  accountType: z.enum(["investment", "crypto"]),
  credentialFields: z.array(z.string()),
  currencies: z.array(z.string()).nullable(),
  defaultCurrency: z.string(),
  ipWhitelist: z.enum(["supported", "unsupported"]).nullable(),
  url: z.string().nullable(),
  revokeUrl: z.string().nullable(),
});

/** An event of the service, by the leg that says what it is (§3.5). */
const activityRow = z.object({
  id: id(),
  on: civilDate(),
  origin: z.enum(EVENT_ORIGINS),
  note: z.string().nullable(),
  family: z.enum(ACTIVITY_FAMILIES),
  leg: z.object({
    kind: z.enum(OPERATION_KINDS),
    holdingId: id().nullable(),
    assetName: z.string().nullable(),
    assetClass: z.enum(ASSET_CLASSES).nullable(),
    product: z.string().nullable(),
    /** Plain decimals, as stored. */
    quantity: z.string().nullable(),
    unitPrice: z.string().nullable(),
    priceCurrency: z.string().nullable(),
    amount: money(),
    validUntil: civilDate().nullable(),
  }),
  adjustmentClass: z.enum(ADJUSTMENT_CLASSES).nullable(),
  transactionId: id().nullable(),
  /** The bank movement that documents it. */
  linked: z.object({ payee: z.string().nullable(), amount: money() }).nullable(),
  /** The other service of a transfer between the person's accounts. */
  transfer: z.object({ accountId: id(), accountName: z.string() }).nullable(),
  /** What a sale realized in the period, by the engine's exits; null for no sale. */
  realized: money().nullable(),
  /** The purchase plan's instalment it is (R5d), and whether the job wrote it («automatic»). */
  plan: z.object({ planId: id(), runId: id(), name: z.string(), automatic: z.boolean() }).nullable(),
});

/** A bank movement a deposit or a withdrawal can be documented by. */
const linkOption = z.object({
  id: id(),
  on: civilDate(),
  amount: money(),
  payee: z.string().nullable(),
  accountName: z.string().nullable(),
});

const legacyService = serviceRow.extend({ ...colored, warnings });

/** The home (§3.1): today's portfolio, the P&L of the period, its chart and what the portfolio holds. */
export const investmentsHome = z.object({
  on: civilDate(),
  /** The display currency. */
  currency: z.string(),
  period: periodOut,
  totals: portfolioTotals,
  /** The value at the period's end, for a period that ended before today. */
  valueAtEnd: money().nullable(),
  /** The services, ordered by what they added to the period. */
  services: z.array(
    legacyService.extend({
      pnl: servicePnl.nullable(),
      contribution: z
        .object({
          pnl: money(),
          /** −1…1, on the largest |P&L| of the services. */
          bar: z.number(),
          /** Share of the net P&L; null when the net is zero or almost. */
          shareOfNet: ratio(),
        })
        .nullable(),
    }),
  ),
  pnl: z.object({
    status: z.enum(PNL_STATUSES),
    /** Some service starts later, stands on an old price or is left out: «P&L available». */
    available: z.boolean(),
    parts: parts.nullable(),
    transfers: money(),
    /** Σ of the services' open positions. */
    openPositions: z.number().int(),
    /** The aggregate Modified Dietz, only over one range for every service. */
    modifiedDietz,
    rateReason: z.enum(["ok", "mixed_ranges", "not_computable", "none"]),
    partial: z.array(z.object({ accountId: id(), from: civilDate() })),
    stale: z.array(id()),
    excluded: z.array(z.object({ accountId: id(), reasons: z.array(z.enum(PNL_REASONS)) })),
  }),
  chart,
  /** Today's value by asset class (`unclassified`: a manual account kept as a total), by service, by currency. */
  byClass: z.array(slice(z.enum([...ASSET_CLASSES, "unclassified"]))),
  byService: z.array(slice(id())),
  byCurrency: z.array(slice(z.string())),
  /** The pension funds, read only, and their sum. Kept for the clients before R5b; R5f removes it. */
  funds: z.object({
    total: money().nullable(),
    rows: z.array(z.object({ id: id(), name: z.string(), value: money().nullable() })),
  }),
  /** The one list of R5b: one total, the two groups with their KPIs and their rows. */
  ...portfolioParts,
});

/**
 * The service as its header, its tabs and its dialogs read it (§3.2). The sync's state only: its last
 * error, key checks and readings are the Connection tab's, which tokens never read (SEC-08).
 */
const serviceHeader = legacyService.extend({
  /** The account's own origin: `synced` when Wallet reads it. */
  accountOrigin: z.enum(ORIGINS),
  /** The service's address, or the provider's. */
  url: z.string().nullable(),
  managedSince: civilDate(),
  firstOn: civilDate().nullable(),
  /** A manual service whose value is written here («Update value»), not on an account Wallet reads. */
  valueEditable: z.boolean(),
  /** A manual portfolio (R5d): positions and cash typed by hand, its value written by the module. */
  portfolio: z.boolean(),
  /** A manual service's P&L since it started; null for a synced one. */
  manualPnl: z
    .object({
      value: money().nullable(),
      invested: money(),
      pnl: money().nullable(),
      rate: ratio(),
      valuedOn: civilDate().nullable(),
      stale: z.boolean(),
      /** The days after which a value typed by hand is old (`stale`). */
      staleDays: z.number().int(),
    })
    .nullable(),
  sync: z
    .object({
      provider: z.string(),
      providerName: z.string(),
      connected: z.boolean(),
      state: z.enum(CONNECTION_STATES).nullable(),
      lastOkAt: instant().nullable(),
    })
    .nullable(),
  provider: connectable.nullable(),
  assets: z.array(asset),
  /** Products the provider's latest reading covers: a manual position there would conflict. */
  coveredProducts: z.array(z.string()),
  linkOptions: z.object({ out: z.array(linkOption), in: z.array(linkOption) }),
});

/** A service's Overview (§3.3): the service, its P&L of the period, its chart, contributions, latest events. */
export const investmentOverview = z.object({
  on: civilDate(),
  /** The display currency; the service's own is `service.currency`. */
  currency: z.string(),
  period: periodOut,
  service: serviceHeader,
  pnl: servicePnl,
  chart: chart.extend({
    /** Money in, out or both in each bar. */
    markers: z.array(z.enum(["in", "out", "both"]).nullable()),
  }),
  contributions,
  /** The five newest events of the period. */
  recent: z.array(activityRow),
});

/** A service's Activity (§3.5): the events of a provider's service, or a manual one's bank movements. */
export const investmentActivity = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("events"),
    period: periodOut,
    page: z.number().int(),
    pages: z.number().int(),
    /** The events the filters leave; every event of the service. */
    total: z.number().int(),
    allTime: z.number().int(),
    counts: z.record(z.enum([...ACTIVITY_FAMILIES, "all"]), z.number().int()),
    /** The months of the filtered events, newest first, with what their sales realized. */
    months: z.array(z.object({ month: month(), count: z.number().int(), realized: money() })),
    /** The period's money in and out and its fees, in the account's currency. */
    /** `net`: deposits + withdrawals. */
    sums: z.object({ deposits: money(), withdrawals: money(), fees: money(), net: money() }),
    /** The rows of this page among `total`, 1-based («1–50 of 120»); both 0 with none. */
    first: z.number().int(),
    last: z.number().int(),
    rows: z.array(activityRow),
    /** Withdrawals and deposits of two services that can be linked as one transfer. */
    transferProposals: z.array(
      z.object({
        withdrawalId: id(),
        depositId: id(),
        direction: z.enum(["in", "out"]),
        on: civilDate(),
        amount: money(),
        other: z.object({ accountId: id(), accountName: z.string(), on: civilDate() }),
      }),
    ),
  }),
  z.object({
    source: z.literal("movements"),
    period: periodOut,
    rows: z.array(z.object({ id: id(), on: civilDate(), payee: z.string().nullable(), amount: money() })),
    deposits: money(),
    withdrawals: money(),
    /** Deposits + withdrawals. */
    net: money(),
  }),
]);

/** The catalog (§4.2): the providers, the ones to come too, and the accounts a service can use. */
export const investmentsCatalog = z.object({
  providers: z.array(
    connectable.extend({
      connect: z.enum(["apikey", "manual"]),
      /** `planned`: listed under «Coming soon», it cannot be connected yet. */
      status: z.enum(["available", "planned"]),
      connected: z.array(z.object({ accountId: id(), name: z.string() })),
    }),
  ),
  existing: z.array(
    z.object({
      id: id(),
      name: z.string(),
      currency: z.string(),
      type: z.enum(ACCOUNT_TYPES),
      balance: money().nullable(),
      /** Why it cannot be picked; null: it can. */
      reason: z.enum(ELIGIBILITY_REASONS).nullable(),
      synced: z.boolean(),
      /** A manual service a provider can be connected to. */
      manualService: z.boolean(),
    }),
  ),
});
