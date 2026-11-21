// Subscriptions (rewrite plan R2, 05-refactor.md §5.5 «subscriptions»; audit SUB-1, SUB-3, SUB-7): the
// subscriptions as the Subscriptions page, its export and `list_subscriptions` show them, the
// suggestions from the recurring payments, and the four writes of the page. Amounts in are decimal
// strings (`amountInput`) and the tolerance a plain percentage: the conversion from the person's number
// format stays with the client, the one from a percentage to the stored fraction is the domain's.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, hexColor, id, money, percentInput } from "../primitives";
import {
  ACCOUNT_ID,
  alert,
  bySubscription,
  CATEGORY_ID,
  CHARGE_ID,
  CYCLES,
  MAX_MATCH,
  MAX_NAME,
  MAX_UTILITY,
  MIN_UTILITY,
  projection,
  SUBSCRIPTION_ERRORS,
  SUBSCRIPTION_ID,
  SUBSCRIPTION_ROW_EXAMPLE,
  SUBSCRIPTION_STATES,
  subscriptionRow,
} from "./shared";

export const listSubscriptions = defineRoute({
  id: "list_subscriptions",
  method: "GET",
  path: "/subscriptions",
  scope: "read",
  capability: "subscriptions",
  summary:
    "The subscriptions (the active ones, then the paused and the cancelled), the totals of the " +
    "Subscriptions page, the payment alerts, the yearly cost by category group, what the active ones " +
    "commit on each paying account within 30 and 365 days, and the accounts a subscription can be " +
    "paid from.",
  actions: [],
  response: z.object({
    /** The active ones, by name. */
    subscriptions: z.array(subscriptionRow),
    /** The paused and the cancelled, by name. */
    inactive: z.array(subscriptionRow),
    totals: z.object({
      /** Of the active ones. */
      monthly: money(),
      yearly: money(),
      /** The active ones rated 5 or less. */
      lowUtility: z.object({ yearly: money(), count: z.number().int() }),
      /** The charges due from today to `until` that have not been found yet. */
      next30: z.object({ amount: money(), until: civilDate() }),
    }),
    alerts: z.array(alert),
    /** By yearly cost, largest first. */
    byCategory: z.array(
      z.object({
        groupId: id().nullable(),
        name: z.string().nullable(),
        color: hexColor().nullable(),
        yearly: money(),
      }),
    ),
    projections: z.object({ month: z.array(projection), year: z.array(projection) }),
    /** The open accounts a subscription can be paid from. */
    accounts: z.array(z.object({ id: id(), name: z.string() })),
  }),
  errors: [],
  mcp: {
    title: "Subscriptions",
    description:
      "The subscriptions with their price, cycle, next charge and the payment check of the period under " +
      "way, the monthly and yearly totals, the payment alerts and what they commit on each paying account.",
  },
  example: {
    response: {
      subscriptions: [SUBSCRIPTION_ROW_EXAMPLE],
      inactive: [],
      totals: {
        monthly: "12.99",
        yearly: "155.88",
        lowUtility: { yearly: "0.00", count: 0 },
        next30: { amount: "12.99", until: "2026-12-10" },
      },
      alerts: [
        {
          subscriptionId: SUBSCRIPTION_ID,
          name: "Streaming",
          charge: { id: CHARGE_ID, dueOn: "2026-12-15", state: "due", expected: "12.99", actual: null },
          account: "Checking",
          payeeMatch: "STREAMING",
        },
      ],
      byCategory: [{ groupId: CATEGORY_ID, name: "Entertainment", color: "#cc6633", yearly: "155.88" }],
      projections: {
        month: [
          {
            accountId: ACCOUNT_ID,
            account: "Checking",
            count: 1,
            balance: "900.00",
            commit: "12.99",
            projected: "887.01",
          },
        ],
        year: [
          {
            accountId: ACCOUNT_ID,
            account: "Checking",
            count: 1,
            balance: "900.00",
            commit: "155.88",
            projected: "744.12",
          },
        ],
      },
      accounts: [{ id: ACCOUNT_ID, name: "Checking" }],
    },
  },
});

export const listSubscriptionSuggestions = defineRoute({
  id: "list_subscription_suggestions",
  method: "GET",
  path: "/subscriptions/suggestions",
  scope: "read",
  capability: "subscriptions",
  summary:
    "«Suggest from recurring payments»: the outgoing recurring payments with a subscription cycle that " +
    "no subscription, in any state, covers yet. By name.",
  actions: [],
  response: z.object({
    suggestions: z.array(
      z.object({
        /** The payee's key: what tells two suggestions apart. */
        key: z.string(),
        /** The payee as the bank wrote it: the name and the match text the form starts from. */
        name: z.string(),
        /** The median charge, positive. */
        price: money(),
        cycle: z.enum(CYCLES),
        nextChargeOn: civilDate(),
        accountId: id(),
        categoryId: id().nullable(),
        occurrences: z.number().int(),
      }),
    ),
  }),
  errors: [],
  example: {
    response: {
      suggestions: [
        {
          key: "musicstore",
          name: "MUSIC STORE",
          price: "9.99",
          cycle: "monthly",
          nextChargeOn: "2026-12-03",
          accountId: ACCOUNT_ID,
          categoryId: null,
          occurrences: 6,
        },
      ],
    },
  },
});

/** The subscription dialog: an empty match text is no check at all; no tolerance is 5 %. */
const subscriptionBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    categoryId: id().nullable(),
    accountId: id().nullable(),
    price: amountInput(),
    cycle: z.enum(CYCLES),
    chargeOn: civilDate(),
    payeeMatch: z.string().trim().max(MAX_MATCH).nullable(),
    tolerance: percentInput().optional(),
    utility: z.number().int().min(MIN_UTILITY).max(MAX_UTILITY),
  })
  .strict();

const SUBSCRIPTION_BODY_EXAMPLE = {
  name: "Streaming",
  categoryId: CATEGORY_ID,
  accountId: ACCOUNT_ID,
  price: "12.99",
  cycle: "monthly",
  chargeOn: "2026-01-15",
  payeeMatch: "STREAMING",
  tolerance: "5",
  utility: 7,
};

export const createSubscription = defineRoute({
  id: "create_subscription",
  method: "POST",
  path: "/subscriptions",
  scope: "write",
  capability: "subscriptions",
  summary:
    "Creates a subscription and checks its charges against the movements. The price is a positive " +
    "decimal string, the tolerance a percentage (5 when left out).",
  actions: [],
  body: subscriptionBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: SUBSCRIPTION_ERRORS,
  example: { body: SUBSCRIPTION_BODY_EXAMPLE, response: { id: SUBSCRIPTION_ID } },
});

export const updateSubscription = defineRoute({
  id: "update_subscription",
  method: "PUT",
  path: "/subscriptions/{id}",
  scope: "write",
  capability: "subscriptions",
  summary:
    "Changes a subscription: every field of the dialog, as `POST /subscriptions` takes them; its charges " +
    "are checked again.",
  actions: [],
  params: bySubscription,
  body: subscriptionBody,
  response: null,
  status: 204,
  errors: SUBSCRIPTION_ERRORS,
  example: { params: { id: SUBSCRIPTION_ID }, body: SUBSCRIPTION_BODY_EXAMPLE },
});

export const setSubscriptionState = defineRoute({
  id: "set_subscription_state",
  method: "PUT",
  path: "/subscriptions/{id}/state",
  scope: "write",
  capability: "subscriptions",
  summary: "Pauses, resumes, cancels or brings back a subscription.",
  actions: [],
  params: bySubscription,
  body: z.object({ state: z.enum(SUBSCRIPTION_STATES) }).strict(),
  response: null,
  status: 204,
  errors: SUBSCRIPTION_ERRORS,
  example: { params: { id: SUBSCRIPTION_ID }, body: { state: "paused" } },
});

export const deleteSubscription = defineRoute({
  id: "delete_subscription",
  method: "DELETE",
  path: "/subscriptions/{id}",
  scope: "write",
  capability: "subscriptions",
  summary:
    "Deletes a cancelled subscription and the charges it had checked; the movements stay. `conflict` " +
    "(`not_cancelled`) for one that is not cancelled.",
  actions: [],
  params: bySubscription,
  response: null,
  status: 204,
  errors: SUBSCRIPTION_ERRORS,
  example: { params: { id: SUBSCRIPTION_ID } },
});
