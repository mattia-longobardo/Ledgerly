// What the descriptors of interests share (rewrite plan R2, 05-refactor.md §5.5 «interests»; audit
// INT-3, INT-4, INT-5): the vocabularies of the wire and the row of a rule, used by the REST routes,
// by the MCP tools and by the pages alike. No route is declared here.
import { z } from "zod";
import { civilDate, id, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/interests`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const DAY_BASES = ["365", "360"] as const;
export const SETTLEMENTS = ["daily", "monthly", "quarterly", "annual"] as const;
export const RULE_MODES = ["analyze_only", "post_to_provider"] as const;
export const RULE_STATES = ["active", "paused"] as const;
export const ACCRUAL_STATUSES = ["accrued", "negative_balance", "no_balance"] as const;
export const POSTING_STATES = ["none", "claimed", "posted", "indeterminate"] as const;
export const RECONCILIATION_STATUSES = [
  "no_data",
  "indeterminate",
  "matched",
  "missing",
  "delayed",
  "anomalous",
] as const;
/** The longest match text the form takes. */
export const MAX_MATCH = 80;
/** How many of a rule's latest days its page lists. */
export const MAX_DAYS = 90;

/**
 * A refusal of the interests' use cases (`InterestError`): `invalid` (`reason` `invalid`,
 * `invalid_account`, `invalid_tiers`, `invalid_category`), `conflict` (`reason` `not_synced`: a rule
 * that publishes needs a synced account), `not_found`.
 */
export const INTEREST_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const RULE_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
export const ENTRY_ID = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
export const ACCRUAL_ID = "0f1a2b3c-4d5e-4f6a-9b7c-8d9e0f1a2b3c";
export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
export const CATEGORY_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";

export const byRule = z.object({ id: id() });
export const bySettlement = z.object({ id: id(), entryId: id() });

/** A rate on the way out: a plain percentage, as the form takes it back ("2.75", "26", "0"). */
const percent = () => z.string().regex(/^\d{1,3}(\.\d{1,4})?$/);

/** One band of a rule: the rate up to `upTo`; the last band has no upper bound. */
const tier = z.object({ upTo: money().nullable(), rate: percent() });

/**
 * One rule as the Interests page, its export, the rule's page and `list_interest_rules` show it: the
 * fields of its form and what the server sums for it (INT-4: one sum of the accruals). R3: the client
 * does no sums.
 */
export const ruleRow = z.object({
  id: id(),
  accountId: id(),
  account: z.string(),
  validFrom: civilDate(),
  validTo: civilDate().nullable(),
  /** The hour it accrues at, 0–23; null: the default hour. */
  runHour: z.number().int().min(0).max(23).nullable(),
  tiers: z.array(tier),
  /** The tax withheld, as a percentage. */
  tax: percent(),
  dayBasis: z.enum(DAY_BASES),
  settlement: z.enum(SETTLEMENTS),
  /** The text looked for in the bank's payment; null: no reconciliation. */
  payeeMatch: z.string().nullable(),
  mode: z.enum(RULE_MODES),
  /** The category a published settlement is filed under; null: none. */
  categoryId: id().nullable(),
  state: z.enum(RULE_STATES),
  /** Net accrued this year: the settlements that start this year plus what is not settled yet. */
  accruedYtd: money(),
  /** Gross accrued since 1 January, rounded once. */
  grossYtd: money(),
  /** The day the period under way settles; null for a paused or ended rule. */
  nextPayout: civilDate().nullable(),
});

export const RULE_ROW_EXAMPLE = {
  id: RULE_ID,
  accountId: ACCOUNT_ID,
  account: "Savings",
  validFrom: "2026-01-01",
  validTo: null,
  runHour: null,
  tiers: [
    { upTo: "20000.00", rate: "2.75" },
    { upTo: null, rate: "1.5" },
  ],
  tax: "26",
  dayBasis: "365",
  settlement: "monthly",
  payeeMatch: "INTEREST",
  mode: "analyze_only",
  categoryId: null,
  state: "active",
  accruedYtd: "312.40",
  grossYtd: "422.16",
  nextPayout: "2026-12-01",
};
