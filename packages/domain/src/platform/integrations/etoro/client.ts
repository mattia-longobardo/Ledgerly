/**
 * eToro's public API, read only (docs/design/investments.md §3.3, D17).
 *
 * HTTP only: no database, no module import. The credentials are passed in, so this file never
 * knows where they are kept. Every path is fixed here and is a `GET` on the real environment: no
 * `/demo/`, no write, not even a "validate" one (§5.2). The host is a constant, never an input.
 *
 * Every answer is checked with zod before anyone reads it; a failure is a {@link SourceError} with
 * a class and a status only — never the message, the URL, the body or zod's issues (§5.1).
 */
import { z, type ZodType } from "zod";
import { SourceError } from "../investments/source";

export const ETORO_API_URL = "https://public-api.etoro.com";
export const ETORO = "etoro";

const TIMEOUT_MS = 20_000;
/** `trade/history` and the cash transactions both page by 500 at most (spike, E4 and E5). */
export const PAGE_SIZE = 500;
/** No account has this many pages: a guard against a cursor that never ends. */
const MAX_PAGES = 200;
const INSTRUMENT_BATCH = 50;
const PATH_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface EtoroCredentials {
  apiKey: string;
  userKey: string;
}

export interface EtoroClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const number = z.number().finite();

export const meSchema = z.object({
  gcid: z.number().int(),
  realCid: z.number().int().nullish(),
  scopes: z.array(z.string().max(200)).max(500),
});
export type EtoroMe = z.infer<typeof meSchema>;

export const balancesSchema = z.object({
  gcid: z.number().int(),
  totalBalance: number,
  displayCurrency: z.string(),
  balances: z
    .array(
      z.object({
        accountId: z.string().max(100),
        accountType: z.string().min(1).max(60),
        subType: z.string().nullish(),
        balance: number,
        currency: z.string().min(1).max(20),
        displayBalance: number,
        displayCurrency: z.string(),
        exchangeRate: number.nullish(),
      }),
    )
    .max(500),
});
export type EtoroBalances = z.infer<typeof balancesSchema>;

const unrealizedSchema = z
  .object({
    pnL: number.nullish(),
    closeRate: number.nullish(),
    timestamp: z.string().nullish(),
  })
  .nullish();

const positionSchema = z.object({
  positionID: z.number().int(),
  instrumentID: z.number().int(),
  isBuy: z.boolean().nullish(),
  amount: number.nullish(),
  units: number.nullish(),
  openRate: number.nullish(),
  mirrorID: z.number().int().nullish(),
  unrealizedPnL: unrealizedSchema,
});
export type EtoroPosition = z.infer<typeof positionSchema>;

export const portfolioSchema = z.object({
  clientPortfolio: z.object({
    positions: z.array(positionSchema).max(5000),
    mirrors: z
      .array(
        z.object({
          mirrorID: z.number().int(),
          parentUsername: z.string().max(100).nullish(),
          availableAmount: number.nullish(),
          positions: z.array(positionSchema).max(5000).nullish(),
        }),
      )
      .max(500),
    credit: number.nullish(),
  }),
});
export type EtoroPortfolio = z.infer<typeof portfolioSchema>;

export const instrumentsSchema = z.object({
  instrumentDisplayDatas: z
    .array(
      z.object({
        instrumentID: z.number().int(),
        instrumentDisplayName: z.string().max(200).nullish(),
        instrumentTypeID: z.number().int().nullish(),
        symbolFull: z.string().max(60).nullish(),
      }),
    )
    .max(INSTRUMENT_BATCH * 2),
});
export type EtoroInstrument = z.infer<typeof instrumentsSchema>["instrumentDisplayDatas"][number];

export const tradeSchema = z.object({
  positionId: z.number().int(),
  instrumentId: z.number().int(),
  isBuy: z.boolean(),
  leverage: z.number().nullish(),
  openRate: number,
  closeRate: number,
  openTimestamp: z.string(),
  closeTimestamp: z.string(),
  investment: number,
  netProfit: number,
  fees: number.nullish(),
  units: number,
  socialTradeId: z.number().int().nullish(),
  parentPositionId: z.number().int().nullish(),
});
export type EtoroTrade = z.infer<typeof tradeSchema>;
const tradesSchema = z.array(tradeSchema).max(PAGE_SIZE);

export const cashTransactionSchema = z.object({
  id: z.string().min(1).max(100),
  transactionType: z.string().max(60),
  transactionSubtype: z.string().max(60).nullish(),
  direction: z.enum(["credit", "debit"]),
  status: z.string().max(40),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  postedAt: z.string(),
  counterparty: z
    .object({ name: z.string().max(200).nullish(), type: z.string().max(60).nullish() })
    .nullish(),
});
export type EtoroCashTransaction = z.infer<typeof cashTransactionSchema>;
const cashPageSchema = z.object({
  results: z.array(cashTransactionSchema).max(PAGE_SIZE),
  pagination: z.object({ nextPageToken: z.string().max(200).nullish(), hasNext: z.boolean() }),
});

export const historySchema = z.object({
  displayCurrency: z.string(),
  snapshots: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        displayTotalBalance: number,
      }),
    )
    .max(400),
});
export type EtoroHistory = z.infer<typeof historySchema>;

const errorBodySchema = z.object({ code: z.string().max(80).optional() }).loose();

function headerSeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.ceil(seconds), 86_400) : null;
}

export class EtoroClient {
  readonly #credentials: EtoroCredentials;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(credentials: EtoroCredentials, options: EtoroClientOptions = {}) {
    this.#credentials = credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  async #get<T>(path: string, query: Record<string, string>, schema: ZodType<T>): Promise<T> {
    const url = new URL(path, ETORO_API_URL);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.#fetch(url.toString(), {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          "x-api-key": this.#credentials.apiKey,
          "x-user-key": this.#credentials.userKey,
          "x-request-id": crypto.randomUUID(),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timeout =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SourceError(ETORO, timeout ? "timeout" : "network");
    }
    const status = response.status;
    if (status === 401) throw new SourceError(ETORO, "auth", status);
    if (status === 403) throw new SourceError(ETORO, "permission", status);
    if (status === 429) {
      const wait =
        headerSeconds(response.headers.get("retry-after")) ??
        headerSeconds(response.headers.get("ratelimit-reset"));
      throw new SourceError(ETORO, "rate_limited", status, wait);
    }
    if (status >= 500) throw new SourceError(ETORO, "unavailable", status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceError(ETORO, "bad_response", status);
    }
    if (status < 200 || status >= 300) {
      const code = errorBodySchema.safeParse(body);
      if (code.success && code.data.code === "UNSUPPORTED_DISPLAY_CURRENCY") {
        throw new SourceError(ETORO, "unsupported_currency", status);
      }
      throw new SourceError(ETORO, "bad_response", status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new SourceError(ETORO, "schema_mismatch", status);
    return parsed.data;
  }

  me(): Promise<EtoroMe> {
    return this.#get("/api/v1/me", {}, meSchema);
  }

  /** Always with zero balances (E7): an empty account and an account with no account look alike otherwise. */
  balances(currency: string): Promise<EtoroBalances> {
    return this.#get(
      "/api/v1/balances",
      { displayCurrency: currency, includeZeroBalances: "true" },
      balancesSchema,
    );
  }

  /** The portfolio with each position's unrealized P/L: the same `clientPortfolio` as `/portfolio`. */
  portfolio(): Promise<EtoroPortfolio> {
    return this.#get("/api/v1/trading/info/real/pnl", {}, portfolioSchema);
  }

  async instruments(ids: readonly number[]): Promise<EtoroInstrument[]> {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    const found: EtoroInstrument[] = [];
    for (let start = 0; start < unique.length; start += INSTRUMENT_BATCH) {
      const batch = unique.slice(start, start + INSTRUMENT_BATCH);
      const page = await this.#get(
        "/api/v1/market-data/instruments",
        { instrumentIds: batch.join(",") },
        instrumentsSchema,
      );
      found.push(...page.instrumentDisplayDatas);
    }
    return found;
  }

  /** Every closed trade since `minDate`, page by page until a short or empty page (E4). */
  async trades(minDate: string): Promise<EtoroTrade[]> {
    const all: EtoroTrade[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await this.#get(
        "/api/v1/trading/info/trade/history",
        { minDate, page: String(page), pageSize: String(PAGE_SIZE) },
        tradesSchema,
      );
      all.push(...rows);
      if (rows.length < PAGE_SIZE) return all;
    }
    throw new SourceError(ETORO, "bad_response");
  }

  /** The movements of eToro Money (E5), every page of the cursor. */
  async cashTransactions(accountId: string): Promise<EtoroCashTransaction[]> {
    if (!PATH_ID.test(accountId)) throw new SourceError(ETORO, "bad_response");
    const all: EtoroCashTransaction[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = { pageSize: String(PAGE_SIZE) };
      if (token !== null) query.pageToken = token;
      const result: z.infer<typeof cashPageSchema> = await this.#get(
        `/api/v1/money/accounts/cash/${encodeURIComponent(accountId)}/transactions`,
        query,
        cashPageSchema,
      );
      all.push(...result.results);
      if (!result.pagination.hasNext || !result.pagination.nextPageToken) return all;
      token = result.pagination.nextPageToken;
    }
    throw new SourceError(ETORO, "bad_response");
  }

  /** The daily totals since `fromDate`: at most 365 days and inside the 12 months of retention (D11). */
  history(currency: string, fromDate: string): Promise<EtoroHistory> {
    return this.#get("/api/v1/balances/history", { displayCurrency: currency, fromDate }, historySchema);
  }
}
