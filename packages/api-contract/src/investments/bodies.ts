// The bodies of the investments' writes (rewrite plan R2, 05-refactor.md §5.5 «investments»): what a
// form sends, in canonical form. Amounts are plain decimal strings (`amountInput`), quantities and
// prices plain decimals too, never in the person's number format: the server parses them.
import { z } from "zod";
import { amountInput, civilDate, id } from "../primitives";
import { INVESTMENT_CATEGORIES, PRODUCT_PATTERN, RECONCILIATION_KINDS } from "./shared";

/** A quantity or a unit price: a plain decimal, not negative ("0.5", "182.34"). */
const decimalInput = () => z.string().regex(/^\s*\d+(\.\d+)?\s*$/);
const note = z.string().max(200).nullable().default(null);
/** A provider's credentials by the names of its fields (`credentialFields`); write only. */
const credentials = z.record(z.string(), z.string().max(4096));

export const manualServiceBody = z
  .object({
    accountId: id(),
    category: z.enum(INVESTMENT_CATEGORIES),
    /** A web address; without a scheme it is `https://`. */
    url: z.string().max(500).nullable().default(null),
  })
  .strict();

/**
 * A manual service on a new account, in one write (R5b, audit OP-8): the four fields of the form —
 * name, kind (`category`), currency, value today — and the address. The account and the service are
 * made together, or neither is.
 */
export const newManualServiceBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(INVESTMENT_CATEGORIES),
    currency: z.string().regex(/^[A-Z]{3}$/),
    value: amountInput(),
    url: z.string().max(500).nullable().default(null),
  })
  .strict();

/**
 * A manual portfolio (R5d): a service that keeps positions and writes its account's value, on an
 * existing investment account no source reads, or on a new one from its name and currency.
 */
export const portfolioBody = z
  .object({
    kind: z.literal("portfolio"),
    accountId: id(),
    url: z.string().max(500).nullable().default(null),
  })
  .strict();

export const newPortfolioBody = z
  .object({
    kind: z.literal("portfolio"),
    name: z.string().trim().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
    url: z.string().max(500).nullable().default(null),
  })
  .strict();

/** Where an asset's price comes from: the daily close of its market, or the person (R5d). */
export const priceModeBody = z.object({ mode: z.enum(["auto", "manual"]) }).strict();

export const urlBody = z.object({ url: z.string().max(500) }).strict();

export const valueBody = z.object({ on: civilDate(), amount: amountInput() }).strict();

/**
 * An operation a person writes on a holding (§4.9). A price wins over an amount: `amount` counts only
 * without `unitPrice` (or, for a sale, without `quantity` and `unitPrice`).
 */
export const operationBody = z.discriminatedUnion("kind", [
  /**
   * «Record operation» of a manual portfolio (R5d): an instrument of `GET /instruments/search` on
   * the market of the order (`mic`; null for one with no market, priced by hand). The price is in
   * the instrument's currency; `fxRate` (account currency per unit of it) wins over the ECB rate.
   */
  z
    .object({
      kind: z.literal("buy"),
      instrumentId: id(),
      mic: z
        .string()
        .regex(/^[A-Z0-9]{4}$/)
        .nullable()
        .default(null),
      on: civilDate(),
      quantity: decimalInput().nullable().default(null),
      unitPrice: decimalInput().nullable().default(null),
      amount: amountInput().nullable().default(null),
      fee: amountInput().nullable().default(null),
      fxRate: decimalInput().nullable().default(null),
      note,
    })
    .strict(),
  z
    .object({
      kind: z.literal("valuation"),
      holdingId: id(),
      on: civilDate(),
      unitPrice: decimalInput().nullable().default(null),
      amount: amountInput().nullable().default(null),
      note,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["sell", "close"]),
      holdingId: id(),
      on: civilDate(),
      quantity: decimalInput().nullable().default(null),
      unitPrice: decimalInput().nullable().default(null),
      amount: amountInput().nullable().default(null),
      fee: amountInput().nullable().default(null),
      note,
    })
    .strict(),
  z
    .object({
      kind: z.literal("income"),
      holdingId: id().nullable().default(null),
      on: civilDate(),
      amount: amountInput(),
      note,
    })
    .strict(),
  /**
   * A fee of its own on a manual portfolio (R5d, PERS-591): a custody or a stamp duty paid from the
   * cash. Its cash rule is a purchase's: below zero at the end of a day, `negative_cash`.
   */
  z
    .object({
      kind: z.literal("fee"),
      on: civilDate(),
      amount: amountInput(),
      note,
    })
    .strict(),
  /**
   * Money in and out of a manual portfolio (R5d): its day, its amount and, when one documents it,
   * the bank movement. On any other service they come from Accounts or the provider: `not_editable`.
   */
  z.looseObject({
    kind: z.enum(["deposit", "withdrawal"]),
    on: civilDate().optional(),
    amount: amountInput().optional(),
    transactionId: id().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  }),
  /** The value and a correction come from Accounts or the provider: always `not_editable`. */
  z.looseObject({ kind: z.enum(["account_valuation", "adjustment"]) }),
]);

/**
 * «Switch to positions» (R5d, D4): a manual account kept by value becomes a manual portfolio from the
 * day `on`. Its value of that day stays: the positions are opened at their price, and the cash is the
 * rest. Positions worth more than the value: `409` `negative_cash`.
 */
export const conversionBody = z
  .object({
    on: civilDate(),
    positions: z
      .array(
        z
          .object({
            instrumentId: id(),
            mic: z
              .string()
              .regex(/^[A-Z0-9]{4}$/)
              .nullable()
              .default(null),
            quantity: decimalInput(),
            unitPrice: decimalInput(),
            fxRate: decimalInput().nullable().default(null),
          })
          .strict(),
      )
      .max(100),
    note,
  })
  .strict();

export const reconciliationBody = z
  .object({
    kind: z.enum(RECONCILIATION_KINDS),
    effectiveOn: civilDate(),
    /** `partial`: how much of the position the provider covers. */
    quantity: decimalInput().nullable().default(null),
    /** `outside_scope`: the product the position really is in. */
    product: z.string().regex(new RegExp(PRODUCT_PATTERN)).nullable().default(null),
    readingId: id().nullable().default(null),
  })
  .strict();

export const transferBody = z.object({ withdrawalId: id(), depositId: id() }).strict();

export const connectBody = z
  .object({
    provider: z.string().min(1).max(40),
    credentials,
    /** The account of Accounts the key is connected to: Investments creates none. */
    target: z.object({ kind: z.literal("existing"), accountId: id() }).strict(),
  })
  .strict();

export const keyBody = z.object({ credentials }).strict();
