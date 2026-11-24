// Interests (rewrite plan R2, 05-refactor.md §5.5 «interests»; audit INT-3, INT-4, INT-5): the rules
// as the Interests page, its export and `list_interest_rules` show them, one rule's page with its
// settlements and days, and the writes of the two pages. Amounts in are decimal strings
// (`amountInput`) and rates plain percentages: the conversion from the person's number format stays
// with the client, the one from a percentage to the stored fraction is the domain's.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, id, instant, money, percentInput } from "../primitives";
import {
  ACCOUNT_ID,
  ACCRUAL_ID,
  ACCRUAL_STATUSES,
  byRule,
  bySettlement,
  CATEGORY_ID,
  DAY_BASES,
  DAY_COUNTS,
  ENTRY_ID,
  INTEREST_ERRORS,
  MAX_DAYS,
  MAX_MATCH,
  MAX_PAYMENT_WINDOW_DAYS,
  PERIOD_ANCHORS,
  POSTING_STATES,
  RECONCILIATION_STATUSES,
  RULE_ID,
  RULE_MODES,
  RULE_ROW_EXAMPLE,
  RULE_STATES,
  ruleRow,
  SETTLEMENTS,
} from "./shared";

export const listInterestRules = defineRoute({
  id: "list_interest_rules",
  method: "GET",
  path: "/interests",
  scope: "read",
  capability: "interests",
  summary:
    "The interest rules (oldest first) with what each accrued since 1 January and its next payout, the " +
    "totals of the year, and the open accounts a rule can be on, each saying whether it can publish.",
  actions: [],
  response: z.object({
    rules: z.array(ruleRow),
    /** The sums of the rows: net and gross accrued since 1 January of `year`. */
    totals: z.object({ year: z.string().regex(/^\d{4}$/), accruedYtd: money(), grossYtd: money() }),
    /**
     * The open accounts a rule can be on. `publishable`: its source is connected and writes, so a rule
     * on it can publish its settlements.
     */
    accounts: z.array(z.object({ id: id(), name: z.string(), publishable: z.boolean() })),
  }),
  errors: [],
  mcp: {
    title: "Interest rules",
    description:
      "The interest rules on the accounts: rate bands, tax, day basis, settlement, what each accrued " +
      "since 1 January, net and gross, and the next payout.",
  },
  example: {
    response: {
      rules: [RULE_ROW_EXAMPLE],
      totals: { year: "2026", accruedYtd: "312.40", grossYtd: "422.16" },
      accounts: [{ id: ACCOUNT_ID, name: "Savings", publishable: false }],
    },
  },
});

export const getInterestRule = defineRoute({
  id: "get_interest_rule",
  method: "GET",
  path: "/interests/{id}",
  scope: "read",
  capability: "interests",
  summary:
    "One rule's page: the rule, where its account's balance stands for the accrual, its settlements " +
    `(newest first) reconciled with what was paid, and its latest ${MAX_DAYS} days.`,
  actions: [],
  params: byRule,
  response: z.object({
    rule: ruleRow,
    /** The name of `rule.categoryId`; null for none or one no longer there. */
    category: z.string().nullable(),
    /** Net accrued in the period under way, not settled yet. */
    pending: money(),
    /** The page's year to date: the same figure as `rule.accruedYtd`. */
    accruedYtd: money(),
    /**
     * The balance the accrual reads (D7: the threshold of the accrual, not the account's own
     * `staleAfterHours`). `staleForAccrual`: a synced account whose last reading is too old to accrue
     * on — the days are on hold until a fresh one.
     */
    balance: z.object({
      synced: z.boolean(),
      lastSyncedAt: instant().nullable(),
      staleForAccrual: z.boolean(),
    }),
    settlements: z.array(
      z.object({
        id: id(),
        periodFrom: civilDate(),
        periodTo: civilDate(),
        settleOn: civilDate(),
        accruedDays: z.number().int(),
        skippedDays: z.number().int(),
        gross: money(),
        tax: money(),
        net: money(),
        /** What the bank paid for it, or what was published; null when there is no way to tell. */
        paid: money().nullable(),
        status: z.enum(RECONCILIATION_STATUSES),
        posting: z.enum(POSTING_STATES),
        /** Why the last posting did not land, or `category_not_linked` on a posted one. */
        postingError: z.string().nullable(),
      }),
    ),
    /** Newest first, the skipped ones too. */
    days: z.array(
      z.object({
        id: id(),
        on: civilDate(),
        /** Null: no balance that day. */
        balance: money().nullable(),
        net: money(),
        status: z.enum(ACCRUAL_STATUSES),
      }),
    ),
  }),
  errors: ["not_found"],
  mcp: {
    title: "Interest rule",
    description:
      "One interest rule with its settlements, each reconciled with what the bank paid, its posting to " +
      "the source and its latest days of accrual.",
    arguments: { rule_id: id().describe("The rule's id, from list_interest_rules.") },
    pathArguments: { id: "rule_id" },
  },
  example: {
    params: { id: RULE_ID },
    response: {
      rule: RULE_ROW_EXAMPLE,
      category: null,
      pending: "18.20",
      accruedYtd: "312.40",
      balance: { synced: false, lastSyncedAt: null, staleForAccrual: false },
      settlements: [
        {
          id: ENTRY_ID,
          periodFrom: "2026-10-01",
          periodTo: "2026-10-31",
          settleOn: "2026-11-01",
          accruedDays: 31,
          skippedDays: 0,
          gross: "38.12",
          tax: "9.91",
          net: "28.21",
          paid: "28.21",
          status: "matched",
          posting: "none",
          postingError: null,
        },
      ],
      days: [{ id: ACCRUAL_ID, on: "2026-11-20", balance: "18000.00", net: "1.00", status: "accrued" }],
    },
  },
});

/**
 * The rule dialog. Bands from the lowest; every band but the last has its upper bound, the last has
 * none. An empty match text is no reconciliation; no tax is 0 %.
 */
const ruleBody = z
  .object({
    accountId: id(),
    validFrom: civilDate(),
    validTo: civilDate().nullable(),
    runHour: z.number().int().min(0).max(23).nullable(),
    tiers: z.array(z.object({ upTo: amountInput().nullable(), rate: percentInput() }).strict()).min(1),
    tax: percentInput(),
    /** Deprecated since R5g: read only without `dayCount`. */
    dayBasis: z.enum(DAY_BASES).optional(),
    /** The day-count convention; missing: `dayBasis`, or "365". */
    dayCount: z.enum(DAY_COUNTS).optional(),
    periodAnchor: z.enum(PERIOD_ANCHORS).optional(),
    /** Days after the settlement date the payment is looked for; null or missing: the default window. */
    paymentWindowDays: z.number().int().min(0).max(MAX_PAYMENT_WINDOW_DAYS).nullable().optional(),
    settlement: z.enum(SETTLEMENTS),
    payeeMatch: z.string().trim().max(MAX_MATCH).nullable(),
    mode: z.enum(RULE_MODES),
    categoryId: id().nullable(),
    state: z.enum(RULE_STATES),
  })
  .strict();

const RULE_BODY_EXAMPLE = {
  accountId: ACCOUNT_ID,
  validFrom: "2026-01-01",
  validTo: null,
  runHour: null,
  tiers: [
    { upTo: "20000", rate: "2.75" },
    { upTo: null, rate: "1.5" },
  ],
  tax: "26",
  dayCount: "365",
  periodAnchor: "calendar",
  paymentWindowDays: null,
  settlement: "monthly",
  payeeMatch: "INTEREST",
  mode: "analyze_only",
  categoryId: CATEGORY_ID,
  state: "active",
};

export const createInterestRule = defineRoute({
  id: "create_interest_rule",
  method: "POST",
  path: "/interests",
  scope: "write",
  capability: "interests",
  summary:
    "Creates a rule and accrues it at once up to yesterday, settling the periods that have closed. " +
    "Rates are percentages; `mode_retired` (422) for `mode: post_to_provider`: no rule publishes on its " +
    "source since R5c.",
  actions: [],
  body: ruleBody,
  response: z.object({ id: id() }),
  status: 201,
  errors: INTEREST_ERRORS,
  example: { body: RULE_BODY_EXAMPLE, response: { id: RULE_ID } },
});

export const updateInterestRule = defineRoute({
  id: "update_interest_rule",
  method: "PUT",
  path: "/interests/{id}",
  scope: "write",
  capability: "interests",
  summary:
    "Changes a rule: every field of the dialog, as `POST /interests` takes them. What is settled stays; " +
    "the days after the last settled period are accrued again with the new terms.",
  actions: [],
  params: byRule,
  body: ruleBody,
  response: null,
  status: 204,
  errors: INTEREST_ERRORS,
  example: { params: { id: RULE_ID }, body: RULE_BODY_EXAMPLE },
});

export const setInterestRuleState = defineRoute({
  id: "set_interest_rule_state",
  method: "PUT",
  path: "/interests/{id}/state",
  scope: "write",
  capability: "interests",
  summary: "Pauses or resumes a rule; resuming catches its days up.",
  actions: [],
  params: byRule,
  body: z.object({ state: z.enum(RULE_STATES) }).strict(),
  response: null,
  status: 204,
  errors: INTEREST_ERRORS,
  example: { params: { id: RULE_ID }, body: { state: "paused" } },
});

const postingAnswer = z.object({ posting: z.enum(POSTING_STATES) });

export const postInterestSettlement = defineRoute({
  id: "post_interest_settlement",
  method: "POST",
  path: "/interests/{id}/settlements/{entryId}/posting",
  scope: "write",
  capability: "interests",
  summary:
    "«Post now» (from not posted) or, with `retry`, «Retry» (from unsure): answers where a settlement's " +
    "posting stands. Since R5c nothing is published on the source (decision H37): the state stays as it is.",
  actions: [],
  params: bySettlement,
  body: z.object({ retry: z.boolean() }).strict(),
  response: postingAnswer,
  errors: ["not_found"],
  example: {
    params: { id: RULE_ID, entryId: ENTRY_ID },
    body: { retry: false },
    response: { posting: "posted" },
  },
});

export const markInterestSettlementPosted = defineRoute({
  id: "mark_interest_settlement_posted",
  method: "PUT",
  path: "/interests/{id}/settlements/{entryId}/posted",
  scope: "write",
  capability: "interests",
  summary: "«Mark as posted»: the person saw the record on the source; nothing is sent.",
  actions: [],
  params: bySettlement,
  response: postingAnswer,
  errors: ["not_found"],
  example: { params: { id: RULE_ID, entryId: ENTRY_ID }, response: { posting: "posted" } },
});
