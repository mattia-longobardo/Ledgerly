import { z } from "zod";
import type { CivilDate } from "../../../shared/dates";
import { civilDate, optionalText, HEX_COLOR } from "../../../shared/inputs";
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
/**
 * What hangs off an account and how it reaches it: a direct debit or a standing order on the
 * **IBAN**, or something charged to the **card** — the two lists the owner kept by hand before
 * this existed. It is a fact you know about your bank, not something a sync can tell you, so it
 * is typed in and never guessed.
 */
export const CONNECTION_CHANNELS = ["iban", "card"] as const;
export const ACCOUNT_ORIGINS = ["manual", "synced"] as const;
/**
 * `derived` (F2.5) is a month end rebuilt from the movements (`deriveMonthEnds`): it loses to every
 * other source, and is rewritten from scratch whenever the readings or the movements change.
 * `portfolio` is the daily value Investments writes for the accounts it manages
 * (docs/design/investments.md §1.7): there it is the only source from `managed_since` on.
 */
export const BALANCE_SOURCES = ["manual", "provider", "system", "import", "derived", "portfolio"] as const;
export const REMINDERS = ["monthly", "quarterly", "never"] as const;
export const TRENDS = ["hold", "interpolate"] as const;
export const SNAPSHOT_STATES = ["success", "warning", "failed"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountState = (typeof ACCOUNT_STATES)[number];
export type ConnectionChannel = (typeof CONNECTION_CHANNELS)[number];
export type AccountOrigin = (typeof ACCOUNT_ORIGINS)[number];
type BalanceSource = (typeof BALANCE_SOURCES)[number];

/**
 * Same day, more than one source: which one counts, first to last (spec §7.1; investments.md §1.7).
 * The correction a person typed comes first, a month end rebuilt from the movements last of all.
 * `SOURCE_RANK` in `queries.ts` is built from this list, so a new source has to be placed here.
 */
export const SOURCE_PRECEDENCE = [
  "manual",
  "import",
  "portfolio",
  "provider",
  "system",
  "derived",
] as const satisfies readonly BalanceSource[];
/**
 * What a balance row can also be, and is not a source of a balance: the balance after the
 * movements a person wrote by hand since the last reading (`movementBalances`, rewrite plan
 * 12-account-modes.md §12.2). Rewritten from scratch like `derived`, and gone from a day as soon
 * as a reading taken later covers it. It comes before every source of `SOURCE_PRECEDENCE`: a
 * `movement` row exists on a day only while the movements behind it were written after every
 * reading of that day, so on that day it is the latest thing known.
 */
export const MOVEMENT_SOURCE = "movement";
/** Every value the `source` of a balance row takes: the sources, and the balance after them. */
export const ENTRY_SOURCES = [...BALANCE_SOURCES, MOVEMENT_SOURCE] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];
export type Trend = (typeof TRENDS)[number];

/** The one obsolescence constant (spec §7.1): a synced account older than this is stale. */
export const DEFAULT_STALE_AFTER_HOURS = 36;

/** Overview groups accounts into KPI tiles by type, with "counts as liquid" overriding the type. */
export type Bucket = "cash" | "savings" | "investments" | "other";

const BUCKET_BY_TYPE: Record<AccountType, Bucket> = {
  checking: "cash",
  cash: "cash",
  credit: "cash",
  savings: "savings",
  investment: "investments",
  pension: "investments",
  crypto: "investments",
  other: "other",
};

export function bucketOf(account: { type: AccountType; countsAsLiquid: boolean }): Bucket {
  const natural = BUCKET_BY_TYPE[account.type];
  if (!account.countsAsLiquid) return natural;
  return natural === "investments" || natural === "other" ? "cash" : natural;
}

const CURRENCY = /^[A-Z]{3}$/;

/** Amounts arrive from forms as plain decimal strings and live as cents from here on. */
const cents = z.bigint();

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(CURRENCY).default("EUR"),
  groupId: z.uuid().nullable().default(null),
  color: z.string().regex(HEX_COLOR).nullable().default(null),
  reference: optionalText(64),
  /** As typed: the service checks it (`normalizeIban`) and answers `iban_invalid`. */
  iban: optionalText(64),
  purpose: optionalText(120),
  openedOn: civilDate().nullable().default(null),
  notes: optionalText(2000),
  openingBalance: z.object({ on: civilDate(), cents }).nullable().default(null),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(CURRENCY),
  groupId: z.uuid().nullable().default(null),
  color: z.string().regex(HEX_COLOR).nullable().default(null),
  reference: optionalText(64),
  /** As typed: the service checks it (`normalizeIban`) and answers `iban_invalid`. */
  iban: optionalText(64),
  purpose: optionalText(120),
  openedOn: civilDate().nullable().default(null),
  notes: optionalText(2000),
  inNetWorth: z.boolean(),
  inSnapshot: z.boolean(),
  countsAsLiquid: z.boolean(),
  lowBalanceCents: cents.min(0n).nullable().default(null),
  staleAfterHours: z.number().int().min(1).max(8760).default(DEFAULT_STALE_AFTER_HOURS),
  reminder: z.enum(REMINDERS),
  betweenEntries: z.enum(TRENDS),
});
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;

export const balanceEntrySchema = z.object({
  on: civilDate(),
  cents,
  availableCents: cents.nullable().default(null),
  note: optionalText(200),
});
export type BalanceEntryInput = z.infer<typeof balanceEntrySchema>;

/**
 * A synced account keeps the currency the provider gave it (spec §7.1); applied here, not only
 * hidden in the form. The type may be changed (owner, 2026-09-24): a provider may publish no way
 * to write an account's type back, so the change stays here and the sync stops following the
 * provider's type from then on — the rule the name already has.
 */
export function settingsForSynced(
  input: AccountSettingsInput,
  current: { type: AccountType; currency: string },
): AccountSettingsInput {
  return { ...input, currency: current.currency };
}

/** Manual balances are never in the future: "today" is the user's own civil date. */
export function isFutureDate(day: CivilDate, today: CivilDate): boolean {
  return day > today;
}

export function isStale(lastSyncedAt: Date | null, staleAfterHours: number, now: Date): boolean {
  if (lastSyncedAt === null) return true;
  return now.getTime() - lastSyncedAt.getTime() > staleAfterHours * 3_600_000;
}

// The parts of the rules (rule Q6: a file over 400 lines becomes a folder).
export {
  alertsFor,
  dailySeries,
  deriveMonthEnds,
  estimatedMonths,
  monthEndSeries,
  netWorth,
  totalSeries,
} from "./series";
export type { AccountAlert, BalancePoint, TotalOf } from "./series";
export {
  accountMode,
  hasIbanField,
  ibanConflict,
  normalizeName,
  reconcileProviderAccounts,
} from "./provider";
export type { AccountMode, IbanHolder, LocalAccount, RemoteAccount } from "./provider";
export { MANUAL_MOVEMENT_MODES, movementBalances, movementEffect, withMovementPoints } from "./movements";
export type { BalanceReading, ManualMovement, MovementEffect } from "./movements";
export { changeBetween, shareOf } from "./changes";
export type { Change } from "./changes";
