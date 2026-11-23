/**
 * Budget Makers Wallet's unofficial REST API (spec §9.1), for the one use left in the core: the
 * interest posting of interests (`posting.ts`, port `LedgerPosting`), which contract 2 has no call
 * for. Every other read and write of Wallet goes through the plugin (rewrite plan R5c); this file
 * goes with the posting (decision ST-14).
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

import { z, type ZodType } from "zod";
import { isUsableToken } from "../credentials";
import { type CivilDate, isCivilDate } from "../../../shared/dates";
import { type Cents, centsToDecimal } from "../../../shared/money";
import { walletAmountToCents, walletRecordSchema } from "./mapping";

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
type WalletErrorKind = "token_rejected" | "http" | "network" | "timeout" | "payload";

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

interface WalletClientOptions {
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
}

interface WalletClient {
  /**
   * F4: the records of one Wallet account on one day whose note contains `marker` — the duplicate
   * check before publishing an interest settlement (spec §7.6). The filter shape
   * (`accountId=eq.`, `recordDate=eq.`, `note=contains.`) is the one the owner's `interest.py`
   * used against the live API.
   */
  recordsWithNote(query: { accountId: string; on: CivilDate; marker: string }): Promise<WalletNoteRecord[]>;
  /**
   * F4: one new record (spec §7.6, §9.1), **one attempt** (`WRITE_ATTEMPTS`): a 5xx after Wallet
   * stored it must not store it twice. The answer's id is `null` when the body carries none that
   * can be read — the record may well exist; the caller treats that as unsure, never as done.
   *
   * `categoryId` is Wallet's *own* id of the category the record is filed under, resolved by the
   * caller from the `category` links of `provider_links`; left out (or `null`), the record is
   * posted with no category at all, which is what Wallet does with a body that omits the field.
   * This client never looks a category up by name and never creates one.
   */
  createRecord(input: {
    accountId: string;
    amountCents: Cents;
    on: CivilDate;
    note: string;
    categoryId?: string | null;
  }): Promise<{ id: string | null }>;
}

/** A record found by the duplicate check: enough to tell whether it is the one we would post. */
interface WalletNoteRecord {
  id: string;
  amountCents: Cents;
  note: string | null;
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
  if (typeof field === "string" && field.trim() !== "") return field.trim();
  // A write answers with the batch envelope instead (`{ summary, results: [{ error }] }`): a 400
  // that refused every item says why item by item, and nowhere else.
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const reasons = results
    .map((row: unknown) =>
      row !== null && typeof row === "object" ? (row as { error?: unknown }).error : null,
    )
    .filter((said): said is string => typeof said === "string" && said.trim() !== "")
    .map((said) => said.trim());
  return reasons.length === 0 ? null : [...new Set(reasons)].join("; ");
}

/** An error body, bounded: a provider that answers with an HTML page must not fill a log with it. */
function detailOf(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;
  return trimmed.length <= MAX_DETAIL_CHARS ? trimmed : `${trimmed.slice(0, MAX_DETAIL_CHARS)}…`;
}

/**
 * The one message a token this client cannot send is ever reported with. It says what to do about
 * it and nothing about its value, and every path that could otherwise name the token ends here.
 */
const UNUSABLE_TOKEN_MESSAGE =
  "The Wallet token cannot be sent in an HTTP header — a line break or a control character inside it — so no request was made: paste the token again from Wallet";

/** The duplicate check's answer: records, with or without the filters Wallet says it applied. */
const noteRecordsSchema = z.object({ records: z.array(walletRecordSchema) });

/**
 * What a POST of records answers — never verified against the live API (plan F4 §3.5): wrapped like
 * every read (`{ records: [...] }`) or a bare array. Anything else fails as `payload`, which the
 * caller records as unsure.
 */
const createdRecordsSchema = z.union([
  z
    .object({ records: z.array(z.object({ id: z.string().min(1) }).passthrough()) })
    .transform((v) => v.records),
  z.array(z.object({ id: z.string().min(1) }).passthrough()),
]);

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
  async function attempt<T>(
    path: string,
    schema: ZodType<T>,
    body?: string,
    method: "GET" | "POST" | "PATCH" = body === undefined ? "GET" : "POST",
  ): Promise<T> {
    const headers = requestHeaders();
    if (body !== undefined) headers.set("content-type", "application/json");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await call(`${baseUrl}${path}`, {
        method,
        headers,
        body,
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

    const answer = await response.text().catch(() => "");

    // The status decides first, every time: an answer outside 2xx is never handed to a schema.
    // A 400 fed to the record schema comes back as "an unexpected shape", which reads as an
    // unintelligible provider and then, one mapping later, as a network problem — three wrong
    // diagnoses for a body that said exactly what was wrong.
    const reason = errorFieldOf(answer);
    const said = reason === null ? "" : `: ${withoutToken(reason)}`;

    if (response.status === 401 || response.status === 403) {
      throw new WalletError(
        "token_rejected",
        `Wallet rejected the token (HTTP ${response.status})${said}`,
        response.status,
        detailOf(answer),
        false,
      );
    }
    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
      // 429 and 5xx are worth another go; a 4xx is the request's own fault and will be refused
      // identically five times over.
      const retryable = isRetryableStatus(response.status, answer);
      throw new WalletError(
        "http",
        `Wallet answered HTTP ${response.status}${said}`,
        response.status,
        detailOf(answer),
        retryable,
        retryAfterMs ?? (retryable && response.status === 409 ? INIT_SYNC_DELAY_MS : null),
      );
    }

    let payload: unknown;
    try {
      payload = parseJsonPreservingNumbers(answer);
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

  return {
    async recordsWithNote({ accountId, on, marker }) {
      const query = new URLSearchParams({ limit: "5" });
      query.append("accountId", `eq.${accountId}`);
      query.append("recordDate", `eq.${on}`);
      query.append("note", `contains.${marker}`);
      const page = await read(`/records?${query.toString()}`, noteRecordsSchema);
      return page.records.map((raw) => ({
        id: raw.id,
        amountCents: walletAmountToCents(raw.amount.value),
        note: raw.note?.trim() || null,
      }));
    },
    async createRecord({ accountId, amountCents, on, note, categoryId = null }) {
      if (!isCivilDate(on)) throw new RangeError(`Not a civil date: "${on}"`);
      // The field is omitted rather than sent as `null` when there is no category: an explicit
      // null is a value Wallet has never been asked to accept, and an unfiled record is exactly
      // what the absent field means.
      const category = categoryId === null ? "" : `,"categoryId":${JSON.stringify(categoryId)}`;
      // Written by hand so the amount reaches the wire as its exact decimal, never through a float.
      const body = `[{"accountId":${JSON.stringify(accountId)},"amount":${centsToDecimal(amountCents)},"recordDate":${JSON.stringify(on)},"note":${JSON.stringify(note)}${category}}]`;
      const created = await withRetry(() => attempt("/records", createdRecordsSchema, body), WRITE_ATTEMPTS);
      return { id: created[0]?.id ?? null };
    },
  };
}
