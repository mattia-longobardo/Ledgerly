import { z } from "zod";
import { fromCents, toCents } from "@/lib/calc/money";
import { UpstreamError } from "@/lib/contracts";
import { env } from "@/lib/env";
import { HttpError, requestJson, withRetry, type SleepFn } from "./http";
import {
  REVOLUT_COMPONENT_KEYS,
  WALLET_ACCOUNTS,
  WALLET_EXPECTED_CURRENCY,
  type WalletAccountConfig,
} from "./wallet-accounts";

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  currencyCode: z.string(),
  archived: z.boolean().default(false),
  accountType: z.string().optional(),
  isInvestmentAccount: z.boolean().optional(),
  updatedAt: z.string().optional(),
  balance: z.object({
    currentBalance: z.number(),
  }),
});

const accountsSchema = z.object({
  accounts: z.array(accountSchema),
});

export type WalletAccount = z.infer<typeof accountSchema>;

export type RevolutComponentKey = (typeof REVOLUT_COMPONENT_KEYS)[number];

export interface WalletBalances {
  ing: number;
  revolut: number;
  breakdown: Record<WalletAccountConfig["key"], number>;
}

export interface WalletCallOptions {
  /**
   * The bearer token, always passed in. It used to be read from
   * `WALLET_TOKEN_FILE` on every request; since Phase 2 the credential lives
   * encrypted in `integration_connections` and is resolved by the caller, so
   * this module no longer touches the filesystem or the environment for it.
   */
  token: string;
  /** Injectable so tests don't sit through the backoff. */
  sleep?: SleepFn;
  jitter?: () => number;
  attempts?: number;
  signal?: AbortSignal;
}

const INIT_SYNC_FLOOR_MS = 30_000;
const RATE_LIMIT_DEFAULT_MS = 60_000;

function baseUrl(): string {
  return env().WALLET_API_URL.replace(/\/+$/, "");
}

function headers(opts: WalletCallOptions): Record<string, string> {
  return { authorization: `Bearer ${opts.token}` };
}

function isInitSync(err: HttpError): boolean {
  if (err.status !== 409) return false;
  return JSON.stringify(err.detail ?? "").toLowerCase().includes("init_sync");
}

/**
 * The API has been answering 401 for a token that is not expired — a
 * server-side rejection. Surface it as its own message so a job failure is not
 * mistaken for "rotate the token and move on".
 */
function translate(err: unknown): unknown {
  if (!(err instanceof HttpError)) return err;
  if (err.status === 401 || err.status === 403) {
    return new UpstreamError(
      "wallet",
      `authentication rejected by the Wallet API (HTTP ${err.status}) — the token is not expired, the server is refusing it; check the BudgetBakers portal before rotating`,
      err.detail,
      false,
    );
  }
  return err;
}

function retryPolicy(opts: WalletCallOptions) {
  return {
    attempts: opts.attempts ?? 5,
    sleep: opts.sleep,
    jitter: opts.jitter,
    minDelayFor: (err: unknown): number | null => {
      if (!(err instanceof HttpError)) return null;
      if (isInitSync(err)) return INIT_SYNC_FLOOR_MS;
      if (err.status === 429) return err.retryAfterMs ?? RATE_LIMIT_DEFAULT_MS;
      return null;
    },
  };
}

export async function getAccounts(opts: WalletCallOptions): Promise<WalletAccount[]> {
  try {
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/accounts?limit=200`, accountsSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.accounts;
  } catch (err) {
    throw translate(err);
  }
}

function findAccount(accounts: readonly WalletAccount[], name: string): WalletAccount | undefined {
  const wanted = name.trim().toLowerCase();
  return accounts.find((a) => a.name.trim().toLowerCase() === wanted);
}

/**
 * All-or-nothing by design (§5 phase 1): a partial read must never become a
 * snapshot row, so a single missing account fails the whole call.
 */
export function reduceBalances(accounts: readonly WalletAccount[]): WalletBalances {
  const breakdown = {} as Record<WalletAccountConfig["key"], number>;
  const missing: string[] = [];
  const wrongCurrency: string[] = [];

  for (const cfg of WALLET_ACCOUNTS) {
    const account = findAccount(accounts, cfg.accountName);
    if (!account) {
      if (cfg.required) missing.push(cfg.accountName);
      continue;
    }
    if (account.currencyCode.toUpperCase() !== WALLET_EXPECTED_CURRENCY) {
      wrongCurrency.push(`${account.name}=${account.currencyCode}`);
      continue;
    }
    breakdown[cfg.key] = account.balance.currentBalance;
  }

  if (missing.length > 0) {
    throw new UpstreamError(
      "wallet",
      `required account(s) not found: ${missing.join(", ")} — refusing to report a partial balance`,
      { known: accounts.map((a) => a.name) },
      false,
    );
  }
  if (wrongCurrency.length > 0) {
    throw new UpstreamError(
      "wallet",
      `account(s) not in ${WALLET_EXPECTED_CURRENCY}: ${wrongCurrency.join(", ")}`,
      { known: accounts.map((a) => a.name) },
      false,
    );
  }

  const ing = breakdown.ing;
  const revolut = REVOLUT_COMPONENT_KEYS.reduce((sum, key) => sum + breakdown[key], 0);
  return { ing, revolut, breakdown };
}

export async function getBalances(opts: WalletCallOptions): Promise<WalletBalances> {
  return reduceBalances(await getAccounts(opts));
}

const CATEGORIES_LIMIT = 200;
const RECORDS_LIMIT = 500;

/**
 * A page that comes back exactly at the requested limit may mean there are
 * more items beyond it. No pagination cursor for these endpoints has been
 * confirmed against a live token, so silently returning a full first page as
 * "the dataset" would silently understate money. Refuse instead of guessing.
 */
function assertPageNotTruncated(endpoint: string, count: number, limit: number): void {
  if (count < limit) return;
  throw new UpstreamError(
    "wallet",
    `Wallet /${endpoint} returned exactly the requested limit (${limit}) — the result may be truncated and pagination is not implemented; refusing to treat a possibly-partial page as complete`,
    { count, limit },
    false,
  );
}

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string().nullable().optional(),
  isIncome: z.boolean().optional(),
});
const categoriesSchema = z.object({ categories: z.array(categorySchema) });
export type WalletCategory = z.infer<typeof categorySchema>;

export async function getCategories(opts: WalletCallOptions): Promise<WalletCategory[]> {
  try {
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/categories?limit=${CATEGORIES_LIMIT}`, categoriesSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    assertPageNotTruncated("categories", body.categories.length, CATEGORIES_LIMIT);
    return body.categories;
  } catch (err) {
    throw translate(err);
  }
}

const recordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: z.number(),
  currencyCode: z.string(),
  categoryId: z.string().nullable().optional(),
  labels: z.array(z.string()).default([]),
  recordType: z.string().optional(),
  recordState: z.string().optional(),
  note: z.string().nullable().optional(),
  recordDate: z.string(),
  updatedAt: z.string().optional(),
  partyName: z.string().nullable().optional(),
  transferCounterRecordId: z.string().nullable().optional(),
});
const recordsSchema = z.object({ records: z.array(recordSchema) });
export type WalletRecord = z.infer<typeof recordSchema>;

/**
 * `recordType`/`recordState` are optional because their field names were
 * never verified against a live token. A single record genuinely omitting
 * one is plausible; every record in a whole non-empty page omitting it is
 * far more likely to mean the field-name guess is wrong than that the field
 * is truly absent everywhere — mirrors the all-or-nothing invariant
 * `reduceBalances` already enforces for missing accounts (§ above).
 */
function assertFieldSeenSomewhere(
  records: readonly WalletRecord[],
  field: "recordType" | "recordState",
): void {
  if (records.length === 0) return;
  if (records.some((r) => r[field] !== undefined)) return;
  throw new UpstreamError(
    "wallet",
    `every record in a page of ${records.length} is missing "${field}" — likely a wrong field-name guess, not a genuine absence across the whole page`,
    { sampleIds: records.slice(0, 5).map((r) => r.id) },
    false,
  );
}

export interface GetRecordsOptions extends WalletCallOptions {
  /** ISO date; the API defaults to a three-month window when this is omitted. */
  sinceDate?: string;
}

export async function getRecords(opts: GetRecordsOptions): Promise<WalletRecord[]> {
  try {
    const filter = opts.sinceDate ? `&recordDate=gte.${opts.sinceDate}` : "";
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/records?limit=${RECORDS_LIMIT}${filter}`, recordsSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    assertFieldSeenSomewhere(body.records, "recordType");
    assertFieldSeenSomewhere(body.records, "recordState");
    assertPageNotTruncated("records", body.records.length, RECORDS_LIMIT);
    return body.records;
  } catch (err) {
    throw translate(err);
  }
}

export interface PostRecordInput {
  accountId: string;
  /**
   * A plain decimal string ("0.46", "-12.34"), same shape as every read-side
   * money field in this module (`WalletRecord.amount` is the one exception,
   * mirroring whatever Wallet itself sends back). B8's carried review
   * finding: this used to be typed `number`, which forced the one call site
   * that writes real money (`wallet-interest-posting-adapter.ts`) to convert
   * via a raw `Number()` — against the "regex, never `Number()`" rule every
   * other money field in this codebase follows. The conversion now happens
   * exactly once, at the wire boundary in `postRecords` below, via
   * `toCents`/`fromCents` rather than a bare `Number()`.
   */
  amount: string;
  recordDate: string;
  note: string;
  categoryId?: string;
}

/**
 * Converts a decimal amount string to the JSON number Wallet's API expects,
 * at the one point this module ever serialises money onto the wire.
 * `toCents`/`fromCents` round-trips through integer cents so the number that
 * actually reaches `JSON.stringify` always carries exactly two decimal
 * digits — never whatever digits a stray float remainder would otherwise
 * print verbatim.
 */
function formatAmountForWire(amount: string): number {
  const cents = toCents(amount);
  if (cents === null) {
    throw new Error(`postRecords: amount is not a valid decimal string: ${JSON.stringify(amount)}`);
  }
  return Number(fromCents(cents).toFixed(2));
}

/**
 * The POST response shape has never been verified against a live token
 * (same limitation as every other Wallet endpoint — see `getAccounts`'
 * comment on `WalletCallOptions`). It plausibly comes back either wrapped
 * (`{ records: [...] }`, matching every read endpoint's own shape) or as a
 * bare array (a common REST convention for "here is what you just created").
 *
 * Ruling (B8, carried review finding): a shape that matches neither used to
 * degrade to an empty list via `.catch([])`, on the theory that a wrong
 * guess here must not turn a successful money-moving POST into a reported
 * failure. In practice that let a real POST succeed while silently losing
 * the Wallet record's id — `interest_entries.transactionId` ends up `null`
 * forever, with no record anywhere of what actually happened. Failing loudly
 * instead is the safer default: `postRecords` throwing here is caught by
 * `postWalletInterestEntry` and reported as a `WalletPostAmbiguousError`
 * (money may or may not be at Wallet), which leaves the accrual's posting
 * claim in the observable in-flight state for an operator to reconcile —
 * exactly the outcome a shape mismatch on a real post deserves, rather than
 * a quiet, permanent loss of the linkage.
 */
const postRecordsResponseSchema = z.union([recordsSchema.transform((v) => v.records), z.array(recordSchema)]);

/**
 * Used only by the optional interest-posting adapter (Task 19), behind a
 * per-rule switch. `attempts` is left to the caller rather than defaulted
 * here: a write must not retry on the same terms as a read (see the call
 * site in `wallet-interest-posting-adapter.ts`, which passes `attempts: 1`
 * — a 409/5xx after Wallet has already persisted the record must not
 * resubmit the identical body).
 */
export async function postRecords(opts: WalletCallOptions, records: PostRecordInput[]): Promise<WalletRecord[]> {
  try {
    const body = JSON.stringify(records.map((r) => ({ ...r, amount: formatAmountForWire(r.amount) })));
    return await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/records`, postRecordsResponseSchema, {
          method: "POST",
          headers: { ...headers(opts), "content-type": "application/json" },
          body,
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
  } catch (err) {
    throw translate(err);
  }
}

export interface FindPostedRecordOptions extends WalletCallOptions {
  accountId: string;
  /** `YYYY-MM-DD`, matched by exact equality — same grain `interest.py` uses. */
  recordDate: string;
  /** Matched by substring, same as `interest.py`'s `note=contains.<marker>`. */
  noteContains: string;
}

/**
 * Provider-side duplicate check, mirroring `interest.py`'s
 * `already_posted_today` (`Wallet Manager/app/interest.py:167-173`) exactly —
 * same three filters (`accountId`, `recordDate=eq.<day>`, `note=contains.<marker>`),
 * same `limit=5` — because that shape is the one piece of this API already
 * proven against a live token, in the script this module retires. Used as
 * the second line of defence against a crash between a successful POST and
 * the local `markPosted` write: local state says "not yet posted", but this
 * asks Wallet itself before ever posting again.
 */
export async function findPostedRecord(opts: FindPostedRecordOptions): Promise<WalletRecord | null> {
  try {
    const params = new URLSearchParams({
      accountId: opts.accountId,
      recordDate: `eq.${opts.recordDate}`,
      note: `contains.${opts.noteContains}`,
      limit: "5",
    });
    const body = await withRetry(
      () =>
        requestJson("wallet", `${baseUrl()}/records?${params.toString()}`, recordsSchema, {
          headers: headers(opts),
          signal: opts.signal,
        }),
      retryPolicy(opts),
    );
    return body.records[0] ?? null;
  } catch (err) {
    throw translate(err);
  }
}
