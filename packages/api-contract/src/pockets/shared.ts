// What the descriptors of pockets share (rewrite plan R2, 05-refactor.md §5.5 «pockets»; audit POC-1,
// POC-6): the vocabularies of the wire and the row of a pocket, used by the REST routes, by the MCP
// tool and by the pages alike. No route is declared here.
import { z } from "zod";
import { civilDate, hexColor, id, money, monthStart } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/pockets`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const POCKET_STATES = ["active", "paused", "archived"] as const;
/** Why a pocket's share of its account's interest is what it is (spec §7.4). */
export const INTEREST_REASONS = ["estimate", "no_interest_data", "standalone"] as const;
/** How far back a pocket's chart looks. */
export const HISTORY_MONTHS = 12;
/** The longest name and planned description the forms take. */
export const MAX_NAME = 60;
export const MAX_DESCRIPTION = 200;

/**
 * A refusal of the pockets' use cases (`PocketError`): `invalid` (`reason` `invalid`,
 * `invalid_account`, `future_date`, `past_date`, `not_expense`), `conflict` (`reason`
 * `duplicate_name`, `archived`, `backed`, `already_linked`), `not_found`.
 */
export const POCKET_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const POCKET_ID = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
export const TRANSACTION_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
export const PLANNED_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

export const byPocket = z.object({ id: id() });

/**
 * One open pocket as the Pockets page, its card and `list_pockets` show it: what it is, what is left
 * and how far it is from its target, computed by the server (R3: the client does no sums).
 */
export const pocketRow = z.object({
  id: id(),
  name: z.string(),
  color: hexColor().nullable(),
  state: z.enum(POCKET_STATES),
  /** The account it rests on; null for a standalone pocket. */
  accountId: id().nullable(),
  account: z.string().nullable(),
  startMonth: monthStart(),
  target: money().nullable(),
  /** What it is given each month; null when it is filled by hand only. */
  monthly: money().nullable(),
  /** What is left: what it was given minus what was spent. Negative when overspent. */
  balance: money(),
  /** Balance over target, whole, rounded half up, past 100 when beyond; null without a target. */
  percent: z.number().int().nullable(),
  /** The planned expenses still shown and what would be left once they are made. */
  planned: z.object({ count: z.number().int(), total: money(), after: money() }),
});

/** An archived pocket: what «Restore» and the export need. */
export const archivedPocket = z.object({
  id: id(),
  name: z.string(),
  color: hexColor().nullable(),
  target: money().nullable(),
  monthly: money().nullable(),
});

/** An expense counted against a pocket, newest first on its page. */
export const pocketExpense = z.object({
  /** The movement's id; a withdrawal recorded by hand before expenses were linked has its own. */
  id: id(),
  on: civilDate(),
  /** Positive. */
  amount: money(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  account: z.string().nullable(),
  /** Filed by hand under a standalone pocket: `DELETE …/expenses/{transaction}` takes it out. */
  linked: z.boolean(),
  /** A withdrawal recorded by hand, not a bank movement. */
  manual: z.boolean(),
});

export const plannedExpense = z.object({
  id: id(),
  description: z.string(),
  /** Positive. */
  amount: money(),
  dueOn: civilDate(),
  /** Its day has passed; it stays a week, then goes. */
  overdue: z.boolean(),
});

/** An expense a standalone pocket can take («Link an expense»). */
export const linkCandidate = z.object({
  id: id(),
  on: civilDate(),
  /** Positive. */
  amount: money(),
  payee: z.string().nullable(),
  account: z.string().nullable(),
});

export const POCKET_ROW_EXAMPLE = {
  id: POCKET_ID,
  name: "Holiday",
  color: "#3366cc",
  state: "active",
  accountId: ACCOUNT_ID,
  account: "Savings",
  startMonth: "2026-01-01",
  target: "1500.00",
  monthly: "100.00",
  balance: "620.00",
  percent: 41,
  planned: { count: 1, total: "200.00", after: "420.00" },
};
