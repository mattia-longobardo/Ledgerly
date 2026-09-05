import type { ZodType } from "zod";
import { UpstreamError } from "@/lib/contracts";

export type UpstreamService = "wallet" | "gotify" | "trek";

export type SleepFn = (ms: number) => Promise<void>;

export const sleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** An upstream answered, or the transport failed — carries what retry policies need. */
export class HttpError extends UpstreamError {
  constructor(
    service: UpstreamService,
    message: string,
    readonly status: number | null,
    detail: unknown,
    retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(service, message, detail, retryable);
    this.name = "HttpError";
  }
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Hard ceiling on the whole request; upstreams here are all slow-ish but bounded. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 409 || status >= 500;
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(raw: string | null, now = Date.now()): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 4000);
  }
}

/**
 * Fetch with a timeout, throwing `HttpError` on any non-2xx so callers never
 * have to remember that fetch resolves on 500.
 */
export async function httpRequest(
  service: UpstreamService,
  url: string,
  init: HttpRequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onOuterAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body ?? null,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new HttpError(service, `request timed out after ${timeoutMs} ms`, null, String(err), true);
    }
    if (init.signal?.aborted) {
      throw new HttpError(service, "request aborted by caller", null, String(err), false);
    }
    throw new HttpError(service, `network error: ${errorMessage(err)}`, null, String(err), true);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onOuterAbort);
  }

  if (!res.ok) {
    const detail = await readBody(res);
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    throw new HttpError(
      service,
      `HTTP ${res.status} ${res.statusText}`.trim(),
      res.status,
      detail,
      isRetryableStatus(res.status),
      retryAfterMs,
    );
  }
  return res;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Fetch + JSON + Zod. A contract break is loud and non-retryable. */
export async function requestJson<T>(
  service: UpstreamService,
  url: string,
  schema: ZodType<T>,
  init: HttpRequestInit = {},
): Promise<T> {
  const res = await httpRequest(service, url, {
    ...init,
    headers: { accept: "application/json", ...init.headers },
  });
  const raw = await readBody(res);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError(
      service,
      `unexpected payload shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      raw,
      false,
    );
  }
  return parsed.data;
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Injectable so tests don't actually wait. */
  sleep?: SleepFn;
  /** Injectable for deterministic tests; returns [0,1). */
  jitter?: () => number;
  /** Service-specific floor, e.g. wallet's 30 s on `409 init_sync`. */
  minDelayFor?: (err: unknown, attempt: number) => number | null;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const JITTER_FRACTION = 0.25;

export function backoffDelay(attempt: number, baseMs: number, maxMs: number, jitter: number): number {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  return exp + Math.floor(jitter * exp * JITTER_FRACTION);
}

function isRetryable(err: unknown): boolean {
  return err instanceof UpstreamError && err.retryable;
}

/** 5 attempts, 2→32 s exponential + jitter, honouring `Retry-After` and any floor. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 2000;
  const maxMs = opts.maxMs ?? 32_000;
  const wait = opts.sleep ?? sleep;
  const jitter = opts.jitter ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === attempts) throw err;
      let delay = backoffDelay(attempt, baseMs, maxMs, jitter());
      const floor = opts.minDelayFor?.(err, attempt);
      if (floor !== null && floor !== undefined) delay = Math.max(delay, floor);
      if (err instanceof HttpError && err.retryAfterMs !== null) {
        delay = Math.max(delay, err.retryAfterMs);
      }
      opts.onRetry?.(err, attempt, delay);
      await wait(delay);
    }
  }
  throw lastError;
}
