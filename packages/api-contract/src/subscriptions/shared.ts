// What the descriptors of subscriptions share (rewrite plan R2, 05-refactor.md §5.5 «subscriptions»;
// audit SUB-3, SUB-7): the vocabularies of the wire and the row of a subscription, used by the REST
// routes, by the MCP tool and by the page alike. No route is declared here.
import { z } from "zod";
import { civilDate, hexColor, id, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/subscriptions`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const CYCLES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const SUBSCRIPTION_STATES = ["active", "paused", "cancelled"] as const;
export const CHARGE_STATES = ["paid", "amount_differs", "due", "not_found"] as const;
/** The longest name and match text the form takes. */
export const MAX_NAME = 80;
export const MAX_MATCH = 80;
/** The lowest and highest utility. */
export const MIN_UTILITY = 1;
export const MAX_UTILITY = 10;

/**
 * A refusal of the subscriptions' use cases (`SubscriptionError`): `invalid` (`reason` `invalid`,
 * `invalid_account`, `invalid_category`), `conflict` (`reason` `not_cancelled`), `not_found`.
 */
export const SUBSCRIPTION_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const SUBSCRIPTION_ID = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b";
export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
export const CATEGORY_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";
export const CHARGE_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

export const bySubscription = z.object({ id: id() });

/** The check of one expected charge: the period under way, or one due within a week. */
const chargeCheck = z.object({
  id: id(),
  dueOn: civilDate(),
  state: z.enum(CHARGE_STATES),
  /** The price when the period was written. */
  expected: money(),
  /** What the movement found was; null while none is. */
  actual: money().nullable(),
});

/**
 * One subscription as the Subscriptions page, its export and `list_subscriptions` show it: the fields
 * of its form and what the server derives from them (the monthly and yearly cost, the next charge,
 * the check of the period under way). R3: the client does no sums.
 */
export const subscriptionRow = z.object({
  id: id(),
  name: z.string(),
  state: z.enum(SUBSCRIPTION_STATES),
  categoryId: id().nullable(),
  category: z.string().nullable(),
  /** The category's colour, or its group's for a sub-category. */
  categoryColor: hexColor().nullable(),
  /** The account that pays it; null for «any account». */
  accountId: id().nullable(),
  account: z.string().nullable(),
  /** Positive, in EUR. */
  price: money(),
  cycle: z.enum(CYCLES),
  /** The date of one charge, as the person entered it: the anchor of the calendar its form edits. */
  chargeOn: civilDate(),
  /** The next charge on or after today whose period is not paid yet. */
  nextChargeOn: civilDate(),
  utility: z.number().int().min(MIN_UTILITY).max(MAX_UTILITY),
  /** The text looked for in the payee; null: the subscription is not checked. */
  payeeMatch: z.string().nullable(),
  /** The tolerance as a percentage, two decimals ("5.00"). */
  tolerance: z.string().regex(/^\d{1,3}\.\d{2}$/),
  monthly: money(),
  yearly: money(),
  /** Null: nothing is due in the period under way («Not due»). */
  current: chargeCheck.nullable(),
  /** The last charge found, on the day of its movement. */
  lastMatch: z.object({ on: civilDate(), amount: money() }).nullable(),
});

/** What the active subscriptions on one account (or on none) commit within the horizon. */
export const projection = z.object({
  /** Null: the subscriptions with no paying account. */
  accountId: id().nullable(),
  account: z.string().nullable(),
  count: z.number().int(),
  /** The account's latest balance, in EUR; null without one or with no rate (D4). */
  balance: money().nullable(),
  /** The charges due from today to the horizon that have not been found yet. Positive. */
  commit: money(),
  /** `balance − commit`; null as `balance`. */
  projected: money().nullable(),
});

export const alert = z.object({
  subscriptionId: id(),
  name: z.string(),
  charge: chargeCheck,
  account: z.string().nullable(),
  payeeMatch: z.string().nullable(),
});

export const SUBSCRIPTION_ROW_EXAMPLE = {
  id: SUBSCRIPTION_ID,
  name: "Streaming",
  state: "active",
  categoryId: CATEGORY_ID,
  category: "Entertainment",
  categoryColor: "#cc6633",
  accountId: ACCOUNT_ID,
  account: "Checking",
  price: "12.99",
  cycle: "monthly",
  chargeOn: "2026-01-15",
  nextChargeOn: "2026-11-15",
  utility: 7,
  payeeMatch: "STREAMING",
  tolerance: "5.00",
  monthly: "12.99",
  yearly: "155.88",
  current: { id: CHARGE_ID, dueOn: "2026-11-15", state: "paid", expected: "12.99", actual: "12.99" },
  lastMatch: { on: "2026-11-15", amount: "12.99" },
};
