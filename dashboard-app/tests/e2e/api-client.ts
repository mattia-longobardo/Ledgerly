/**
 * A tiny REST client for the end-to-end smoke, built on Playwright's
 * `request` fixture.
 *
 * Two things every call needs and nothing in Playwright supplies on its own:
 *
 * 1. `Authorization: Bearer ${E2E_TOKEN}` — a personal access token. The
 *    browser sign-in path goes through Authentik and cannot be automated
 *    here (see `README.md`), so the API smoke authenticates the way a script
 *    would. A token is never sent by a browser by itself, so these requests
 *    are exempt from the `X-Requested-With` CSRF check and must NOT send it.
 * 2. A fresh `Idempotency-Key` per request. Several write routes require one
 *    (`POST /accounts`, `POST /funds/{id}/contributions`, `POST
 *    /budgets/{id}/usages`); reusing a key with a different body is a
 *    deliberate `422 idempotency_key_reused`, so the key is minted per call
 *    rather than per run.
 */

import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";

export const E2E_TOKEN = (process.env.E2E_TOKEN ?? "").trim();

/** Printed by every spec that needs a token, so a skipped run says why. */
export const TOKEN_MISSING_MESSAGE =
  "E2E_TOKEN is not set. Mint a personal access token at Settings › Security " +
  "(scopes: accounts.read/write, budgets.read/write, funds.read/write, " +
  "timeoff.read/write) and export it — see tests/e2e/README.md.";

const BASE = "/api/v1";

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${E2E_TOKEN}`,
    "idempotency-key": randomUUID(),
    "content-type": "application/json",
  };
}

export interface ApiClient {
  get(path: string, params?: Record<string, string | number | boolean>): Promise<APIResponse>;
  post(path: string, body?: unknown): Promise<APIResponse>;
  put(path: string, body?: unknown): Promise<APIResponse>;
  del(path: string): Promise<APIResponse>;
  /**
   * Assert the status and return the parsed body. On a mismatch the raw body
   * is in the failure message — an API error envelope carries the `code` and
   * `requestId` that say what actually went wrong.
   */
  expectJson<T>(response: APIResponse, status: number): Promise<T>;
  expectStatus(response: APIResponse, status: number): Promise<void>;
}

async function describe(response: APIResponse, status: number): Promise<string> {
  const body = await response.text().catch(() => "<unreadable>");
  return `Expected ${status} from ${response.url()}, got ${response.status()}: ${body}`;
}

export function apiClient(request: APIRequestContext): ApiClient {
  return {
    get: (path, params) => request.get(`${BASE}${path}`, { headers: headers(), params }),
    post: (path, body) => request.post(`${BASE}${path}`, { headers: headers(), data: body ?? {} }),
    put: (path, body) => request.put(`${BASE}${path}`, { headers: headers(), data: body ?? {} }),
    del: (path) => request.delete(`${BASE}${path}`, { headers: headers() }),

    async expectJson<T>(response: APIResponse, status: number): Promise<T> {
      if (response.status() !== status) throw new Error(await describe(response, status));
      return (await response.json()) as T;
    },

    async expectStatus(response: APIResponse, status: number): Promise<void> {
      if (response.status() !== status) throw new Error(await describe(response, status));
    },
  };
}

/** `YYYY-MM-DD` for a date, in the runner's own timezone. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The next Monday strictly after today. `setEvent` refuses weekends, so the
 * time-off leg needs a weekday that is not today's (a day already booked by a
 * previous run is simply overwritten — `PUT` is an upsert).
 */
export function nextMonday(from: Date = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  do {
    day.setDate(day.getDate() + 1);
  } while (day.getDay() !== 1);
  return isoDate(day);
}

/** A run-unique suffix, so re-running the smoke never collides on a unique key. */
export function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
