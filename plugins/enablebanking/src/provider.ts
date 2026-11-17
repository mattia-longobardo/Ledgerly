/**
 * The calls to the Enable Banking API (https://enablebanking.com/docs/api/reference/), account
 * information only. Every answer is read through a schema, and every failure becomes a code of
 * the contract: the provider's message stays here.
 */
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import type { PluginErrorCode } from "../../../src/platform/plugins/contract/errors";
import { PluginFailure } from "./failure";
import { signToken } from "./jwt";

export const PROVIDER_HOST = "api.enablebanking.com";
const BASE_URL = `https://${PROVIDER_HOST}`;
const TIMEOUT_MS = 30_000;

const amount = z.object({ currency: z.string(), amount: z.string() });
const party = z.object({ name: z.string().nullish() }).nullish();

export const applicationSchema = z.object({
  active: z.boolean(),
  environment: z.string().nullish(),
  services: z.array(z.string()).nullish(),
});

export const aspspsSchema = z.object({
  aspsps: z.array(
    z.object({
      name: z.string(),
      country: z.string(),
      maximum_consent_validity: z.number().nullish(),
      psu_types: z.array(z.string()).nullish(),
      required_psu_headers: z.array(z.string()).nullish(),
    }),
  ),
});

export const startSchema = z.object({ url: z.string() });

export const sessionSchema = z.object({
  session_id: z.string(),
  accounts: z.array(
    z.object({
      uid: z.string().nullish(),
      account_id: z.object({ iban: z.string().nullish() }).nullish(),
      name: z.string().nullish(),
      product: z.string().nullish(),
      details: z.string().nullish(),
      currency: z.string(),
      cash_account_type: z.string().nullish(),
      identification_hash: z.string().nullish(),
    }),
  ),
  aspsp: z.object({ name: z.string(), country: z.string() }),
  access: z.object({ valid_until: z.string().nullish() }).nullish(),
});

export const balancesSchema = z.object({
  balances: z.array(
    z.object({
      balance_amount: amount,
      balance_type: z.string(),
      reference_date: z.string().nullish(),
    }),
  ),
});

export const transactionsSchema = z.object({
  transactions: z.array(
    z.object({
      entry_reference: z.string().nullish(),
      transaction_amount: amount,
      credit_debit_indicator: z.string(),
      status: z.string(),
      booking_date: z.string().nullish(),
      value_date: z.string().nullish(),
      transaction_date: z.string().nullish(),
      remittance_information: z.array(z.string()).nullish(),
      creditor: party,
      debtor: party,
      merchant_category_code: z.string().nullish(),
      bank_transaction_code: z
        .object({
          description: z.string().nullish(),
          code: z.string().nullish(),
          sub_code: z.string().nullish(),
        })
        .nullish(),
    }),
  ),
  continuation_key: z.string().nullish(),
});

const errorSchema = z.object({ error: z.string().nullish() });

/** The provider's error names, as the codes of the contract. A name that is not here is read by its status. */
const BY_NAME: Record<string, PluginErrorCode> = {
  EXPIRED_SESSION: "consent_expired",
  CLOSED_SESSION: "consent_expired",
  REVOKED_SESSION: "consent_expired",
  SESSION_DOES_NOT_EXIST: "consent_expired",
  WRONG_SESSION_STATUS: "consent_expired",
  ASPSP_RATE_LIMIT_EXCEEDED: "rate_limited",
  ASPSP_ERROR: "provider_down",
  ASPSP_TIMEOUT: "provider_down",
  ASPSP_ACCOUNT_NOT_ACCESSIBLE: "provider_down",
  WRONG_ASPSP_PROVIDED: "institution_unavailable",
  UNAUTHORIZED_ACCESS: "auth",
  AUTHORIZATION_NOT_PROVIDED: "auth",
  UNAUTHORIZED_IP: "auth",
  ACCESS_DENIED: "auth",
  REDIRECT_URI_NOT_ALLOWED: "auth",
  EXPIRED_AUTHORIZATION_CODE: "consent_expired",
  WRONG_AUTHORIZATION_CODE: "consent_expired",
};

/** The code of a failed answer: the provider's error name first, then the HTTP status. */
export function failureCode(status: number, name: string | null): PluginErrorCode {
  if (name !== null && BY_NAME[name] !== undefined) return BY_NAME[name];
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "provider_down";
  return "failed";
}

/**
 * The provider's error name for the log, kept only when it has the shape of one of its documented
 * names (`ASPSP_ERROR`). Its message is never logged: it can quote what it was given.
 */
export function errorName(name: string | null): string {
  return name !== null && /^[A-Z_]{3,40}$/.test(name) ? name : "-";
}

/** The person's address and browser, sent when they asked for the reading themselves. */
export interface Presence {
  ip: string | null;
  userAgent: string | null;
}

export type Fetch = typeof fetch;

export interface Provider {
  application(): Promise<z.infer<typeof applicationSchema>>;
  aspsps(country: string): Promise<z.infer<typeof aspspsSchema>>;
  startAuth(body: object): Promise<z.infer<typeof startSchema>>;
  createSession(code: string): Promise<z.infer<typeof sessionSchema>>;
  deleteSession(id: string): Promise<void>;
  balances(account: string, presence: Presence | null): Promise<z.infer<typeof balancesSchema>>;
  transactions(
    account: string,
    query: { dateFrom: string | null; continuationKey: string | null },
    presence: Presence | null,
  ): Promise<z.infer<typeof transactionsSchema>>;
}

function presenceHeaders(presence: Presence | null): Record<string, string> {
  if (presence === null || presence.ip === null) return {};
  return {
    "Psu-Ip-Address": presence.ip,
    ...(presence.userAgent === null ? {} : { "Psu-User-Agent": presence.userAgent }),
  };
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

export function createProvider(applicationId: string, key: KeyObject, fetchFn: Fetch = fetch): Provider {
  async function call<T>(
    schema: z.ZodType<T>,
    request: { method: string; path: string; body?: object; headers?: Record<string, string> },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${BASE_URL}${request.path}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${signToken(applicationId, key)}`,
          accept: "application/json",
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          ...request.headers,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PluginFailure("provider_down");
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    // For the log: which call, by its first segment only — the rest carries ids.
    const what = `${request.method} /${request.path.split(/[/?]/)[1] ?? ""}`;
    if (!response.ok) {
      const named = errorSchema.safeParse(json);
      const name = named.success ? (named.data.error ?? null) : null;
      const code = failureCode(response.status, name);
      console.warn(`[plugin] ${what}: provider answered ${response.status} ${errorName(name)} → ${code}`);
      throw new PluginFailure(code, retryAfter(response));
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Paths only: a path names a field of the answer, never its value.
      const where = parsed.error.issues.slice(0, 5).map((issue) => issue.path.join(".") || "(root)");
      console.warn(`[plugin] ${what}: answer not readable at ${where.join(", ")}`);
      throw new PluginFailure("invalid_data");
    }
    return parsed.data;
  }

  return {
    application: () => call(applicationSchema, { method: "GET", path: "/application" }),
    aspsps: (country) =>
      call(aspspsSchema, {
        method: "GET",
        path: `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal&service=AIS`,
      }),
    startAuth: (body) => call(startSchema, { method: "POST", path: "/auth", body }),
    createSession: (code) => call(sessionSchema, { method: "POST", path: "/sessions", body: { code } }),
    async deleteSession(id) {
      await call(z.unknown(), { method: "DELETE", path: `/sessions/${encodeURIComponent(id)}` });
    },
    balances: (account, presence) =>
      call(balancesSchema, {
        method: "GET",
        path: `/accounts/${encodeURIComponent(account)}/balances`,
        headers: presenceHeaders(presence),
      }),
    transactions(account, query, presence) {
      const params = new URLSearchParams();
      if (query.continuationKey !== null) params.set("continuation_key", query.continuationKey);
      // `longest` asks the provider for the widest period the institution gives; with a first day
      // the reading is the plain one from that day on.
      if (query.dateFrom === null) params.set("strategy", "longest");
      else params.set("date_from", query.dateFrom);
      return call(transactionsSchema, {
        method: "GET",
        path: `/accounts/${encodeURIComponent(account)}/transactions?${params.toString()}`,
        headers: presenceHeaders(presence),
      });
    },
  };
}
