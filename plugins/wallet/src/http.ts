/**
 * The HTTP door to Budget Makers Wallet's REST API. A read gets five attempts with an exponential
 * backoff that honours `Retry-After`; a write gets one, because a 5xx after Wallet stored a record
 * would otherwise store it twice. 401 and 403 fail at once as `token_rejected`. Every answer outside
 * 2xx is classified by its status before its body is ever shown to a schema, and every number of a
 * body is kept as the text Wallet sent, so no amount goes through a float.
 */
import type { ZodType } from "zod";
import { PluginFailure, WalletError } from "./failure";

export const WALLET_HOST = "rest.budgetbakers.com";
const WALLET_API_URL = `https://${WALLET_HOST}/wallet/v1/api`;

const READ_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 32_000;
const JITTER_FRACTION = 0.25;
const INIT_SYNC_DELAY_MS = 30_000;
const TIMEOUT_MS = 20_000;
/**
 * The longest wait sat through inside one call. The core waits for an answer, so a longer
 * `Retry-After` is not waited here: the failure goes back with the wait, and the core calls again.
 */
const MAX_WAIT_MS = 16_000;
/** The page size of `/records`: the ceiling the API enforces (`limit must be at most 200`). */
const RECORDS_LIMIT = 200;

/** What a test replaces: no call leaves the process, and no backoff is waited through. */
export interface WalletDeps {
  fetchFn?: typeof globalThis.fetch;
  sleep?: (delayMs: number) => Promise<void>;
  /** In [0, 1): the share of jitter added to a backoff. */
  jitter?: () => number;
  now?: () => number;
  /** The page size asked of `/records`; lowered in tests so a fixture of two rows fills a page. */
  pageLimit?: number;
}

/** One call's handle on Wallet: the token of its body and the means to reach the API. */
export interface Wallet {
  token: string;
  fetchFn: typeof globalThis.fetch;
  sleep: (delayMs: number) => Promise<void>;
  jitter: () => number;
  now: () => number;
  pageLimit: number;
}

interface WalletRequest {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: string;
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/** The token was checked by the caller (`isUsableToken`); edge whitespace is a paste artefact. */
export function openWallet(token: string, deps: WalletDeps = {}): Wallet {
  return {
    token: token.trim(),
    fetchFn: deps.fetchFn ?? globalThis.fetch,
    sleep: deps.sleep ?? defaultSleep,
    jitter: deps.jitter ?? Math.random,
    now: deps.now ?? Date.now,
    pageLimit: deps.pageLimit ?? RECORDS_LIMIT,
  };
}

/** `Retry-After` is delta-seconds or an HTTP date; anything else is no instruction at all. */
export function parseRetryAfterMs(raw: string | null, now: number): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

/** 2 s doubling to a 32 s ceiling, plus up to 25 % of jitter so retries do not march in step. */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return exponential + Math.floor(jitter * exponential * JITTER_FRACTION);
}

/**
 * A body with every JSON number kept as the text Wallet sent: the reviver receives the number's
 * source text (Node 22+), so "2615.39" stays seven characters and never becomes a double. On a
 * runtime without it the number passes through, and `walletAmountToCents` takes the lossy path.
 */
export function parseJsonPreservingNumbers(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === "number" && typeof context?.source === "string" ? context.source : value,
  );
}

/** 429 and 5xx are worth another go; a 409 only while Wallet says it is still initialising. */
function isRetryableStatus(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 409 && body.toLowerCase().includes("init_sync");
}

/**
 * Built outside the `try` around `fetch`: a header `fetch` validates itself fails with an error
 * that quotes the whole value, token included.
 */
function requestHeaders(token: string, hasBody: boolean): Headers {
  try {
    const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });
    if (hasBody) headers.set("content-type", "application/json");
    return headers;
  } catch {
    // Unbound on purpose: an error nobody holds cannot be quoted anywhere.
    throw new PluginFailure("key_format");
  }
}

async function send(wallet: Wallet, request: WalletRequest): Promise<Response> {
  const headers = requestHeaders(wallet.token, request.body !== undefined);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    return await wallet.fetchFn(`${WALLET_API_URL}${request.path}`, {
      method: request.method,
      headers,
      body: request.body,
      signal: controller.signal,
    });
  } catch {
    // The message of a transport failure is not kept: it is the one place a foreign text could
    // carry the token.
    throw new WalletError(timedOut ? "timeout" : "network", "Wallet could not be reached", {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The status decides first: an answer outside 2xx (207 is inside) is never handed to a schema. */
function refuseStatus(response: Response, answer: string, now: number): void {
  const status = response.status;
  if (status === 401 || status === 403) {
    throw new WalletError("token_rejected", `Wallet rejected the token (HTTP ${status})`, { status });
  }
  if (response.ok) return;
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now);
  const retryable = isRetryableStatus(status, answer);
  throw new WalletError("http", `Wallet answered HTTP ${status}`, {
    status,
    retryable,
    minDelayMs: retryAfterMs ?? (retryable && status === 409 ? INIT_SYNC_DELAY_MS : null),
  });
}

function readBody<T>(answer: string, schema: ZodType<T>): T {
  let payload: unknown;
  try {
    payload = parseJsonPreservingNumbers(answer);
  } catch {
    throw new WalletError("payload", "Wallet answered with a body that is not JSON");
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

/** One request: fetch, classify the answer, validate the payload. A write is exactly this. */
export async function write<T>(wallet: Wallet, request: WalletRequest, schema: ZodType<T>): Promise<T> {
  const response = await send(wallet, request);
  const answer = await response.text().catch(() => "");
  refuseStatus(response, answer, wallet.now());
  return readBody(answer, schema);
}

/** A read: only a retryable failure comes back, never past five attempts or a wait too long. */
export async function read<T>(wallet: Wallet, path: string, schema: ZodType<T>): Promise<T> {
  for (let count = 1; ; count += 1) {
    try {
      return await write(wallet, { path, method: "GET" }, schema);
    } catch (error) {
      if (!(error instanceof WalletError) || !error.retryable || count >= READ_ATTEMPTS) throw error;
      const delayMs = Math.max(backoffDelayMs(count, wallet.jitter()), error.minDelayMs ?? 0);
      if (delayMs > MAX_WAIT_MS) throw error;
      await wallet.sleep(delayMs);
    }
  }
}
