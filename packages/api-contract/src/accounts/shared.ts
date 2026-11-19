// What the descriptors of accounts share (rewrite plan R2, 05-refactor.md §5.5 «accounts»): the
// vocabularies of the wire and one DTO per resource, used by the REST route and by its MCP tool
// alike (audit ACC-5, API-2). No route is declared here.
import { z } from "zod";
import { id, instant, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/accounts`, `rules.ts`): the contract imports
// zod only (10-modularity.md §10.2), so `tools/contract.test.ts` holds the two lists equal.
export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "investment",
  "pension",
  "crypto",
  "credit",
  "other",
] as const;
export const ACCOUNT_STATES = ["active", "unavailable", "archived"] as const;
export const ACCOUNT_ORIGINS = ["manual", "synced"] as const;
export const ENTRY_SOURCES = [
  "manual",
  "provider",
  "system",
  "import",
  "derived",
  "portfolio",
  "movement",
] as const;
export const REMINDERS = ["monthly", "quarterly", "never"] as const;
export const TRENDS = ["hold", "interpolate"] as const;
export const CONNECTION_CHANNELS = ["iban", "card"] as const;
export const SNAPSHOT_STATES = ["success", "warning", "failed"] as const;

/**
 * A refusal of the accounts' use cases: `invalid` (`reason` `future_date`, `iban_invalid`,
 * `invalid`), `conflict` (`reason` `synced_locked`, `currency_locked`, `managed_locked`,
 * `duplicate_name`, `duplicate_connection`, `iban_exists`, `iban_archived`, `in_use`). An IBAN
 * never travels in an answer (H45): `other` is the name of the account that has it.
 */
export const ACCOUNT_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
export const OTHER_ACCOUNT_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
export const ENTRY_ID = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
export const byAccount = z.object({ id: id() });

/** An account as `GET /accounts` lists it, unchanged since F8 (`baselines/contract/api.json`). */
export const accountRow = z.object({
  id: id(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string(),
  origin: z.enum(ACCOUNT_ORIGINS),
  state: z.enum(ACCOUNT_STATES),
  inNetWorth: z.boolean(),
  countsAsLiquid: z.boolean(),
  /** The latest reading on or before today, in the account's currency; null while it has none. */
  balance: money().nullable(),
  lastSyncedAt: instant().nullable(),
});

export const ACCOUNT_ROW_EXAMPLE = {
  id: ACCOUNT_ID,
  name: "Everyday account",
  type: "checking",
  currency: "EUR",
  origin: "manual",
  state: "active",
  inNetWorth: true,
  countsAsLiquid: true,
  balance: "11302.40",
  lastSyncedAt: null,
};

/** One recorded balance, as `GET /accounts/{id}/balances` and `get_account_balances` give it. */
export const balanceEntry = z.object({
  id: id(),
  on: z.string(),
  balance: money(),
  available: money().nullable(),
  source: z.enum(ENTRY_SOURCES),
  note: z.string().nullable(),
  capturedAt: instant(),
});

/**
 * What changed between two values: the amount, and the fraction of the earlier one. Either value
 * unknown gives `amount: null`; an earlier value of zero gives `fraction: null`.
 */
export const delta = z.object({ amount: money().nullable(), fraction: z.number().nullable() });

export const BALANCE_ENTRY_EXAMPLE = {
  id: ENTRY_ID,
  on: "2026-10-31",
  balance: "11302.40",
  available: null,
  source: "manual",
  note: null,
  capturedAt: "2026-11-01T08:00:00.000Z",
};
