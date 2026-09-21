/**
 * Trek's leave planner, over MCP (spec §9.2). Written from the live behaviour the previous client
 * documented (plan F7 §0.5), not copied from it.
 *
 * ── What Trek stores ────────────────────────────────────────────────────────────────────────────
 * One row per calendar day (`vacay_entries`, unique per user + plan + date). There are no ranges:
 * a week off is seven rows. A row carries a `fraction` of exactly 1 or 0.5 and a `kind` of
 * `vacation` or `comp`. There is no hours field and no start time, so *which* half of a half day
 * is simply not representable upstream — the note keeps that, locally (plan F7 §3.6.5).
 *
 * ── The credential ──────────────────────────────────────────────────────────────────────────────
 * Trek's MCP is an OAuth 2.1 protected resource: the static `trek_…` token is deprecated and its
 * own instance already refuses it. What is stored here is a **machine client** (Trek → Settings →
 * Integrations → MCP → OAuth 2.1 Clients, "Machine client (no browser login)"): a `client_id` and
 * a `trekcs_…` secret, exchanged at `POST {baseUrl}/oauth/token` for a one-hour access token with
 * `grant_type=client_credentials`.
 *
 * That grant and not the browser one, because this app syncs from an hourly job: there is nobody
 * at a keyboard to approve a consent screen at 07 past the hour. Trek's own documentation calls
 * this the option for agents and scripts, and the token it issues "acts as its owner" — the user
 * who created the client — narrowed to the scopes chosen there. There is no refresh token to
 * rotate, which is one less thing that can go wrong between two concurrent passes.
 *
 * ── The transport ───────────────────────────────────────────────────────────────────────────────
 * JSON-RPC 2.0 to `POST {baseUrl}/mcp` with that bearer token. Three facts shape the code:
 *   - the session is opened with `initialize` plus a `notifications/initialized` notification, and
 *     every later call carries the `Mcp-Session-Id` the initialize response returned in its headers;
 *   - responses arrive as SSE (`data: {json}` lines), not as a plain JSON body;
 *   - a tool's payload is double-encoded: `result.content[0].text` is itself JSON to parse again.
 *
 * ── The hazard, and the whole shape of this file ────────────────────────────────────────────────
 * `toggle_vacay_entry` is a toggle, not an idempotent PUT:
 *
 *     no entry on that date                      → INSERT  ("added")
 *     an entry with a different fraction or kind  → UPDATE  ("updated")
 *     an entry with the same fraction and kind    → DELETE  ("removed")
 *
 * So a blind retry of a toggle whose outcome was not observed silently deletes the day. Hence:
 *   - {@link planToggles} is pure and exhaustively tested, because it is what decides whether a
 *     request is made at all — and its two no-op cases are exactly the ones where making the
 *     request would do the opposite of what was asked;
 *   - reads are retried, writes never. A timeout or a 5xx on a write is precisely the case where
 *     the outcome is unknown, and the only safe answer to an unknown outcome is to stop and let
 *     the next read-diff-toggle pass settle it;
 *   - the one exception is a refused token or session, which MCP decides *before* the tool is
 *     dispatched: no write can have landed, so that one re-initialises — once, and only once.
 *
 * Two upstream traps avoided by never calling them: the company-holiday tool deletes every user's
 * entries on a date (spec §9.2), and `get_vacay_stats` persists carry-over as a side effect, so it
 * is called once per pass and never in a loop.
 *
 * `targetUserId` is never sent: the token's own user is the right one, and naming another would
 * write to somebody else's calendar.
 */
import { z } from "zod";
import type { CivilDate } from "@/platform/dates";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "ledgerly", version: "1" } as const;
/** The only content type an MCP endpoint is guaranteed to answer on. */
const MCP_ACCEPT = "application/json, text/event-stream";

const READ_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;
const JITTER_FRACTION = 0.25;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DETAIL_CHARS = 4_000;

/* What a day looks like on both sides */

/** The only two fractions Trek represents. */
export type TrekFraction = 0.5 | 1;
/** The only two kinds Trek knows (spec §9.2): ROL is never named in a request. */
export type TrekKind = "vacation" | "comp";

export interface TrekEntry {
  id: number;
  /** Whose entry it is, when Trek says; the reads keep only the token owner's. */
  userId: number | null;
  date: CivilDate;
  note: string;
  fraction: TrekFraction;
  kind: TrekKind;
}

export interface TrekYearStats {
  year: number;
  personName: string;
  vacationDays: number;
  carriedOver: number;
  totalAvailable: number;
  used: number;
  remaining: number;
  compUsed: number;
  windowStart: string;
  windowEnd: string;
}

/* Errors */

export type TrekErrorKind =
  /** The bearer token was refused by `/mcp`: expired or revoked, decided before any tool ran. */
  | "token_rejected"
  /** The machine client itself was refused by the token endpoint: no token was ever issued. */
  | "client_rejected"
  /** The session id was refused: likewise decided before any tool ran. */
  | "session_rejected"
  /** The tool answered, and said no — a weekend, say. A domain refusal, not a fault. */
  | "refused"
  | "http"
  | "network"
  | "timeout"
  | "payload";

/** Every failure this client raises. The token never appears in a message or a detail. */
export class TrekError extends Error {
  constructor(
    readonly kind: TrekErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly detail: unknown = null,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "TrekError";
  }
}

/**
 * Whether the credential is the problem, in either of its two senses: the machine client was
 * refused, or the token it minted was. Both mean the connection is `revoked` until somebody saves
 * a new client — neither will come right by waiting.
 */
export function isTokenRejected(error: unknown): boolean {
  return error instanceof TrekError && (error.kind === "token_rejected" || error.kind === "client_rejected");
}

/** Trek refuses a weekend. A domain outcome the caller reports, not a failure it retries. */
export function isWeekendRefusal(error: unknown): boolean {
  if (!(error instanceof TrekError) || error.kind !== "refused") return false;
  return JSON.stringify(error.detail ?? error.message)
    .toLowerCase()
    .includes("weekend");
}

/* The pure part: the toggle plan */

export interface DesiredDay {
  date: CivilDate;
  fraction: TrekFraction;
  kind: TrekKind;
}

export type ToggleOp = "insert" | "update" | "delete";
export type ToggleAction = "added" | "updated" | "removed";

export interface TogglePlanStep {
  date: CivilDate;
  op: ToggleOp;
  /**
   * Exactly what goes in the tool's arguments. For a delete these are the entry's **current**
   * fraction and kind: toggling with identical values is the only way Trek removes a day, since
   * it exposes no delete tool at all.
   */
  fraction: TrekFraction;
  kind: TrekKind;
  /** What Trek holds for that date right now; `null` when it holds nothing. */
  from: { fraction: TrekFraction; kind: TrekKind } | null;
}

export interface TogglePlan {
  steps: TogglePlanStep[];
  /** Days Trek already agrees with. Toggling these would **delete** them. */
  unchanged: CivilDate[];
  /** Removals for days Trek no longer holds. Toggling these would **recreate** them. */
  alreadyAbsent: CivilDate[];
}

/** What the server must report back if a step's reading of the world was right. */
export function expectedAction(op: ToggleOp): ToggleAction {
  if (op === "insert") return "added";
  if (op === "update") return "updated";
  return "removed";
}

/**
 * Reduces "what we want" to the fewest toggles, given what Trek holds.
 *
 * The safety-critical function of this module, and the reason it is pure and takes no network:
 * `unchanged` and `alreadyAbsent` are the two cases where firing a request does the opposite of
 * what was asked, so they are decided by a tested function rather than by control flow wrapped
 * around a `fetch`.
 *
 * `removals` is an explicit list and never "whatever is missing from `desired`": a caller owns
 * only part of a year, and inferring deletions from absence would delete every day it simply did
 * not mention (plan F7 §3.6.8).
 */
export function planToggles(
  current: readonly TrekEntry[],
  desired: readonly DesiredDay[],
  removals: readonly CivilDate[] = [],
): TogglePlan {
  const byDate = new Map<CivilDate, TrekEntry>();
  for (const entry of current) byDate.set(entry.date, entry);

  const steps: TogglePlanStep[] = [];
  const unchanged: CivilDate[] = [];
  const alreadyAbsent: CivilDate[] = [];

  for (const want of desired) {
    const has = byDate.get(want.date);
    if (has === undefined) {
      steps.push({ ...want, op: "insert", from: null });
      continue;
    }
    if (has.fraction === want.fraction && has.kind === want.kind) {
      unchanged.push(want.date);
      continue;
    }
    steps.push({ ...want, op: "update", from: { fraction: has.fraction, kind: has.kind } });
  }

  for (const date of removals) {
    const has = byDate.get(date);
    if (has === undefined) {
      alreadyAbsent.push(date);
      continue;
    }
    steps.push({
      date,
      op: "delete",
      // Identical values on purpose: that is what makes Trek remove the row.
      fraction: has.fraction,
      kind: has.kind,
      from: { fraction: has.fraction, kind: has.kind },
    });
  }

  return { steps, unchanged, alreadyAbsent };
}

/* Response contracts */

/**
 * Mirrors what Trek itself does on write rather than failing loudly: it coerces any fraction that
 * is not 0.5 to 1, so a legacy row carrying 0.25 is a 1 as far as Trek is concerned. Refusing it
 * would stall a whole year's pass over a value upstream has already decided the meaning of.
 */
const fractionSchema = z.number().transform((value): TrekFraction => (value === 0.5 ? 0.5 : 1));

const entrySchema = z.object({
  id: z.number().int(),
  // Whose day it is. Trek's `get_vacay_entries` answers for the whole **plan**, not for the
  // caller: on a shared plan it hands back every member's leave, and adopting a colleague's day
  // as your own is the sort of mistake nobody notices until the year is counted.
  user_id: z.number().int().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  fraction: fractionSchema,
  // Loud on an unknown kind: `vacation` and `comp` land in different buckets of Trek's own stats,
  // so guessing would corrupt the used and remaining figures it reports back.
  kind: z.enum(["vacation", "comp"]),
});

const entryListSchema = z.array(entrySchema);

const statsRowSchema = z.object({
  year: z.number().int(),
  person_name: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  vacation_days: z.number(),
  carried_over: z.number(),
  total_available: z.number(),
  used: z.number(),
  remaining: z.number(),
  comp_used: z.number(),
  window_start: z.string(),
  window_end: z.string(),
});

/** The stats tool answers with a row or a list of them; both are accepted and normalised. */
const statsPayloadSchema = z.union([z.array(statsRowSchema), statsRowSchema]);

/** What `POST /oauth/token` answers with (RFC 6749 §4.4.3: an access token and no refresh one). */
/** `GET /oauth/userinfo`: who the token acts as. `sub` is the user id, as a string. */
const userInfoSchema = z.object({ sub: z.string().min(1) });

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

const toggleSchema = z.object({
  action: z.enum(["added", "updated", "removed"]),
  fraction: fractionSchema.nullish(),
  kind: z.enum(["vacation", "comp"]).nullish(),
});

/* The transport */

/** The scopes a leave sync needs, and no others: this client reads and writes days off. */
export const TREK_SCOPES = ["vacay:read", "vacay:write"] as const;

/** The machine client as Settings stores it. The secret never leaves this module's arguments. */
export interface TrekConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * An access token and the moment it stops being one. Trek issues them for an hour; this is
 * refreshed a minute early so a pass that starts just before the edge does not fail on it.
 */
interface AccessToken {
  value: string;
  expiresAt: number;
}

const TOKEN_EARLY_MS = 60_000;

export interface TrekClientOptions {
  /** Injected in tests so no call ever leaves the process. */
  fetch?: typeof globalThis.fetch;
  /** Injected in tests so the backoff is not actually waited through. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests for a deterministic backoff; returns [0,1). */
  jitter?: () => number;
  timeoutMs?: number;
  attempts?: number;
  /** Injected in tests so a token's expiry can be reached without waiting an hour. */
  now?: () => number;
}

export interface TrekClient {
  /** Every entry Trek holds for a year. Retried: a read cannot cost a day. */
  getEntries(year: number): Promise<TrekEntry[]>;
  /**
   * Trek's own allowance, used and remaining.
   *
   * **Persists carry-over as a side effect**, so it is not a pure read: once per pass, never in a
   * loop. Its figures are shown beside ours as a cross-check and never become ours, because they
   * honour a leave-year window (calendar, fiscal or anniversary) this app does not model
   * (plan F7 §3.6.4).
   */
  getStats(year: number): Promise<TrekYearStats | null>;
  /** One toggle, one attempt. See the file header for why it is never retried. */
  toggleEntry(step: TogglePlanStep): Promise<ToggleResult>;
}

export type ToggleOutcome =
  | "applied"
  /** Trek refuses to book that date at all. */
  | "weekend_blocked"
  /** It did something, but not what the plan expected: the day changed in Trek meanwhile. */
  | "unexpected_action"
  | "failed";

export interface ToggleResult {
  date: CivilDate;
  op: ToggleOp;
  outcome: ToggleOutcome;
  /** What Trek said it did; `null` when the request never landed. */
  action: ToggleAction | null;
  error?: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 1 s doubling to an 8 s ceiling, plus up to 25 % jitter so retries do not march in step. */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return exponential + Math.floor(jitter * exponential * JITTER_FRACTION);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Every MCP response is an SSE stream, so the JSON-RPC messages live on the `data:` lines. A plain
 * JSON body is accepted too, because a spec-compliant server is allowed to answer with one and it
 * costs a single branch.
 */
export function parseMcpStream(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const record = asRecord(JSON.parse(payload) as unknown);
      if (record !== null) messages.push(record);
    } catch {
      // A comment or a keep-alive frame is not worth failing a request over.
    }
  }
  if (messages.length === 0 && text.trim() !== "") {
    try {
      const record = asRecord(JSON.parse(text) as unknown);
      if (record !== null) messages.push(record);
    } catch {
      // Not JSON either: the caller reports "no response" and quotes the raw text.
    }
  }
  return messages;
}

/**
 * Trek nests a tool's payload under a key that has been seen at more than one depth
 * (`{entries:{entries:[…]}}`), so the wrapper is peeled rather than assumed. Bounded, and it stops
 * at the first array or at anything that no longer carries the key.
 */
export function unwrapPayload(value: unknown, key: string): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(current)) return current;
    const record = asRecord(current);
    if (record === null || !(key in record)) return current;
    current = record[key];
  }
  return current;
}

function describe(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 500);
  return JSON.stringify(payload ?? null).slice(0, 500);
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new TrekError("payload", `unexpected ${what} payload shape: ${issues}`, null, raw, false);
}

interface McpExchange {
  messages: Record<string, unknown>[];
  sessionId: string | null;
  raw: string;
}

/**
 * The client, with its session. The session lives on the instance and not in a module variable:
 * a job walks every user in turn, and a session opened for one person's token must never be
 * presented for another's.
 */
export function createTrekClient(config: TrekConfig, options: TrekClientOptions = {}): TrekClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? READ_ATTEMPTS;
  const now = options.now ?? Date.now;
  const origin = config.baseUrl.replace(/\/+$/, "");
  const endpoint = `${origin}/mcp`;
  const tokenEndpoint = `${origin}/oauth/token`;

  /** `null` before the handshake, and `{ id: null }` for a server that runs sessionless. */
  let session: { id: string | null } | null = null;
  let nextRpcId = 0;
  /** The access token in hand, or `null` before the first grant and after one is refused. */
  let token: AccessToken | null = null;
  /** The token's own user, once asked for; `undefined` before, `null` when Trek would not say. */
  let ownUser: number | null | undefined;

  /**
   * Who the token acts as, asked once and kept. `null` when Trek will not say: the reads then
   * keep every entry rather than silently dropping the lot, because a filter that cannot tell
   * whose day it is must not decide that none of them are yours.
   */
  async function ownUserId(): Promise<number | null> {
    if (ownUser !== undefined) return ownUser;
    try {
      const bearer = await accessToken();
      const response = await doFetch(`${origin}/oauth/userinfo`, {
        headers: { authorization: `Bearer ${bearer}`, accept: "application/json" },
      });
      if (!response.ok) {
        ownUser = null;
        return ownUser;
      }
      const parsed = userInfoSchema.safeParse(JSON.parse(await response.text()));
      const id = parsed.success ? Number(parsed.data.sub) : Number.NaN;
      ownUser = Number.isFinite(id) ? id : null;
    } catch {
      ownUser = null;
    }
    return ownUser;
  }

  /**
   * The bearer token for the next request, fetched when there is none or the one in hand is about
   * to expire. Trek issues no refresh token for this grant, so "refreshing" is simply asking again
   * with the same client credentials — which is safe to repeat, unlike anything that touches a
   * calendar.
   */
  async function accessToken(): Promise<string> {
    if (token !== null && token.expiresAt > now()) return token.value;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: TREK_SCOPES.join(" "),
      // Names the resource the token is for, so Trek stamps the right audience on it rather than
      // falling back to its own guess at its MCP URL.
      resource: endpoint,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new TrekError(
        aborted ? "timeout" : "network",
        aborted
          ? "Trek did not answer the token request in time"
          : `Trek could not be reached for a token: ${errorText(error)}`,
        null,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    if (!response.ok) throw tokenError(response.status, raw);

    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new TrekError(
        "payload",
        "Trek's token endpoint did not answer with JSON",
        null,
        raw.slice(0, 200),
        false,
      );
    }
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new TrekError(
        "payload",
        "Trek's token endpoint answered in an unexpected shape",
        null,
        null,
        false,
      );
    }
    // A minute early, so a pass that starts on the edge of the hour does not fail halfway through.
    const lifetime = Math.max(0, parsed.data.expires_in * 1000 - TOKEN_EARLY_MS);
    token = { value: parsed.data.access_token, expiresAt: now() + lifetime };
    return token.value;
  }

  async function postRpc(payload: Record<string, unknown>, sessionId: string | null): Promise<McpExchange> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
      accept: MCP_ACCEPT,
    };
    if (sessionId !== null) headers["mcp-session-id"] = sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new TrekError(
        aborted ? "timeout" : "network",
        aborted ? "Trek did not answer in time" : `Trek could not be reached: ${errorText(error)}`,
        null,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw httpError(response.status, raw);
    }
    return { messages: parseMcpStream(raw), sessionId: response.headers.get("mcp-session-id"), raw };
  }

  /** Picks the response to `id` out of the stream and unwraps it. */
  function rpcResult(exchange: McpExchange, id: number, what: string): unknown {
    const message =
      exchange.messages.find((one) => one.id === id) ??
      exchange.messages.find((one) => one.result !== undefined || one.error !== undefined);

    if (message === undefined) {
      throw new TrekError(
        "payload",
        `Trek's MCP endpoint returned no JSON-RPC response to ${what}`,
        null,
        exchange.raw.slice(0, MAX_DETAIL_CHARS),
        false,
      );
    }

    const error = asRecord(message.error);
    if (error !== null) {
      const detail = typeof error.message === "string" ? error.message : JSON.stringify(error);
      // A protocol-level refusal will not change on an identical second request.
      throw new TrekError("refused", `Trek refused ${what}: ${detail}`, null, error, false);
    }
    return message.result;
  }

  /**
   * A tool result carries its payload as a JSON string inside `content[0].text`, so it is decoded
   * twice. An error result — `isError`, or a payload whose content is an `error` — is raised as a
   * `refused`, which is what the weekend check reads.
   */
  function readToolPayload(result: unknown, tool: string): unknown {
    const envelope = asRecord(result);
    const content = Array.isArray(envelope?.content) ? envelope.content : [];

    let text: string | null = null;
    for (const part of content) {
      const record = asRecord(part);
      if (typeof record?.text === "string") {
        text = record.text;
        break;
      }
    }

    let payload: unknown;
    if (text !== null) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    } else if (envelope !== null && envelope.structuredContent !== undefined) {
      payload = envelope.structuredContent;
    } else {
      payload = result;
    }

    const inner = asRecord(payload);
    const carriesError =
      inner !== null && inner.error !== undefined && inner.error !== null && inner.error !== false;
    if (envelope?.isError === true || carriesError) {
      throw new TrekError(
        "refused",
        `Trek's ${tool} tool reported an error: ${describe(carriesError ? inner?.error : payload)}`,
        null,
        carriesError ? inner?.error : payload,
        false,
      );
    }
    return payload;
  }

  /**
   * Opens a session: `initialize`, keep the `Mcp-Session-Id`, then the mandatory
   * `notifications/initialized`. Retried like a read — it touches no calendar, so repeating it can
   * never cost a day.
   */
  async function openSession(): Promise<{ id: string | null }> {
    const id = (nextRpcId += 1);
    const exchange = await withRetry(() =>
      postRpc(
        {
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          },
        },
        null,
      ),
    );
    rpcResult(exchange, id, "initialize");

    const opened = { id: exchange.sessionId };
    // A notification carries no id and expects no response (Trek answers 202).
    await postRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, opened.id);
    session = opened;
    return opened;
  }

  async function withRetry<T>(run: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        last = error;
        const retryable = error instanceof TrekError && error.retryable;
        if (!retryable || attempt === attempts) break;
        await sleep(backoffDelayMs(attempt, jitter()));
      }
    }
    throw last;
  }

  async function callTool(
    open: { id: string | null },
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const id = (nextRpcId += 1);
    const exchange = await postRpc(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } },
      open.id,
    );
    return readToolPayload(rpcResult(exchange, id, `tools/call ${tool}`), tool);
  }

  /**
   * One tool call, re-opening the session at most **once** when the token or the session is
   * refused.
   *
   * `wrap` is where the read/write asymmetry lives: a read passes `withRetry`, a write passes a
   * bare call. The single re-open matters twice over — it stops a permanently rejected token
   * becoming a handshake loop, and for a toggle it keeps the number of times the tool can reach
   * the server at exactly one, since both refusals are decided before dispatch.
   */
  async function mcpCall(
    tool: string,
    args: Record<string, unknown>,
    wrap: (run: () => Promise<unknown>) => Promise<unknown>,
  ): Promise<unknown> {
    const open = session ?? (await openSession());
    try {
      return await wrap(() => callTool(open, tool, args));
    } catch (error) {
      if (!isPreDispatchRefusal(error)) throw error;
      // A 401 on `/mcp` says the bearer token is no longer good — expired, or revoked in Trek —
      // so the cached one is dropped and the next call asks for a fresh one. The grant itself is
      // safe to repeat: it reads nothing and writes no calendar. A refusal of the *machine client*
      // is `client_rejected`, which is not a pre-dispatch refusal and so is never retried here:
      // asking the same rejected secret again would only be a second way to be told no.
      token = null;
      session = null;
      const fresh = await openSession();
      return wrap(() => callTool(fresh, tool, args));
    }
  }

  return {
    async getEntries(year: number): Promise<TrekEntry[]> {
      const payload = await mcpCall("get_vacay_entries", { year }, (run) => withRetry(run));
      const rows = parseOrThrow(entryListSchema, unwrapPayload(payload, "entries"), "entries");
      const mine = await ownUserId();

      return rows
        .map((row) => ({
          id: row.id,
          userId: row.user_id ?? null,
          date: row.date,
          note: row.note,
          fraction: row.fraction,
          kind: row.kind,
        }))
        .filter((entry) => {
          // Two things Trek's own answer makes necessary, and neither is paranoia — both come
          // straight from `vacay.service.ts`:
          //
          //  - the tool answers for the whole **plan**, so on a plan with colleagues it hands back
          //    their leave beside yours. Keeping a day that is not yours would book it against
          //    your allowance, and the diff would then try to "put back" days you never had;
          //  - the range it answers over is the viewer's own leave **year**, month-aligned, which
          //    is only January to January for somebody on a calendar year. A fiscal or
          //    anniversary window hands back dates from the year either side of the one asked
          //    for, and those belong to that year's pass, not this one.
          if (mine !== null && entry.userId !== null && entry.userId !== mine) return false;
          return entry.date.startsWith(`${year}-`);
        });
    },

    async getStats(year: number): Promise<TrekYearStats | null> {
      const payload = await mcpCall("get_vacay_stats", { year }, (run) => withRetry(run));
      const unwrapped = unwrapPayload(payload, "stats");
      // An empty year is a legitimate answer, and `[]` fails the single-row branch of the union
      // with a confusing message; short-circuit it rather than explain it.
      if (Array.isArray(unwrapped) && unwrapped.length === 0) return null;

      const parsed = parseOrThrow(statsPayloadSchema, unwrapped, "stats");
      const row = Array.isArray(parsed) ? parsed[0] : parsed;
      if (row === undefined) return null;
      return {
        year: row.year,
        personName: row.person_name,
        vacationDays: row.vacation_days,
        carriedOver: row.carried_over,
        totalAvailable: row.total_available,
        used: row.used,
        remaining: row.remaining,
        compUsed: row.comp_used,
        windowStart: row.window_start,
        windowEnd: row.window_end,
      };
    },

    async toggleEntry(step: TogglePlanStep): Promise<ToggleResult> {
      try {
        const payload = await mcpCall(
          "toggle_vacay_entry",
          { date: step.date, fraction: step.fraction, kind: step.kind },
          (run) => run(),
        );
        const body = parseOrThrow(toggleSchema, payload, "toggle");
        const wanted = expectedAction(step.op);
        if (body.action !== wanted) {
          // The plan was computed from a read that has since gone stale: somebody edited the same
          // day in Trek in between. Reported, never "fixed" with a second toggle, which would
          // compound the divergence instead of settling it.
          return {
            date: step.date,
            op: step.op,
            outcome: "unexpected_action",
            action: body.action,
            error: `expected Trek to report "${wanted}" but it reported "${body.action}"; the day changed in Trek since this plan was read`,
          };
        }
        return { date: step.date, op: step.op, outcome: "applied", action: body.action };
      } catch (error) {
        if (isWeekendRefusal(error)) {
          return { date: step.date, op: step.op, outcome: "weekend_blocked", action: null };
        }
        return {
          date: step.date,
          op: step.op,
          outcome: "failed",
          action: null,
          error: errorText(error),
        };
      }
    },
  };
}

/** 401/403 refuse the token; 404 (and a 400 naming a session) refuse the session id. */
function isPreDispatchRefusal(error: unknown): boolean {
  return error instanceof TrekError && (error.kind === "token_rejected" || error.kind === "session_rejected");
}

/**
 * A refusal from the token endpoint. `invalid_client` and `unauthorized_client` are both facts
 * about the machine client — wrong secret, or one that was never allowed this grant — so both land
 * as `token_rejected` and the connection is marked revoked rather than retried for ever.
 */
function tokenError(status: number, body: string): TrekError {
  const detail = body.slice(0, MAX_DETAIL_CHARS);
  const code = /invalid_client|unauthorized_client|invalid_scope|invalid_grant/.exec(detail)?.[0];
  if (status === 400 || status === 401 || status === 403) {
    return new TrekError(
      "client_rejected",
      `Trek refused the machine client (HTTP ${status}${code ? `, ${code}` : ""}). Check the client ` +
        `id and secret, and that the client is a machine client with the vacay:read and ` +
        `vacay:write scopes (Trek → Settings → Integrations → MCP → OAuth 2.1 Clients)`,
      status,
      detail,
      false,
    );
  }
  return new TrekError(
    "http",
    `Trek's token endpoint answered HTTP ${status}`,
    status,
    detail,
    status === 429 || status >= 500,
  );
}

function httpError(status: number, body: string): TrekError {
  const detail = body.slice(0, MAX_DETAIL_CHARS);
  if (status === 401 || status === 403) {
    return new TrekError(
      "token_rejected",
      `Trek rejected the MCP token (HTTP ${status}). Reconnect Trek with a fresh static trek_… ` +
        `token carrying the vacay scope group with write access (Trek → Settings → MCP tokens)`,
      status,
      detail,
      false,
    );
  }
  // The MCP spec prescribes 404 for an expired session; some servers answer 400 and say so in the
  // body. Both are decided before the tool runs, so no write can have landed.
  if (status === 404 || (status === 400 && detail.toLowerCase().includes("session"))) {
    return new TrekError(
      "session_rejected",
      `Trek refused the MCP session (HTTP ${status})`,
      status,
      detail,
      false,
    );
  }
  return new TrekError(
    "http",
    `Trek answered HTTP ${status}`,
    status,
    detail,
    status === 408 || status === 429 || status >= 500,
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
