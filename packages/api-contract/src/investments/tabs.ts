// The tabs of a service that are no page of the home (rewrite plan R2, 05-refactor.md §5.5
// «investments»): Positions and Connection. Amounts are decimal strings, ratios numbers.
import { z } from "zod";
import { civilDate, id, instant, money } from "../primitives";
import {
  ADJUSTMENT_CLASSES,
  ASSET_CLASSES,
  CONNECTION_STATES,
  COVERAGE_STATUSES,
  HOLDING_ORIGINS,
  KEY_CHECK_RESULTS,
  MODES,
  ORIGINS,
  PERIOD_REASONS,
  PNL_STATUSES,
  READING_STATUSES,
} from "./shared";
import { asset, connectable, contributions, periodOut, warnings } from "./views";

const ratio = () => z.number().nullable();

/** A position on a day, in the account's currency. */
const positionAt = z.object({
  quantity: z.string().nullable(),
  unitPrice: z.string().nullable(),
  priceCurrency: z.string().nullable(),
  value: money().nullable(),
  cost: money().nullable(),
  costSource: z.enum(["events", "provider", "inferred", "period"]).nullable(),
  unrealized: money().nullable(),
  /** cost ÷ quantity, a plain decimal. */
  averageCost: z.string().nullable(),
  /** unrealized ÷ cost. */
  onCost: ratio(),
});

/** The exits of one holding: in the period, or ever. */
const closedGroup = z.object({
  holdingId: id(),
  assetId: id().nullable(),
  product: z.string().nullable(),
  origin: z.enum(HOLDING_ORIGINS).nullable(),
  count: z.number().int(),
  /** eToro closes matched with their opening. */
  positions: z.number().int(),
  openedOn: civilDate().nullable(),
  closedOn: civilDate(),
  cost: money(),
  proceeds: money(),
  realized: money().nullable(),
  onCost: ratio(),
});

const closed = z.object({ groups: z.array(closedGroup), realized: money().nullable() });

/** A service's Positions (§3.4): open on the period's last day, closed in it and ever, the contributions. */
export const investmentPositions = z.object({
  on: civilDate(),
  period: periodOut,
  /** The account's currency; the display one is `displayCurrency`. */
  currency: z.string(),
  displayCurrency: z.string(),
  status: z.enum(PNL_STATUSES),
  /** Display P&L and its exchange effect, for the bridge from the account's currency. */
  display: z.object({ pnl: money(), fx: money() }).nullable(),
  /** The day before the P&L's measured days start: «positions on <date>»; null when nothing is measured. */
  startOn: civilDate().nullable(),
  open: z.object({
    /** By value, largest first. */
    rows: z.array(
      z.object({
        key: z.string(),
        holdingId: id().nullable(),
        assetId: id().nullable(),
        product: z.string().nullable(),
        origin: z.enum(HOLDING_ORIGINS),
        at: positionAt,
        /** What it added to the period, and that over its value at the start (or its cost). */
        pnl: money().nullable(),
        periodReturn: ratio(),
        /** Share of `total`. */
        share: ratio(),
        /** Today's manual holding it is, when actions apply (period still running). */
        manual: z.object({ conflict: z.boolean(), byValue: z.boolean() }).nullable(),
      }),
    ),
    cash: money().nullable(),
    total: money(),
    /** Σ of the rows' `pnl`: the total row. */
    pnl: money(),
    /** Share of `total` the cash is. */
    cashShare: ratio(),
    /** Rows with no cost. */
    noCost: z.number().int(),
    byClass: z.array(z.object({ key: z.enum(ASSET_CLASSES), value: money(), pnl: money(), share: ratio() })),
  }),
  closedInPeriod: closed,
  closedEver: closed,
  contributions,
  /** Unpriced dust the reading in force leaves out. */
  dust: z.array(z.object({ assetId: id(), product: z.string(), quantity: z.string() })),
  assets: z.array(asset),
  /** The reading a reconciliation refers to. */
  latestReading: z.object({ id: id(), on: civilDate() }).nullable(),
});

const coverageRow = z.object({
  kind: z.string(),
  stream: z.string(),
  from: instant(),
  to: instant(),
  status: z.enum(COVERAGE_STATUSES),
  reason: z.string().nullable(),
});

/**
 * A service's Connection (§3.6), or Settings for a manual one: what the provider gives, the readings,
 * the corrections, the key's state and the settings. Session only (SEC-08); never a credential.
 */
export const investmentConnection = z.object({
  on: civilDate(),
  accountId: id(),
  name: z.string(),
  currency: z.string(),
  warnings,
  provider: connectable.nullable(),
  sync: z
    .object({
      provider: z.string(),
      connected: z.boolean(),
      state: z.enum(CONNECTION_STATES).nullable(),
      /** The connection of Settings › Integrations, whose schedule its own routes read and write. */
      connectionId: id().nullable(),
      lastOkAt: instant().nullable(),
      lastError: z.string().nullable(),
      nextSyncAt: instant().nullable(),
      lastCheck: z
        .object({
          result: z.enum(KEY_CHECK_RESULTS),
          checkedAt: instant(),
          ipRestricted: z.boolean().nullable(),
        })
        .nullable(),
      keySetAt: instant().nullable(),
      rotateDue: z.boolean(),
      /** Retired keys not yet confirmed revoked at the provider. */
      revokePending: z.boolean(),
      coverage: z.array(coverageRow),
      reliableFrom: instant().nullable(),
      complete: z.boolean(),
      /**
       * `coverage` on the days the service reads: the windows that end after `managedSince` (by the person's
       * day), the earlier ones started on it. What the page lists.
       */
      visibleCoverage: z.array(coverageRow),
      /** The earliest day the flows (but quantities and balance history) cover, of `visibleCoverage`. */
      activityFrom: civilDate().nullable(),
    })
    .nullable(),
  /** Newest first. */
  readings: z.array(
    z.object({
      id: id(),
      on: civilDate(),
      status: z.enum(READING_STATUSES),
      total: money(),
      products: z.array(z.string()),
      /** Products the reading saw but did not read. */
      unread: z.array(z.string()),
      missingPrices: z.number().int(),
    }),
  ),
  reconstructedReadings: z.object({ count: z.number().int(), from: civilDate(), to: civilDate() }).nullable(),
  firstReadOn: civilDate().nullable(),
  adjustments: z.array(
    z.object({
      eventId: id(),
      on: civilDate(),
      amount: money(),
      validUntil: civilDate().nullable(),
      note: z.string().nullable(),
      stale: z.boolean(),
      adjustmentClass: z.enum(ADJUSTMENT_CLASSES).nullable(),
    }),
  ),
  settings: z.object({
    mode: z.enum(MODES).nullable(),
    managedSince: civilDate(),
    url: z.string().nullable(),
    periods: z.array(
      z.object({
        fromOn: civilDate(),
        mode: z.enum(MODES),
        origin: z.enum(ORIGINS),
        reason: z.enum(PERIOD_REASONS),
      }),
    ),
  }),
});
