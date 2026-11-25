/**
 * Trek's leave planner, over MCP (spec §9.2): moved here from the core in R5c, domain-free.
 *
 * ── What Trek stores ────────────────────────────────────────────────────────────────────────────
 * One row per calendar day (`vacay_entries`, unique per user + plan + date). A row carries a
 * `fraction` of exactly 1 or 0.5 and a `kind` of `vacation` or `comp`. There are no ranges and no
 * hours, so which half of a half day is not representable upstream.
 *
 * ── The credential ──────────────────────────────────────────────────────────────────────────────
 * A **machine client** of the person's own Trek (Settings → Integrations → MCP → OAuth 2.1 Clients,
 * "Machine client (no browser login)"): a `client_id` and a `trekcs_…` secret, exchanged at
 * `POST {baseUrl}/oauth/token` for a one-hour access token with `grant_type=client_credentials` —
 * the grant for jobs, with nobody at a keyboard. The token "acts as its owner", narrowed to the
 * scopes chosen there; there is no refresh token to rotate.
 *
 * ── The transport ───────────────────────────────────────────────────────────────────────────────
 * JSON-RPC 2.0 to `POST {baseUrl}/mcp` with that bearer token: the session is opened with
 * `initialize` plus a `notifications/initialized` notification and every later call carries its
 * `Mcp-Session-Id`; responses arrive as SSE; a tool's payload is double-encoded (`mcp.ts`).
 *
 * ── The hazard ──────────────────────────────────────────────────────────────────────────────────
 * `toggle_vacay_entry` is a toggle (`plan.ts`): a blind retry of a toggle whose outcome was not
 * observed silently deletes the day. So reads are retried, writes never; the one exception is a
 * refused token or session, which MCP decides *before* the tool is dispatched — that re-opens once.
 *
 * Two upstream traps avoided by never calling them: the company-holiday tool deletes every user's
 * entries on a date, and `get_vacay_stats` persists carry-over, so it is asked once per pass.
 * `targetUserId` is never sent: naming another user would write to somebody else's calendar.
 */
import { z } from "zod";
import {
  errorText,
  httpError,
  isPreDispatchRefusal,
  isScopeRefusal,
  isWeekendRefusal,
  tokenError,
  transportError,
  TrekError,
} from "./errors";
import {
  entryListSchema,
  parseMcpStream,
  parseOrThrow,
  readToolPayload,
  rpcResult,
  statsPayloadSchema,
  toggleSchema,
  unwrapPayload,
} from "./mcp";
import { expectedAction, type ToggleAction, type TogglePlanStep, type TrekEntry } from "./plan";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "ledgerly", version: "1" } as const;
/** The only content type an MCP endpoint is guaranteed to answer on. */
const MCP_ACCEPT = "application/json, text/event-stream";
/** The scopes a leave sync needs, and no others; the read one alone is what a read-only client has. */
const SCOPES = "vacay:read vacay:write";
const READ_SCOPE = "vacay:read";
const WRITE_SCOPE = "vacay:write";

const READ_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;
const JITTER_FRACTION = 0.25;
const DEFAULT_TIMEOUT_MS = 20_000;
/** A token is renewed a minute early, so a pass that starts on the edge of the hour does not fail. */
const TOKEN_EARLY_MS = 60_000;

/** What `POST /oauth/token` answers with (RFC 6749 §4.4.3: an access token and no refresh one). */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
/** `GET /oauth/userinfo`: who the token acts as. `sub` is the user id, as a string. */
const userInfoSchema = z.object({ sub: z.string().min(1) });

/** The machine client as the person saved it. The secret never leaves this module's arguments. */
export interface TrekConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface TrekClientOptions {
  /** Injected in tests so no call ever leaves the process. */
  fetch?: typeof globalThis.fetch;
  /** Injected in tests so the backoff is not actually waited through. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Injected in tests for a deterministic backoff; returns [0,1). */
  jitter?: () => number;
  timeoutMs?: number;
  attempts?: number;
  /** Injected in tests so a token's expiry can be reached without waiting an hour. */
  now?: () => number;
}

type ToggleOutcome =
  | "applied"
  /** Trek refuses to book that date at all. */
  | "weekend_blocked"
  /** The token may read and not write: refused before the tool ran. */
  | "scope_refused"
  /** It did something, but not what the plan expected: the day changed in Trek meanwhile. */
  | "unexpected_action"
  | "failed";

export interface ToggleResult {
  date: string;
  op: TogglePlanStep["op"];
  outcome: ToggleOutcome;
  /** What Trek said it did; `null` when the request never landed. */
  action: ToggleAction | null;
}

interface Exchange {
  status: number;
  raw: string;
  headers: Headers;
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/** 1 s doubling to an 8 s ceiling, plus up to 25 % jitter so retries do not march in step. */
function backoffDelayMs(attempt: number, jitter: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return exponential + Math.floor(jitter * exponential * JITTER_FRACTION);
}

/**
 * The client, with its session and its token. Both live on the instance: a session opened for one
 * person's token must never be presented for another's, and one instance serves one call.
 */
export class TrekClient {
  /** Whether the token may write: what the token endpoint granted, `null` when it did not say. */
  writeAllowed: boolean | null = null;
  private session: { id: string | null } | null = null;
  private nextRpcId = 0;
  private token: { value: string; expiresAt: number } | null = null;
  /** The token's own user; `undefined` before it is asked, `null` when Trek would not say. */
  private ownUser: number | null | undefined;
  private readonly origin: string;
  private readonly options: Required<TrekClientOptions>;

  constructor(
    private readonly config: TrekConfig,
    options: TrekClientOptions = {},
  ) {
    this.origin = config.baseUrl.replace(/\/+$/, "");
    this.options = {
      fetch: options.fetch ?? globalThis.fetch,
      sleep: options.sleep ?? defaultSleep,
      jitter: options.jitter ?? Math.random,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      attempts: options.attempts ?? READ_ATTEMPTS,
      now: options.now ?? Date.now,
    };
  }

  /** Every entry of the token owner Trek holds for a year. Retried: a read cannot cost a day. */
  async getEntries(year: number): Promise<TrekEntry[]> {
    const payload = await this.mcpCall("get_vacay_entries", { year }, true);
    const rows = parseOrThrow(entryListSchema, unwrapPayload(payload, "entries"), "entries");
    const mine = await this.ownUserId();
    const entries = rows.map((row) => ({
      id: row.id,
      userId: row.user_id ?? null,
      date: row.date,
      note: row.note,
      fraction: row.fraction,
      kind: row.kind,
    }));
    // The tool answers for the whole plan, colleagues included, over the viewer's own leave year,
    // which crosses the calendar year for a fiscal or anniversary window: neither belongs here.
    return entries.filter(
      (entry) =>
        (mine === null || entry.userId === null || entry.userId === mine) &&
        entry.date.startsWith(`${year}-`),
    );
  }

  /**
   * Trek's own count of a year. **Persists carry-over as a side effect**, so it is asked once per
   * pass and never in a loop.
   */
  async getStats(year: number): Promise<{ used: number; remaining: number; totalAvailable: number } | null> {
    const unwrapped = unwrapPayload(await this.mcpCall("get_vacay_stats", { year }, true), "stats");
    // An empty year is a legitimate answer, and `[]` fails the single-row branch of the union.
    if (Array.isArray(unwrapped) && unwrapped.length === 0) return null;
    const parsed = parseOrThrow(statsPayloadSchema, unwrapped, "stats");
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (row === undefined) return null;
    return { used: row.used, remaining: row.remaining, totalAvailable: row.total_available };
  }

  /** One toggle, one attempt: see the file header for why it is never retried. */
  async toggleEntry(step: TogglePlanStep): Promise<ToggleResult> {
    const result = (outcome: ToggleOutcome, action: ToggleAction | null = null) => ({
      date: step.date,
      op: step.op,
      outcome,
      action,
    });
    try {
      const args = { date: step.date, fraction: step.fraction, kind: step.kind };
      const body = parseOrThrow(
        toggleSchema,
        await this.mcpCall("toggle_vacay_entry", args, false),
        "toggle",
      );
      // A different action says the plan was read from a year that has since moved: reported,
      // never "fixed" with a second toggle, which would compound the divergence.
      return result(body.action === expectedAction(step.op) ? "applied" : "unexpected_action", body.action);
    } catch (error) {
      if (isWeekendRefusal(error)) return result("weekend_blocked");
      if (isScopeRefusal(error)) return result("scope_refused");
      console.error(`[plugin] a toggle failed: ${errorText(error).slice(0, 200)}`);
      return result("failed");
    }
  }

  /** One request, bounded in time; a transport failure is retryable, an answer is returned as it is. */
  private async send(url: string, init: { headers: Record<string, string>; body?: string }, what: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.options.fetch(url, {
        method: init.body === undefined ? "GET" : "POST",
        ...init,
        // A redirect would leave the egress proxy for the plugins' network (SEC-05).
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await response.text().catch(() => "");
      return { status: response.status, raw, headers: response.headers } satisfies Exchange;
    } catch (error) {
      throw transportError(controller.signal.aborted, what, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private grant(scope: string): Promise<Exchange> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope,
      // Names the resource the token is for, so Trek stamps the right audience on it.
      resource: `${this.origin}/mcp`,
    });
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    return this.send(`${this.origin}/oauth/token`, { headers, body: body.toString() }, "the token request");
  }

  /**
   * The bearer token for the next request, asked for when there is none or it is about to expire.
   * A client refused the write scope (`invalid_scope`) asks again for the read one alone: such a
   * client reads, and the core keeps what it cannot send pending.
   */
  private async accessToken(): Promise<string> {
    if (this.token !== null && this.token.expiresAt > this.options.now()) return this.token.value;
    let answer = await this.grant(SCOPES);
    const readOnly = answer.status === 400 && answer.raw.includes("invalid_scope");
    if (readOnly) answer = await this.grant(READ_SCOPE);
    if (answer.status < 200 || answer.status > 299) throw tokenError(answer.status, answer.raw);
    let payload: unknown;
    try {
      payload = JSON.parse(answer.raw);
    } catch {
      throw new TrekError("payload", "Trek's token endpoint did not answer with JSON");
    }
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success)
      throw new TrekError("payload", "Trek's token endpoint answered in an unexpected shape");
    // RFC 6749 §5.1: a token granted with the scope asked for may leave `scope` out — then Trek
    // has not said, and only a refused write will tell.
    const granted = parsed.data.scope?.split(/\s+/);
    this.writeAllowed = readOnly ? false : granted === undefined ? null : granted.includes(WRITE_SCOPE);
    const lifetime = Math.max(0, parsed.data.expires_in * 1000 - TOKEN_EARLY_MS);
    this.token = { value: parsed.data.access_token, expiresAt: this.options.now() + lifetime };
    return this.token.value;
  }

  /**
   * Who the token acts as, asked once and kept. `null` when Trek will not say: the reads then keep
   * every entry, because a filter that cannot tell whose day it is must not decide none are yours.
   */
  private async ownUserId(): Promise<number | null> {
    if (this.ownUser !== undefined) return this.ownUser;
    this.ownUser = null;
    try {
      const headers = { authorization: `Bearer ${await this.accessToken()}`, accept: "application/json" };
      const answer = await this.send(`${this.origin}/oauth/userinfo`, { headers }, "the user");
      const parsed = answer.status === 200 ? userInfoSchema.safeParse(JSON.parse(answer.raw)) : null;
      const id = parsed?.success ? Number(parsed.data.sub) : Number.NaN;
      if (Number.isFinite(id)) this.ownUser = id;
    } catch {
      // Not known: every entry is kept.
    }
    return this.ownUser;
  }

  private async postRpc(payload: Record<string, unknown>, sessionId: string | null) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.accessToken()}`,
      "content-type": "application/json",
      accept: MCP_ACCEPT,
    };
    if (sessionId !== null) headers["mcp-session-id"] = sessionId;
    const answer = await this.send(`${this.origin}/mcp`, { headers, body: JSON.stringify(payload) }, "MCP");
    if (answer.status < 200 || answer.status > 299) throw httpError(answer.status, answer.raw);
    return {
      messages: parseMcpStream(answer.raw),
      sessionId: answer.headers.get("mcp-session-id"),
      raw: answer.raw,
    };
  }

  /** `initialize`, keep the session id, then `notifications/initialized`. Retried like a read. */
  private async openSession(): Promise<{ id: string | null }> {
    const id = (this.nextRpcId += 1);
    const params = { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO };
    const exchange = await this.withRetry(() =>
      this.postRpc({ jsonrpc: "2.0", id, method: "initialize", params }, null),
    );
    rpcResult(exchange.messages, exchange.raw, id, "initialize");
    const opened = { id: exchange.sessionId };
    // A notification carries no id and expects no response (Trek answers 202).
    await this.postRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, opened.id);
    this.session = opened;
    return opened;
  }

  private async withRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const retryable = error instanceof TrekError && error.retryable;
        if (!retryable || attempt >= this.options.attempts) throw error;
        await this.options.sleep(backoffDelayMs(attempt, this.options.jitter()));
      }
    }
  }

  private async callTool(open: { id: string | null }, tool: string, args: Record<string, unknown>) {
    const id = (this.nextRpcId += 1);
    const exchange = await this.postRpc(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } },
      open.id,
    );
    return readToolPayload(rpcResult(exchange.messages, exchange.raw, id, `tools/call ${tool}`), tool);
  }

  /**
   * One tool call, re-opening the session at most **once** when the token or the session is
   * refused: both are decided before dispatch, so for a toggle the tool still reaches the server
   * at most once. A read is retried (`retry`), a write never.
   */
  private async mcpCall(tool: string, args: Record<string, unknown>, retry: boolean): Promise<unknown> {
    const wrap = (run: () => Promise<unknown>) => (retry ? this.withRetry(run) : run());
    const open = this.session ?? (await this.openSession());
    try {
      return await wrap(() => this.callTool(open, tool, args));
    } catch (error) {
      if (!isPreDispatchRefusal(error)) throw error;
      // The cached token is dropped and asked for again: the grant reads nothing and writes no
      // calendar. A refused machine client is `client_rejected`, never retried here.
      this.token = null;
      this.session = null;
      const fresh = await this.openSession();
      return wrap(() => this.callTool(fresh, tool, args));
    }
  }
}
