/**
 * The rules of the plugin runtime that need no database and no network (rewrite plan, 04-now.md
 * §4.1 and §4.2; ux/n1-plugin-bank.md §2.2, §5.1, §7).
 */
import { createHash } from "node:crypto";
import type { PluginAccount, PluginTransaction, SyncResponse } from "@ledgerly/plugin-contract";

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

/** Why a reading of a bank did nothing, as the runtime says it: the closed list of a plugin's codes. */
export const READING_ERRORS = [
  "auth",
  "consent_expired",
  "rate_limited",
  "provider_down",
  "invalid_data",
  "plugin_down",
  "failed",
] as const;
export type ReadingError = (typeof READING_ERRORS)[number];

/** How long the automatic readings wait after a bank said it accepts no more (04-now.md §4.2). */
export const RATE_LIMIT_WAIT_HOURS = 6;

/** The days a reading goes back before the last day it covered: a bank books late. */
export const REREAD_DAYS = 10;

/** Three automatic readings a day, in the person's zone (04-now.md §4.2). */
export const BANK_SCHEDULE = {
  rules: [{ kind: "times" as const, times: ["07:10", "13:10", "19:10"], days: { kind: "every" as const } }],
};

/** The id of a bank's account that this app keeps: the one that survives a new access, when there is one. */
export function providerAccountIdOf(account: Pick<PluginAccount, "externalId" | "stableId">): string {
  return account.stableId ?? account.externalId;
}

/** The kinds of account here a bank's account can become by default. */
export type BankAccountType = "checking" | "savings" | "credit" | "cash";

/** The bank's word for a kind of account (ISO 20022 cash account type), as the kind it becomes here. */
export function bankAccountType(kind: string | null): BankAccountType {
  if (kind === "SVGS") return "savings";
  if (kind === "CARD") return "credit";
  if (kind === "CASH") return "cash";
  return "checking";
}

const BANK_ACCOUNT_NAME_MAX = 80;

/**
 * The name of each account of one access, the same on every screen that offers it: the bank's
 * name of the product, or «{bank} {kind}» when the bank gives none, or gives one that several
 * accounts share (the holder's name, which tells no account from another). Two accounts of the
 * same kind get a number, in the bank's order, so no two names start equal.
 */
export function bankAccountNames(
  accounts: readonly { providerAccountId: string; name: string | null; kind: string | null }[],
  bank: string,
  kindLabel: (type: BankAccountType) => string,
): Map<string, string> {
  const uses = new Map<string, number>();
  for (const account of accounts) {
    const name = account.name?.trim() ?? "";
    if (name !== "") uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  const counted = new Map<BankAccountType, number>();
  const names = new Map<string, string>();
  for (const account of accounts) {
    const own = account.name?.trim() ?? "";
    if (own !== "" && uses.get(own) === 1) {
      names.set(account.providerAccountId, own.slice(0, BANK_ACCOUNT_NAME_MAX));
      continue;
    }
    const type = bankAccountType(account.kind);
    const count = (counted.get(type) ?? 0) + 1;
    counted.set(type, count);
    const name = `${bank} ${kindLabel(type)}${count > 1 ? ` ${count}` : ""}`;
    names.set(account.providerAccountId, name.slice(0, BANK_ACCOUNT_NAME_MAX));
  }
  return names;
}

function digest(text: string, length: number): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

/** A movement's text for comparing: one case, one kind of space. */
function normalized(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

/**
 * The identity of every booked movement of one account (04-now.md §4.2): the bank's own
 * reference when it gives one; otherwise a hash of the account, the booking day, the amount, the
 * direction, the text, the other party and the place among the equal movements of that day —
 * two coffees at the same bar on the same day are two movements.
 *
 * The id starts with a digest of the account, so the same reference at two accounts stays two
 * ids. Pending movements are left out: only a booked movement is a fact.
 */
export function movementIds(
  accountKey: string,
  transactions: readonly PluginTransaction[],
): { transaction: PluginTransaction; externalId: string }[] {
  const account = digest(accountKey, 16);
  const seen = new Map<string, number>();
  const identified: { transaction: PluginTransaction; externalId: string }[] = [];
  for (const transaction of transactions) {
    if (transaction.status !== "booked") continue;
    if (transaction.externalId !== null) {
      const reference = transaction.externalId;
      const own = reference.length <= 120 ? reference : `h:${digest(reference, 40)}`;
      identified.push({ transaction, externalId: `${account}:${own}` });
      continue;
    }
    const facts = [
      transaction.bookingDate ?? transaction.valueDate ?? "",
      transaction.amount,
      transaction.direction,
      transaction.currency,
      normalized(transaction.text.join(" ")),
      normalized(transaction.counterparty ?? ""),
    ].join("\u0000");
    const ordinal = seen.get(facts) ?? 0;
    seen.set(facts, ordinal + 1);
    identified.push({ transaction, externalId: `${account}:x:${digest(`${facts}\u0000${ordinal}`, 40)}` });
  }
  // A reference the bank repeats inside one account names one movement: the last one read wins,
  // as it does at the next reading.
  const unique = new Map(identified.map((one) => [one.externalId, one]));
  return [...unique.values()];
}

/** The balances a bank can give, from the one that says most about the account to the least. */
const BALANCE_ORDER = [
  "CLBD",
  "ITBD",
  "XPCD",
  "ITAV",
  "CLAV",
  "OPBD",
  "OPAV",
  "PRCD",
  "FWAV",
  "VALU",
  "INFO",
  "OTHR",
];

/** The one balance of an answer to keep: the booked one when there is one, by the order above. */
export function pickBalance<T extends { type: string }>(balances: readonly T[]): T | null {
  const rank = (type: string) => {
    const at = BALANCE_ORDER.indexOf(type);
    return at < 0 ? BALANCE_ORDER.length : at;
  };
  return [...balances].sort((a, b) => rank(a.type) - rank(b.type))[0] ?? null;
}

/** Why the return from the provider's site did not end with a connection (§6.3). */
export const RETURN_ERRORS = [
  "denied",
  "expired",
  "session",
  "no_accounts",
  "unreachable",
  "unreadable",
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
