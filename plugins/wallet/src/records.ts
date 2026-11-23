/**
 * Wallet's records as the contract's movements, and the reads of `/records`: a window (split in
 * halves while a page comes back full), one record by its id, and the records carrying a marker.
 * The words are Wallet's in, the contract's out; what a movement means here is the core's call.
 */
import type { SourceMovement } from "@ledgerly/plugin-contract";
import { type DateWindow, splitWindow, walletRecordDate } from "./days";
import { WalletError } from "./failure";
import {
  assertFieldSeenSomewhere,
  assertLimitHonoured,
  assertWindowApplied,
  assertWithinWindow,
} from "./guards";
import { read, type Wallet } from "./http";
import { splitSendMarker } from "./marker";
import { centsToDecimal, walletAmountToCents } from "./money";
import {
  optionalText,
  type WalletRecordPayload,
  walletRecordListSchema,
  walletRecordsPayloadSchema,
} from "./payloads";

/** Wallet's `systemId` of its built-in Transfer category, the same in every language. */
export const WALLET_TRANSFER_CATEGORY = "system_categories__transfer";

/** Wallet's `recordType`, lower-cased, in the contract's three kinds. */
const TYPE_BY_PROVIDER_TYPE: Record<string, SourceMovement["type"]> = {
  expense: "expense",
  withdrawal: "expense",
  debit: "expense",
  income: "income",
  deposit: "income",
  credit: "income",
  transfer: "transfer",
};

/** Wallet's `recordState`, lower-cased, in the contract's two states. */
const STATE_BY_PROVIDER_STATE: Record<string, SourceMovement["state"]> = {
  cleared: "cleared",
  reconciled: "cleared",
  settled: "cleared",
  posted: "cleared",
  pending: "pending",
  uncleared: "pending",
  planned: "pending",
};

/** A record as an edit needs it: the movement, and what the contract's words leave out. */
export interface RecordView {
  movement: SourceMovement;
  cents: bigint;
  /** The note as Wallet holds it, marker included. */
  note: string | null;
  /** A `transfer` block is present: `$clear: ["transfer"]` is what undoes it. */
  isTransfer: boolean;
}

/** A `recordDate` with a time as well: only then is there an instant to give. */
function recordInstant(recordDate: string): string | null {
  const text = recordDate.trim();
  if (text.length <= 10) return null;
  const when = new Date(text);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/**
 * Label names, trimmed, de-duplicated, in Wallet's order. The element's shape was never seen: a
 * bare string and an object with a `name` are read, anything else is dropped rather than failing
 * the page over a user's hint.
 */
function walletLabelNames(labels: readonly unknown[]): string[] {
  const names = new Set<string>();
  for (const label of labels) {
    const named = typeof label === "object" && label !== null && "name" in label ? label.name : label;
    const name = typeof named === "string" ? optionalText(named) : null;
    if (name !== null) names.add(name);
  }
  return [...names];
}

function categoryOf(raw: WalletRecordPayload): SourceMovement["category"] {
  const externalId = optionalText(raw.category?.id);
  if (raw.category === null || raw.category === undefined || externalId === null) return null;
  return {
    externalId,
    name: optionalText(raw.category.name),
    groupExternalId: optionalText(raw.category.group?.id),
    groupName: optionalText(raw.category.group?.name),
    transfer: optionalText(raw.category.systemId) === WALLET_TRANSFER_CATEGORY,
  };
}

/** The lookup of a provider word: `null` for an absent or unknown one. */
function lookup<T>(table: Record<string, T>, word: string | null | undefined): T | null {
  const key = optionalText(word)?.toLowerCase();
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : null;
}

/** A record as the contract's movement. The counterpart is `mirrorRecord.id` and only that. */
export function recordView(raw: WalletRecordPayload): RecordView {
  const cents = walletAmountToCents(raw.amount.value);
  const note = optionalText(raw.note);
  const marked = splitSendMarker(note);
  const movement: SourceMovement = {
    externalId: raw.id,
    accountExternalId: raw.accountId,
    counterpartExternalId: optionalText(raw.transfer?.mirrorRecord?.id),
    day: walletRecordDate(raw.recordDate),
    instant: recordInstant(raw.recordDate),
    amount: centsToDecimal(cents),
    currency: raw.amount.currencyCode.trim().toUpperCase(),
    payee: optionalText(raw.counterParty),
    note: marked.note,
    sentKey: marked.key,
    category: categoryOf(raw),
    labels: walletLabelNames(raw.labels),
    type: lookup(TYPE_BY_PROVIDER_TYPE, raw.recordType),
    state: lookup(STATE_BY_PROVIDER_STATE, raw.recordState),
  };
  return { movement, cents, note, isTransfer: raw.transfer !== null && raw.transfer !== undefined };
}

function byDayThenId(left: SourceMovement, right: SourceMovement): number {
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  if (left.externalId === right.externalId) return 0;
  return left.externalId < right.externalId ? -1 : 1;
}

/**
 * One window of `/records`, halved instead of failing when the page comes back full. The four
 * checks run on every page, full or not, before the split: a wrong request is reported as one
 * instead of being narrowed down to a single day and blamed on that day. A full page is not kept
 * (it may be any subset of the window); both halves are read again, keyed by id.
 */
async function readWindow(wallet: Wallet, window: DateWindow, found: Map<string, SourceMovement>) {
  const query = new URLSearchParams({ limit: String(wallet.pageLimit) });
  query.append("recordDate", `gte.${window.from}`);
  query.append("recordDate", `lte.${window.to}`);
  const page = await read(wallet, `/records?${query.toString()}`, walletRecordsPayloadSchema);

  assertWindowApplied(window, page.appliedRecordDateFilters);
  assertWithinWindow(window, page.records);
  assertLimitHonoured(page.records.length, wallet.pageLimit);
  assertFieldSeenSomewhere(page.records, "recordType");
  assertFieldSeenSomewhere(page.records, "recordState");

  if (page.records.length < wallet.pageLimit) {
    for (const raw of page.records) found.set(raw.id, recordView(raw).movement);
    return;
  }
  const halves = splitWindow(window);
  if (halves === null) {
    throw new WalletError("page_truncated", `Wallet filled a page for the single day ${window.from}`);
  }
  for (const half of halves) await readWindow(wallet, half, found);
}

/** Every movement of a window, in a fixed order so the core applies them the same way each time. */
export async function readMovements(wallet: Wallet, window: DateWindow): Promise<SourceMovement[]> {
  const found = new Map<string, SourceMovement>();
  await readWindow(wallet, window, found);
  return [...found.values()].sort(byDayThenId);
}

/** One record by its id, `null` when Wallet has none by that id. */
export async function readRecord(wallet: Wallet, id: string): Promise<RecordView | null> {
  const query = new URLSearchParams({ id, limit: "1" });
  const page = await read(wallet, `/records?${query.toString()}`, walletRecordListSchema);
  const raw = page.records.find((one) => one.id === id);
  return raw ? recordView(raw) : null;
}

/** The records of one account on one day whose note contains `marker`: the lookup before a create. */
export async function recordsWithNote(
  wallet: Wallet,
  query: { accountId: string; day: string; marker: string },
): Promise<{ id: string; cents: bigint }[]> {
  const params = new URLSearchParams({ limit: "5" });
  params.append("accountId", `eq.${query.accountId}`);
  params.append("recordDate", `eq.${query.day}`);
  params.append("note", `contains.${query.marker}`);
  const page = await read(wallet, `/records?${params.toString()}`, walletRecordListSchema);
  return page.records.map((raw) => ({ id: raw.id, cents: walletAmountToCents(raw.amount.value) }));
}
