/**
 * Budget Makers Wallet's unofficial REST API (spec §9.1).
 *
 * HTTP only: no database handle, no transaction, no module import. The credential is passed in —
 * the token lives sealed in `integration_connections` and is opened by the caller — so one process
 * can read on behalf of several users without this file ever knowing where tokens are kept.
 *
 * Reads get 5 attempts with exponential backoff that honours `Retry-After`; a write gets one
 * ({@link WRITE_ATTEMPTS}); 401 and 403 fail at once as {@link WalletError} `token_rejected`, and
 * so does a token that cannot be sent in a header at all ({@link isUsableToken}). Every other
 * answer outside 2xx is an `http` failure carrying whatever the body put in its `error` field,
 * decided before the body is ever shown to a schema.
 */

import { type ZodType } from "zod";
import { addDays, type CivilDate } from "@/platform/dates";
import {
  type DateWindow,
  mapWalletAccount,
  mapWalletBalance,
  mapWalletCategory,
  mapWalletRecord,
  splitWindow,
  type WalletAccount,
  type WalletAccountPayload,
  walletAccountsPayloadSchema,
  type WalletBalance,
  walletCategoriesPayloadSchema,
  type WalletCategory,
  walletRecordDate,
  type WalletRecordPayload,
  walletRecordsPayloadSchema,
  type WalletTransaction,
} from "./mapping";

export type {
  DateWindow,
  WalletAccount,
  WalletAccountPayload,
  WalletBalance,
  WalletCategory,
  WalletCategoryPayload,
  WalletRecordPayload,
  WalletRecordsPage,
  WalletTransaction,
} from "./mapping";

/** The base URL of spec §9.1. `WalletClientOptions.baseUrl` overrides it; nothing else may. */
export const WALLET_API_URL = "https://rest.budgetbakers.com/wallet/v1/api";

/** A read is worth retrying five times (spec §9.1). */
export const READ_ATTEMPTS = 5;
/**
 * A write gets exactly one attempt (spec §9.1): a 5xx after Wallet has already persisted a record
 * would otherwise post the same money twice. F2 makes no write — the interest posting of §7.6 is
 * F4's — but the constant is exported so the write path cannot silently inherit a read's policy.
 */
export const WRITE_ATTEMPTS = 1;

/**
 * 200 is the API's own ceiling on all three lists, and the one number it refuses loudly: a
 * `/records?limit=500` answers `HTTP 400 {"error":"limit must be at most 200"}` — every call, so a
 * sync that asks for more never reads a single movement. Measured on 2026-09-16. `/categories`
 * returns 91 rows, comfortably under it.
 */
const ACCOUNTS_LIMIT = 200;
const CATEGORIES_LIMIT = 200;
const RECORDS_LIMIT = 200;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 32_000;
const JITTER_FRACTION = 0.25;
const INIT_SYNC_DELAY_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DETAIL_CHARS = 4_000;

/**
 * Why a Wallet call failed. `token_rejected` is the one every caller has to tell apart: Settings ›
 * Integrations reports "token rejected" and the sync marks the connection, instead of retrying a
 * credential that will keep being refused.
 */
export type WalletErrorKind =
  "token_rejected" | "http" | "network" | "timeout" | "payload" | "page_truncated";

/** Every failure this client raises. The token is never part of a message or a detail. */
export class WalletError extends Error {
  constructor(
    readonly kind: WalletErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly detail: unknown = null,
    readonly retryable: boolean = false,
    /** What the provider itself asked for: `Retry-After`, or the init-sync floor. */
    readonly minDelayMs: number | null = null,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

/** The check T7 (connection test) and T8 (sync) make before treating a failure as transient. */
export function isTokenRejected(error: unknown): boolean {
  return error instanceof WalletError && error.kind === "token_rejected";
}

/** Tab, the visible ASCII range and `obs-text`: everything an HTTP header value may carry. */
function isHeaderValueCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

/**
 * Whether a token can be sent at all: not empty once trimmed, and made only of characters an HTTP
 * header value may carry.
 *
 * A token pasted out of a wrapped page keeps the line break in the *middle*, where `trim()` cannot
 * reach it, and building `Authorization` out of it throws an error that quotes the whole value —
 * which would then be stored in `sync_runs.error` and `integration_connections.last_error`, shown
 * verbatim in Settings › Integrations, and printed to the log. This predicate is the check the
 * interface makes where the token is pasted, before it is ever sealed into the connection; the
 * client makes it again before its first request.
 *
 * Deliberately stricter than `new Headers`, which accepts a C0 control or a DEL that `fetch` then
 * refuses further down ("invalid authorization header", after five pointless attempts): every
 * character outside the set above is a paste accident, never a credential.
 */
export function isUsableToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed === "") return false;
  for (const character of trimmed) {
    if (!isHeaderValueCode(character.codePointAt(0) ?? 0)) return false;
  }
  return true;
}

export interface WalletClientOptions {
  baseUrl?: string;
  /** Injected in tests so no call ever leaves the process. */
  fetch?: typeof globalThis.fetch;
  /** Injected in tests so the backoff is not actually waited through. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests for a deterministic backoff; returns [0,1). */
  jitter?: () => number;
  /** Injected in tests so an HTTP-date `Retry-After` is measured against a fixed present. */
  now?: () => number;
  timeoutMs?: number;
  /** The page size asked of `/records`. Lowered in tests so a fixture of two rows fills a page. */
  pageLimit?: number;
}

export interface WalletClient {
  accounts(): Promise<WalletAccount[]>;
  balances(): Promise<WalletBalance[]>;
  transactions(window: { from: CivilDate; to: CivilDate }): Promise<WalletTransaction[]>;
  /**
   * Beyond the three signatures F2 agreed on, and additive to them: §9.1 links a provider category,
   * adopts one by its exact *name*, or creates it, and that needs Wallet's whole list — the
   * categories no movement of the window happens to use included. A movement does carry its own
   * category's name as well, so this is no longer the only place a name can come from.
   */
  categories(): Promise<WalletCategory[]>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** `Retry-After` is either delta-seconds or an HTTP date; anything else is no instruction at all. */
export function parseRetryAfterMs(raw: string | null, now: number = Date.now()): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** 2 s doubling to a 32 s ceiling, plus up to 25 % of jitter so retries do not march in step. */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return exponential + Math.floor(jitter * exponential * JITTER_FRACTION);
}

type NumberSourceReviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * Parses a response body keeping every JSON number as the text Wallet sent.
 *
 * This is the one guard that keeps a provider's money out of a float (§4.3): `JSON.parse`'s
 * reviver receives the number's own source text (Node 22+), and handing that text on instead of
 * the parsed double means `parseCents` sees Wallet's digits, not a double's rounding. On a runtime
 * without source-text access the reviver simply lets the number through, and
 * `walletAmountToCents` converts it through its fixed decimal representation — the documented
 * lossy path, and the only one.
 *
 * It applies to *every* number in the body, so a numeric non-money field would arrive as a string
 * too; the schemas in `mapping.ts` declare no such field, and one added later has to coerce.
 */
export function parseJsonPreservingNumbers(text: string): unknown {
  const reviver: NumberSourceReviver = (_key, value, context) =>
    typeof value === "number" && typeof context?.source === "string" ? context.source : value;
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
}

/** 429 and 5xx are worth another go; a 409 only while Wallet says it is still initialising. */
function isRetryableStatus(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 409 && body.toLowerCase().includes("init_sync");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the body says went wrong, when it says anything: the `error` field of a JSON error body.
 *
 * `{"error":"limit must be at most 200"}` is the best account of a failure this API gives, and a
 * `WalletError`'s *message* is the only part of it that reaches `sync_runs.error` and the
 * Settings › Integrations card — `detail` stops at the database. Leaving the field out of the
 * message is what turned a limit violation into "Wallet could not be reached" and cost a whole
 * round of diagnosis.
 *
 * Parsed with the ordinary `JSON.parse`, deliberately: nothing in an error body is money, so the
 * source-text reviver has no business here.
 */
function errorFieldOf(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const field = (parsed as { error?: unknown }).error;
  return typeof field === "string" && field.trim() !== "" ? field.trim() : null;
}

/** An error body, bounded: a provider that answers with an HTML page must not fill a log with it. */
function detailOf(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;
  return trimmed.length <= MAX_DETAIL_CHARS ? trimmed : `${trimmed.slice(0, MAX_DETAIL_CHARS)}…`;
}

/**
 * A page of a list with no date filter to narrow: `/accounts` and `/categories` are asked for in
 * one request, so a page that comes back exactly at the limit may be cut short and there is no
 * window to split. It fails loudly instead. A silently dropped account would become "unavailable"
 * and quietly understate net worth; a silently dropped category would be created again under the
 * same name. Both are worse than a failed pass.
 */
function assertWholePage(endpoint: string, count: number, limit: number): void {
  if (count < limit) return;
  throw new WalletError(
    "page_truncated",
    `Wallet filled the whole requested page of ${limit} on /${endpoint}: the list may be cut short`,
    null,
    { endpoint, count, limit },
  );
}

/** One bound of `appliedRecordDateFilters`: an operator and the instant it is measured against. */
const APPLIED_FILTER = /^(gte|gt|lte|lt)\.(.+)$/;

/**
 * The window Wallet *says* it applied covers the window that was asked for, or the page is refused.
 *
 * `/records` answers with `appliedRecordDateFilters`, the date filters the API actually applied —
 * `["gte.2026-09-01T00:00:00.000Z","lt.2026-09-17T00:00:00.000Z"]` (measured 2026-09-16). That
 * replaces this client's last inference about the request with a fact. It matters because every
 * way the request can go wrong is silent: a filter name Wallet does not know, a bound it drops, or
 * no date filter at all — in which case it applies a window of its own, the last three months or
 * so — all produce an answer that looks like a complete account of the window while hiding
 * movements, and a movement hidden inside a re-read window is what §7.2 reads as its removal.
 *
 * Only a *narrower* applied window is judged here. A wider one is harmless to the question this
 * asks (every movement of the requested window is still in the answer) and is refused anyway by
 * {@link assertWithinWindow} the moment it carries a movement from outside.
 *
 * Both bounds have to be declared: an undeclared side is not an open-ended read, it is the API's
 * own default window applied invisibly. `lte.<day>` comes back as `lt.<day+1>T00:00Z`, so the last
 * day of a closed window is included in full, and the exclusive upper bound compared against here
 * is midnight after `window.to`.
 *
 * The message carries the window and the filters — never a movement, and never the token.
 */
function assertWindowApplied(window: DateWindow, filters: readonly string[]): void {
  const from = Date.parse(`${window.from}T00:00:00.000Z`);
  const until = Date.parse(`${addDays(window.to, 1)}T00:00:00.000Z`);
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (const filter of filters) {
    const bound = APPLIED_FILTER.exec(filter.trim());
    const at = bound === null ? Number.NaN : Date.parse(bound[2]);
    if (bound === null || Number.isNaN(at)) {
      throw new WalletError(
        "payload",
        `Wallet answered /records for ${window.from}..${window.to} declaring a date filter this client cannot read ("${filter}"): the window it covers cannot be established`,
        null,
        { from: window.from, to: window.to, appliedRecordDateFilters: [...filters] },
      );
    }
    if (bound[1] === "gte") lower = Math.max(lower, at);
    if (bound[1] === "gt") lower = Math.max(lower, at + 1);
    if (bound[1] === "lte") upper = Math.min(upper, at + 1);
    if (bound[1] === "lt") upper = Math.min(upper, at);
  }
  // Both bounds have to be there: an undeclared side is the API's own bound applied invisibly,
  // never an open-ended read, so `-Infinity`/`+Infinity` must not be allowed to satisfy the test.
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower <= from && upper >= until) return;
  const declared = filters.length === 0 ? "no date filter" : filters.join(", ");
  throw new WalletError(
    "payload",
    `Wallet answered /records for ${window.from}..${window.to} having applied ${declared}: the answer does not cover the window that was asked for`,
    null,
    { from: window.from, to: window.to, appliedRecordDateFilters: [...filters] },
  );
}

/**
 * Every movement of a page falls inside the window that was asked for, or the page is refused.
 *
 * `/records` is the one endpoint that can *hide* data — a window that comes back without a
 * movement is what declares that movement gone (§7.2). {@link assertWindowApplied} checks the
 * window Wallet says it applied; this checks the movements it actually sent, which is the other
 * half of the same question: a filter can be declared and still not be honoured, and a page wider
 * than the window looks complete to a user under the page limit, so the mistake would show up as
 * wrong data rather than as a failure. One date outside the window is worth a failed pass: the
 * same trade {@link assertWholePage} already makes for `/accounts` and `/categories`.
 *
 * The message carries the window and the offending day — never the movement, and never the token.
 */
function assertWithinWindow(window: DateWindow, page: readonly WalletRecordPayload[]): void {
  for (const raw of page) {
    const day = walletRecordDate(raw.recordDate);
    if (day >= window.from && day <= window.to) continue;
    throw new WalletError(
      "payload",
      `Wallet answered /records for ${window.from}..${window.to} with a movement dated ${day}: the requested window was not applied`,
      null,
      { from: window.from, to: window.to, occurredOn: day },
    );
  }
}

/**
 * A page may come back exactly at the limit — that is what splitting the window is for — but never
 * over it. A provider that returns more rows than `limit` asked for is not paging at all, and
 * feeding that page to the splitter would narrow the window down to a single day and then blame
 * the day. The true cause is named instead.
 */
function assertLimitHonoured(count: number, limit: number): void {
  if (count <= limit) return;
  throw new WalletError(
    "payload",
    `Wallet answered /records with ${count} records for a requested limit of ${limit}: the provider is not honouring \`limit\`, so a window cannot be paged`,
    null,
    { count, limit },
  );
}

/**
 * A field whose name nobody has verified against a live token, absent from *every* record of a
 * non-empty page.
 *
 * One record genuinely without a `recordType` is plausible; a whole page without it is far more
 * likely to mean the field name is wrong than that Wallet stamps none of them — and the silent
 * outcome is worse than a failure, because `sync.ts` then names every movement's type from the
 * sign of its amount and its state from a default, for good. Restored from the previous version's
 * client (`assertFieldSeenSomewhere`), which `dev-0.1` dropped.
 *
 * A field explicitly `null` counts as seen: the provider knows the name and has no value for it.
 * `transferCounterRecordId` is deliberately *not* guarded here — a page holding no transfer at all
 * is an ordinary page, so its absence proves nothing.
 */
function assertFieldSeenSomewhere(
  page: readonly WalletRecordPayload[],
  field: "recordType" | "recordState",
): void {
  if (page.length === 0) return;
  if (page.some((raw) => raw[field] !== undefined)) return;
  throw new WalletError(
    "payload",
    `Every one of the ${page.length} records Wallet returned is missing "${field}": a wrong field name is likelier than an absence across a whole page`,
    null,
    { field, count: page.length },
  );
}

/**
 * The one message a token this client cannot send is ever reported with. It says what to do about
 * it and nothing about its value, and every path that could otherwise name the token ends here.
 */
const UNUSABLE_TOKEN_MESSAGE =
  "The Wallet token cannot be sent in an HTTP header — a line break or a control character inside it — so no request was made: paste the token again from Wallet";

function byDateThenId(left: WalletTransaction, right: WalletTransaction): number {
  if (left.occurredOn !== right.occurredOn) return left.occurredOn < right.occurredOn ? -1 : 1;
  if (left.externalId === right.externalId) return 0;
  return left.externalId < right.externalId ? -1 : 1;
}

export function createWalletClient(token: string, options: WalletClientOptions = {}): WalletClient {
  // An empty token is a bug in the caller, not a rejected credential: the vault handed over
  // nothing. Raised before any request so it can never be reported as the provider's fault.
  if (token.trim() === "") throw new Error("createWalletClient: the Wallet token is empty");

  const baseUrl = (options.baseUrl ?? WALLET_API_URL).replace(/\/+$/, "");
  const call = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const recordsLimit = options.pageLimit ?? RECORDS_LIMIT;
  // Edge whitespace is a paste artefact, dropped once and here, so that what `isUsableToken`
  // judges is exactly what goes on the wire.
  const secret = token.trim();
  const secrets = [...new Set([token, secret])];

  /**
   * The request headers, built and validated *outside* every `try`.
   *
   * Moving the construction out of the block that wraps `fetch` is not enough on its own:
   * `Headers.append` runs inside `fetch` when `init.headers` is a plain object, and its error
   * quotes the whole value. Handing `fetch` an already-valid `Headers` instance leaves it nothing
   * to validate, so the only place the value can be refused is this function — where the original
   * error is caught unbound and replaced by {@link UNUSABLE_TOKEN_MESSAGE}. Refusing here rather
   * than in the constructor also means the failure passes through the caller's own error handling,
   * so a stored token gone bad is recorded in `sync_runs` and marks the connection.
   */
  function requestHeaders(): Headers {
    if (!isUsableToken(secret)) {
      throw new WalletError("token_rejected", UNUSABLE_TOKEN_MESSAGE, null, null, false);
    }
    try {
      return new Headers({ accept: "application/json", authorization: `Bearer ${secret}` });
    } catch {
      // Unbound on purpose: an error nobody holds cannot be interpolated into a message.
      throw new WalletError("token_rejected", UNUSABLE_TOKEN_MESSAGE, null, null, false);
    }
  }

  /**
   * A message from outside, with the credential taken out of it. Nothing should reach here holding
   * the token — it is refused before any request and the header is built outside every `try` — but
   * this is the one place a foreign message is wrapped into `sync_runs.error`, and a redaction
   * that costs nothing outlives any chain of reasoning about who throws what.
   */
  function withoutToken(text: string): string {
    return secrets.reduce((clean, value) => clean.split(value).join("[token redacted]"), text);
  }

  /** One HTTP attempt: fetch, classify the answer, validate the payload. */
  async function attempt<T>(path: string, schema: ZodType<T>): Promise<T> {
    const headers = requestHeaders();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await call(`${baseUrl}${path}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new WalletError("timeout", `Wallet request timed out after ${timeoutMs} ms`, null, null, true);
      }
      throw new WalletError(
        "network",
        `Wallet request failed: ${withoutToken(errorText(error))}`,
        null,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text().catch(() => "");

    // The status decides first, every time: an answer outside 2xx is never handed to a schema.
    // A 400 fed to the record schema comes back as "an unexpected shape", which reads as an
    // unintelligible provider and then, one mapping later, as a network problem — three wrong
    // diagnoses for a body that said exactly what was wrong.
    const reason = errorFieldOf(body);
    const said = reason === null ? "" : `: ${withoutToken(reason)}`;

    if (response.status === 401 || response.status === 403) {
      throw new WalletError(
        "token_rejected",
        `Wallet rejected the token (HTTP ${response.status})${said}`,
        response.status,
        detailOf(body),
        false,
      );
    }
    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
      // 429 and 5xx are worth another go; a 4xx is the request's own fault and will be refused
      // identically five times over.
      const retryable = isRetryableStatus(response.status, body);
      throw new WalletError(
        "http",
        `Wallet answered HTTP ${response.status}${said}`,
        response.status,
        detailOf(body),
        retryable,
        retryAfterMs ?? (retryable && response.status === 409 ? INIT_SYNC_DELAY_MS : null),
      );
    }

    let payload: unknown;
    try {
      payload = parseJsonPreservingNumbers(body);
    } catch (error) {
      throw new WalletError("payload", `Wallet answered with a body that is not JSON: ${errorText(error)}`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new WalletError("payload", `Wallet answered an unexpected shape: ${issues}`);
    }
    return parsed.data;
  }

  /** The retry policy: only a retryable failure comes back, and never past `attempts`. */
  async function withRetry<T>(run: () => Promise<T>, attempts: number): Promise<T> {
    for (let count = 1; ; count += 1) {
      try {
        return await run();
      } catch (error) {
        const retryable = error instanceof WalletError && error.retryable;
        if (!retryable || count >= attempts) throw error;
        const floor = (error as WalletError).minDelayMs ?? 0;
        await sleep(Math.max(backoffDelayMs(count, jitter()), floor));
      }
    }
  }

  function read<T>(path: string, schema: ZodType<T>): Promise<T> {
    return withRetry(() => attempt(path, schema), READ_ATTEMPTS);
  }

  /**
   * `/accounts` in one request, for both `accounts()` and `balances()`: Wallet publishes the
   * balance inside the account, so the two views are the same read seen twice.
   */
  async function accountPayloads(): Promise<WalletAccountPayload[]> {
    const accounts = await read(`/accounts?limit=${ACCOUNTS_LIMIT}`, walletAccountsPayloadSchema);
    assertWholePage("accounts", accounts.length, ACCOUNTS_LIMIT);
    return accounts;
  }

  /**
   * One window of `/records`, halving it instead of failing when the page comes back full
   * (spec §9.1).
   *
   * Four checks come first, on every page, full or not: that Wallet declares having applied the
   * window that was asked for ({@link assertWindowApplied}), that every movement it sent falls
   * inside that window ({@link assertWithinWindow}), that `limit` was honoured
   * ({@link assertLimitHonoured}), and that the fields whose names were never verified are present
   * somewhere ({@link assertFieldSeenSomewhere}). They run before the split so a wrong request is
   * reported as one, instead of being narrowed down to a single day and blamed on that day.
   *
   * A full page is not kept: it may be any subset of the window, so both halves are read again in
   * full. The halves are disjoint, so nothing is read twice in practice — `found` is keyed by
   * external id anyway, which also makes a boundary the provider happens to treat as exclusive
   * harmless. A single day that still fills a page cannot be split any further, and that is the
   * one case where the reader has to say so rather than return a fraction of the movements.
   */
  async function readWindow(window: DateWindow, found: Map<string, WalletTransaction>): Promise<void> {
    const query = new URLSearchParams({ limit: String(recordsLimit) });
    // The filter form the previous version's client used against the live API (`recordDate=gte.…`),
    // repeated to bound the window at both ends.
    query.append("recordDate", `gte.${window.from}`);
    query.append("recordDate", `lte.${window.to}`);
    const page = await read(`/records?${query.toString()}`, walletRecordsPayloadSchema);

    assertWindowApplied(window, page.appliedRecordDateFilters);
    assertWithinWindow(window, page.records);
    assertLimitHonoured(page.records.length, recordsLimit);
    assertFieldSeenSomewhere(page.records, "recordType");
    assertFieldSeenSomewhere(page.records, "recordState");

    if (page.records.length < recordsLimit) {
      for (const raw of page.records) {
        const transaction = mapWalletRecord(raw);
        found.set(transaction.externalId, transaction);
      }
      return;
    }

    const halves = splitWindow(window);
    if (halves === null) {
      throw new WalletError(
        "page_truncated",
        `Wallet filled a page of ${recordsLimit} records for the single day ${window.from}: the window cannot be narrowed any further`,
        null,
        { day: window.from, limit: recordsLimit },
      );
    }
    for (const half of halves) await readWindow(half, found);
  }

  return {
    async accounts() {
      return (await accountPayloads()).map(mapWalletAccount);
    },
    async balances() {
      return (await accountPayloads()).map(mapWalletBalance);
    },
    async transactions(window) {
      const found = new Map<string, WalletTransaction>();
      await readWindow(window, found);
      // Deterministic order, so a sync applies the same rows in the same sequence every pass.
      return [...found.values()].sort(byDateThenId);
    },
    async categories() {
      const categories = await read(`/categories?limit=${CATEGORIES_LIMIT}`, walletCategoriesPayloadSchema);
      assertWholePage("categories", categories.length, CATEGORIES_LIMIT);
      return categories.map(mapWalletCategory);
    },
  };
}
