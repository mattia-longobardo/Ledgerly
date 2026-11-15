/**
 * The rules of the plugin runtime that need no database and no network (rewrite plan, 04-now.md
 * §4.1 and §4.2; ux/n1-plugin-bank.md §2.2, §5.1, §7).
 */
import { createHash } from "node:crypto";
import type { PluginAccount, SyncResponse } from "./contract/calls";

/** How long a person has to come back from the provider's site. */
export const AUTH_STATE_MINUTES = 15;

/**
 * What a plugin is for one person (§2.2): never turned on (or turned off with nothing saved),
 * on, or turned off after use — credentials or connections are still saved.
 */
export type UserPluginState = "available" | "active" | "paused";

export function userPluginState(facts: {
  active: boolean;
  hasCredentials: boolean;
  connections: number;
}): UserPluginState {
  if (facts.active) return "active";
  return facts.hasCredentials || facts.connections > 0 ? "paused" : "available";
}

/** What is kept of a `state`: its hash, so the stored row cannot finish anybody's access. */
export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** The key of a connection among a plugin's connections: the institution, with its country. */
export function instanceKeyOf(institution: { name: string; country: string }): string {
  return `${institution.country}:${institution.name}`;
}

export function institutionOf(instanceKey: string): { name: string; country: string } {
  const separator = instanceKey.indexOf(":");
  return { country: instanceKey.slice(0, separator), name: instanceKey.slice(separator + 1) };
}

/** An account number as a screen shows it: the country, two digits and the last four (§6.4). */
export function maskIdentifier(identifier: string | null): string | null {
  if (identifier === null) return null;
  const compact = identifier.replace(/\s+/g, "");
  if (compact.length < 8) return "••••";
  return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
}

/** A connection of a bank as its row says it (§5.1). `pending` joins with the choice of the accounts. */
export type BankState = "active" | "error" | "expired";

export function bankState(
  connection: { state: "active" | "error" | "revoked"; expiresAt: Date | null },
  now: Date,
): BankState {
  if (connection.state === "revoked") return "expired";
  if (connection.expiresAt !== null && connection.expiresAt.getTime() <= now.getTime()) return "expired";
  return connection.state === "error" ? "error" : "active";
}

/** Why the return from the provider's site did not end with a connection (§6.3). */
export const RETURN_ERRORS = [
  "denied",
  "expired",
  "session",
  "no_accounts",
  "unreachable",
  "bank_unavailable",
] as const;
export type ReturnError = (typeof RETURN_ERRORS)[number];

export function isReturnError(value: string | null | undefined): value is ReturnError {
  return (RETURN_ERRORS as readonly string[]).includes(value ?? "");
}

/** A private key as it is sealed: one kind of line end, one final new line. */
export function normalizePrivateKey(text: string): string {
  return `${text.replace(/\r\n?/g, "\n").trim()}\n`;
}

/** Whether a text has the frame of a PEM private key. The plugin checks the key itself. */
export function looksLikePrivateKey(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(text);
}

function dayNumber(day: string): number {
  return Number(day.replaceAll("-", ""));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The first reading of a bank as numbers only (step 1 of N1: the trial on a real bank, 04-now.md
 * §4.2). It says what the bank exposes — accounts, kinds of balance, ids of the movements, codes,
 * pending movements, the shape of the text, how far back the history goes — and carries no name,
 * no number of an account, no amount and no text.
 */
export function measureReading(
  accounts: readonly PluginAccount[],
  batches: readonly SyncResponse[],
  today: string,
): Record<string, number> {
  const measures: Record<string, number> = {};
  const add = (key: string, by = 1) => {
    measures[key] = (measures[key] ?? 0) + by;
  };
  const code = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "none";

  measures.accounts = accounts.length;
  for (const account of accounts) {
    add(`accountKind${code(account.kind ?? "none")}`);
    if (account.identifier !== null) add("accountsWithIdentifier");
    if (account.stableId !== null) add("accountsWithStableId");
    if (account.name !== null) add("accountsWithName");
  }

  measures.calls = batches.length;
  const transactions = batches.flatMap((batch) => batch.transactions);
  for (const batch of batches) {
    for (const account of batch.accounts) {
      if (account.error !== null) add("accountErrors");
      for (const balance of account.balances) add(`balance${code(balance.type)}`);
    }
  }

  measures.transactions = transactions.length;
  const ids = new Set<string>();
  const days: string[] = [];
  let textLength = 0;
  let textMax = 0;
  for (const one of transactions) {
    add(one.status === "booked" ? "booked" : "pending");
    if (one.externalId !== null) {
      add("withExternalId");
      ids.add(`${one.accountExternalId}\u0000${one.externalId}`);
    }
    if (one.bookingDate !== null) days.push(one.bookingDate);
    else add("withoutBookingDate");
    if (one.valueDate !== null) add("withValueDate");
    if (one.counterparty !== null) add("withCounterparty");
    if (one.merchantCategoryCode !== null) add("withMerchantCode");
    if (one.bankTransactionCode !== null) add("withBankCode");
    add(one.text.length === 0 ? "textLines0" : one.text.length === 1 ? "textLines1" : "textLinesMore");
    const length = one.text.join(" ").length;
    textLength += length;
    textMax = Math.max(textMax, length);
  }
  measures.distinctExternalIds = ids.size;
  measures.textAverageLength = transactions.length === 0 ? 0 : Math.round(textLength / transactions.length);
  measures.textMaxLength = textMax;
  days.sort();
  if (days.length > 0) {
    measures.oldestBooking = dayNumber(days[0]);
    measures.newestBooking = dayNumber(days.at(-1) as string);
    measures.historyDays = daysBetween(days[0], today);
  }
  return measures;
}
