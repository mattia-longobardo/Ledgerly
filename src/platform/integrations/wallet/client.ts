/**
 * Budget Makers Wallet's unofficial REST API (spec §9.1).
 *
 * HTTP only: no database handle, no transaction, no module import. The credential is passed in —
 * the token lives sealed in `integration_connections` and is opened by the caller — so one process
 * can read on behalf of several users without this file ever knowing where tokens are kept.
 *
 * Reads get 5 attempts with exponential backoff that honours `Retry-After`; a write gets one
 * ({@link WRITE_ATTEMPTS}); 401 and 403 fail at once as {@link WalletError} `token_rejected`.
 */

import { type ZodType } from "zod";
import { type CivilDate } from "@/platform/dates";
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

const ACCOUNTS_LIMIT = 200;
const CATEGORIES_LIMIT = 200;
const RECORDS_LIMIT = 500;
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
   * Beyond the three signatures F2 agreed on, and additive to them: a movement carries only
   * `categoryId`, and §9.1 adopts a category by its exact *name*, so the sync needs this read to
   * follow that rule at all.
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

  /** One HTTP attempt: fetch, classify the answer, validate the payload. */
  async function attempt<T>(path: string, schema: ZodType<T>): Promise<T> {
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
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new WalletError("timeout", `Wallet request timed out after ${timeoutMs} ms`, null, null, true);
      }
      throw new WalletError("network", `Wallet request failed: ${errorText(error)}`, null, null, true);
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text().catch(() => "");

    if (response.status === 401 || response.status === 403) {
      throw new WalletError(
        "token_rejected",
        `Wallet rejected the token (HTTP ${response.status})`,
        response.status,
        detailOf(body),
        false,
      );
    }
    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
      const retryable = isRetryableStatus(response.status, body);
      throw new WalletError(
        "http",
        `Wallet answered HTTP ${response.status}`,
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

    if (page.length < recordsLimit) {
      for (const raw of page) {
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
