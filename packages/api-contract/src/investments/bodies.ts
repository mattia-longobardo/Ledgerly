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

export const urlBody = z.object({ url: z.string().max(500) }).strict();

export const valueBody = z.object({ on: civilDate(), amount: amountInput() }).strict();

/**
 * An operation a person writes on a holding (§4.9). A price wins over an amount: `amount` counts only
 * without `unitPrice` (or, for a sale, without `quantity` and `unitPrice`).
 */
export const operationBody = z.discriminatedUnion("kind", [
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
  /** Money in and out, the value and a correction come from Accounts or the provider: always `not_editable`. */
  z.looseObject({ kind: z.enum(["deposit", "withdrawal", "account_valuation", "adjustment"]) }),
]);

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
