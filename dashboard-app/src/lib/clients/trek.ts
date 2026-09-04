/**
 * Trek's "Vacay" leave planner — https://trek.longobardo.me
 *
 * Trek stores ONE ROW PER CALENDAR DAY (`vacay_entries`, UNIQUE per user+plan+
 * date). There are no ranges: a week of leave is seven rows. A row carries a
 * `fraction` that is exactly 1 (full day) or 0.5 (half day) and a `kind` of
 * `vacation` or `comp` (recuperi). There is no hours field and no start/end
 * time, so *which* half of a half day is simply not representable upstream —
 * see `LeaveFraction` below.
 *
 * ── TRANSPORT: MCP, NOT REST ─────────────────────────────────────────────────
 * Everything here speaks JSON-RPC 2.0 to `POST {baseUrl}/mcp`, authenticated
 * with a STATIC `trek_…` token that comes from the caller's `TrekCallOptions.
 * config` — the connection's own credential, opened from the integration
 * vault, not a file this module reads itself. The REST vacay API accepts only
 * a session JWT minted from an email+password, which this app deliberately no
 * longer holds. Trek 4.1.1's `toggle_vacay_entry` tool finally accepts
 * `fraction` and `kind`, which is what made the swap possible — earlier builds
 * hardcoded `fraction: 1` and so could not express a half day.
 *
 * Three transport facts the code below is shaped around, all verified live:
 *   - the session must be opened with `initialize` + a `notifications/initialized`
 *     notification, and every later call carries the `Mcp-Session-Id` the
 *     initialize response returned in its HTTP headers;
 *   - responses come back as SSE — `data: {json}` lines — never as a plain JSON
 *     body, so they are parsed line-wise;
 *   - a tool's payload is DOUBLE-encoded: `result.content[0].text` is itself a
 *     JSON string that has to be parsed again.
 *
 * ── THE HAZARD ───────────────────────────────────────────────────────────────
 * `toggle_vacay_entry` is a TOGGLE, not an idempotent PUT — the MCP tool has
 * exactly the same destructive semantics the REST endpoint had:
 *
 *   no entry for that date                        → INSERT  ("added")
 *   entry exists, different fraction *or* kind    → UPDATE   ("updated")
 *   entry exists, identical fraction *and* kind   → DELETE   ("removed")
 *
 * A blind retry of a toggle whose outcome was not observed therefore silently
 * DELETES the day. Everything below is built around that single fact:
 *
 *   - every write goes through `applyDesiredState()`, which READS the year
 *     first, DIFFS, and only toggles where the two actually differ;
 *   - `planToggles()` is pure and exhaustively tested, because it is the piece
 *     that decides whether a request happens at all;
 *   - `withRetry` wraps READS only. A write is never retried on a timeout or a
 *     5xx, because those are exactly the cases where the outcome is unknown.
 *     The one exception is a 401 (or a rejected session id), which the MCP
 *     transport raises *before* the tool is dispatched, so no write can have
 *     happened — that one is safe to repeat after re-initialising, and is
 *     bounded to a single extra attempt.
 *
 * Two more upstream traps, avoided here by never calling them:
 *   - the company-holiday tool deletes EVERY user's entries on a date.
 *   - `get_vacay_stats` persists carry-over as a side effect, so it is not a
 *     pure read; `getStats()` exists but is called deliberately, never in a loop.
 *
 * `targetUserId` is deliberately never sent on a toggle: the token's own user is
 * the right one, and naming another would write to someone else's calendar.
 */

import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";
import type { LeaveFraction, LeaveKind } from "@/lib/calc/leave-day";
import { UpstreamError } from "@/lib/contracts";
import type { TrekConfig } from "@/lib/env";
import {
  HttpError,
  httpRequest,
  withRetry,
  type SleepFn,
  type UpstreamService,
} from "./http";

const TREK: UpstreamService = "trek";

/**
 * Re-exported from the dependency-free module so server code has a single
 * import, while client components take them from `@/lib/calc/leave-day` and
 * keep this module — and its `node:` imports — out of the browser bundle.
 */
export {
  isWeekendBlocked,
  type LeaveFraction,
  type LeaveKind,
} from "@/lib/calc/leave-day";

export interface TrekEntry {
  id: number;
  date: string;
  note: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
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

// ── Response contracts ───────────────────────────────────────────────────────

/**
 * Mirrors what the server itself does on write rather than failing loudly: Trek
 * coerces any fraction that is not 0.5 to 1, so a legacy row carrying, say,
 * 0.25 is a 1 as far as Trek is concerned. Rejecting it would stall the whole
 * year's sync over a value upstream has already decided the meaning of.
 */
const fractionSchema = z
  .number()
  .transform((n): LeaveFraction => (n === 0.5 ? 0.5 : 1));

const entrySchema = z.object({
  id: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().nullish().transform((n) => n ?? ""),
  fraction: fractionSchema,
  // Loud on an unknown kind: `vacation` and `comp` land in different buckets of
  // Trek's own stats, so guessing would corrupt the used/remaining figures.
  kind: z.enum(["vacation", "comp"]),
});

const entryListSchema = z.array(entrySchema);

const statsRowSchema = z.object({
  year: z.number().int(),
  person_name: z.string().nullish().transform((n) => n ?? ""),
  vacation_days: z.number(),
  carried_over: z.number(),
  total_available: z.number(),
  used: z.number(),
  remaining: z.number(),
  comp_used: z.number(),
  window_start: z.string(),
  window_end: z.string(),
});

/**
 * The stats tool has been seen returning both a single row and a list of them,
 * so both are accepted and normalised to a list. `getStats()` only ever reports
 * the first row — this client speaks for one person.
 */
const statsPayloadSchema = z.union([z.array(statsRowSchema), statsRowSchema]);

/** What the tool reports it actually did. */
const toggleSchema = z.object({
  action: z.enum(["added", "updated", "removed"]),
  fraction: fractionSchema.nullish(),
  kind: z.enum(["vacation", "comp"]).nullish(),
});

export type ToggleAction = z.infer<typeof toggleSchema>["action"];

// ── Pure: the toggle plan ────────────────────────────────────────────────────

export interface DesiredDay {
  date: string;
  fraction: LeaveFraction;
  kind: LeaveKind;
}

export type ToggleOp = "insert" | "update" | "delete";

export interface TogglePlanStep {
  date: string;
  op: ToggleOp;
  /**
   * Exactly what goes in the tool arguments. For a delete this is the entry's
   * CURRENT fraction and kind — toggling with identical values is the only way
   * Trek removes a day, since it exposes no delete tool.
   */
  fraction: LeaveFraction;
  kind: LeaveKind;
  /** What the entry looks like upstream right now; `null` when there is none. */
  from: { fraction: LeaveFraction; kind: LeaveKind } | null;
}

export interface TogglePlan {
  steps: TogglePlanStep[];
  /** Desired days Trek already agrees with. Toggling these would DELETE them. */
  unchanged: string[];
  /** Removals for days Trek no longer has. Toggling these would RE-CREATE them. */
  alreadyAbsent: string[];
}

/** The `action` the server must report back if the plan was right. */
export function expectedAction(op: ToggleOp): ToggleAction {
  if (op === "insert") return "added";
  if (op === "update") return "updated";
  return "removed";
}

/**
 * Reduces "what I want" to the minimum set of toggles, given what Trek has.
 *
 * This is the safety-critical function in the client, and the reason it is pure:
 * the two no-op cases (`unchanged`, `alreadyAbsent`) are precisely the ones
 * where firing a request does the OPPOSITE of what was asked, so they are
 * decided by a tested function rather than by control flow around a fetch.
 *
 * `removals` is an explicit list rather than "anything missing from `desired`",
 * because callers only ever own a subset of the year — inferring deletions from
 * absence would delete every day the caller simply did not mention.
 */
export function planToggles(
  current: readonly TrekEntry[],
  desired: readonly DesiredDay[],
  removals: readonly string[] = [],
): TogglePlan {
  const byDate = new Map<string, TrekEntry>();
  for (const e of current) byDate.set(e.date, e);

  const steps: TogglePlanStep[] = [];
  const unchanged: string[] = [];
  const alreadyAbsent: string[] = [];

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
    steps.push({
      ...want,
      op: "update",
      from: { fraction: has.fraction, kind: has.kind },
    });
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
      // Identical values on purpose — that is what makes Trek delete the row.
      fraction: has.fraction,
      kind: has.kind,
      from: { fraction: has.fraction, kind: has.kind },
    });
  }

  return { steps, unchanged, alreadyAbsent };
}

/**
 * Trek refuses a weekend; a domain outcome, not a failure.
 *
 * Over MCP the refusal arrives as a *successful* HTTP response carrying an error
 * tool result, which `readToolPayload()` converts into the same
 * `HttpError(400, …)` the REST 400 used to produce — so this predicate, and
 * every caller of it, is unchanged.
 */
export function isWeekendBlockedError(err: unknown): boolean {
  if (!(err instanceof HttpError) || err.status !== 400) return false;
  return JSON.stringify(err.detail ?? "").toLowerCase().includes("weekend");
}

// ── MCP transport ────────────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "personal-dashboard", version: "1" };
/** The only content type an MCP endpoint is guaranteed to answer on. */
const MCP_ACCEPT = "application/json, text/event-stream";

export interface TrekCallOptions {
  /** The credential, resolved by the caller from the integration vault. */
  config: TrekConfig;
  /** Injectable so tests don't sit through the backoff. */
  sleep?: SleepFn;
  jitter?: () => number;
  attempts?: number;
  signal?: AbortSignal;
}

interface McpSession {
  /** `null` when the server runs sessionless; the header is then simply omitted. */
  id: string | null;
  /** Cache is per credential: a rotated token must not reuse the old session. */
  fingerprint: string;
}

let session: McpSession | null = null;

/**
 * Test seam, and the rotation hook — the module-level session would otherwise
 * leak between cases. Named for the JWT era it was born in; there is no JWT any
 * more, but downstream code and tests call it and its job is the same: forget
 * whatever the client is holding on the server's behalf.
 */
export function resetTrekAuthCache(): void {
  session = null;
}

let nextRpcId = 0;

function rpcId(): number {
  nextRpcId += 1;
  return nextRpcId;
}

/**
 * Identifies the credential without keeping it in memory in the clear.
 *
 * Hashed rather than, say, length-tagged: a rotated token of the same length has
 * to invalidate the cached session, or the client would keep presenting a
 * session opened for the old secret.
 */
function fingerprintOf(cfg: TrekConfig): string {
  return createHash("sha256").update(`${cfg.baseUrl} ${cfg.token}`).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Every MCP response is an SSE stream, so the JSON-RPC messages live on the
 * `data:` lines. A plain JSON body is still accepted, because that is what a
 * spec-compliant server is allowed to answer with and it costs one branch.
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
      // A comment or keep-alive frame is not worth failing a request over.
    }
  }
  if (messages.length === 0 && text.trim() !== "") {
    try {
      const record = asRecord(JSON.parse(text) as unknown);
      if (record !== null) messages.push(record);
    } catch {
      // Not JSON either — the caller reports "no response" with the raw text.
    }
  }
  return messages;
}

interface RpcExchange {
  messages: Record<string, unknown>[];
  sessionId: string | null;
  raw: string;
}

async function postRpc(
  cfg: TrekConfig,
  opts: TrekCallOptions,
  payload: Record<string, unknown>,
  sessionId: string | null,
): Promise<RpcExchange> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.token}`,
    "content-type": "application/json",
    accept: MCP_ACCEPT,
  };
  if (sessionId !== null) headers["mcp-session-id"] = sessionId;

  const res = await httpRequest(TREK, `${cfg.baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const raw = await res.text().catch(() => "");
  return {
    messages: parseMcpStream(raw),
    sessionId: res.headers.get("mcp-session-id"),
    raw,
  };
}

/**
 * Picks the response to `id` out of the stream and unwraps it.
 *
 * A JSON-RPC `error` becomes an `HttpError` rather than a bare `Error` so the
 * existing retry and weekend-detection logic keeps working on it unchanged; it
 * is marked non-retryable because a protocol-level refusal will not change on a
 * second identical request.
 */
function rpcResult(exchange: RpcExchange, id: number, what: string): unknown {
  const message =
    exchange.messages.find((m) => m.id === id) ??
    exchange.messages.find((m) => m.result !== undefined || m.error !== undefined);

  if (message === undefined) {
    throw new UpstreamError(
      TREK,
      `Trek's MCP endpoint returned no JSON-RPC response to ${what}`,
      exchange.raw.slice(0, 4000),
      false,
    );
  }

  const error = asRecord(message.error);
  if (error !== null) {
    const detail = typeof error.message === "string" ? error.message : JSON.stringify(error);
    throw new HttpError(TREK, `Trek's MCP endpoint refused ${what}: ${detail}`, 400, error, false);
  }

  return message.result;
}

function describe(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload ?? null).slice(0, 500);
}

/**
 * A tool result carries its payload as a JSON string inside `content[0].text`,
 * so it is decoded twice. An error result — `isError`, or a payload whose only
 * content is an `error` — is raised as `HttpError(400)`, which is exactly the
 * shape the REST client produced and therefore what `isWeekendBlockedError()`
 * and `toggleOnce()` already know how to read.
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
    throw new HttpError(
      TREK,
      `Trek's ${tool} tool reported an error: ${describe(carriesError ? inner?.error : payload)}`,
      400,
      payload,
      false,
    );
  }

  return payload;
}

/** 401/403: the token itself was refused, before anything was dispatched. */
function isAuthRejection(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 401 || err.status === 403);
}

/**
 * The session id was refused — 404 is what the MCP spec prescribes for an
 * expired session, and a 400 mentioning one covers servers that answer in-band.
 * Like a 401 this is decided before the tool runs, so no write can have landed.
 */
function isSessionRejection(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  if (err.status === 404) return true;
  if (err.status === 400) {
    return JSON.stringify(err.detail ?? "").toLowerCase().includes("session");
  }
  return false;
}

function translateAuth(err: unknown): unknown {
  if (!isAuthRejection(err)) return err;
  const status = err instanceof HttpError ? err.status : null;
  return new UpstreamError(
    TREK,
    `Trek rejected the MCP token (HTTP ${status}). TREK_TOKEN_FILE must hold a ` +
      `static trek_… token minted in Trek's UI (Settings → MCP tokens) or via ` +
      `POST /api/auth/mcp-tokens, carrying the vacay scope group with write access`,
    err instanceof HttpError ? err.detail : null,
    false,
  );
}

function retryPolicy(opts: TrekCallOptions) {
  return {
    attempts: opts.attempts ?? 3,
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.jitter ? { jitter: opts.jitter } : {}),
  };
}

/**
 * Opens a session: `initialize`, capture `Mcp-Session-Id`, then the mandatory
 * `notifications/initialized`. Retried like a read — it has no side effects on
 * the calendar, so repeating it can never cost a day.
 */
async function initializeSession(cfg: TrekConfig, opts: TrekCallOptions): Promise<McpSession> {
  const id = rpcId();
  const exchange = await withRetry(
    () =>
      postRpc(
        cfg,
        opts,
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
    retryPolicy(opts),
  ).catch((err: unknown) => {
    throw translateAuth(err);
  });

  rpcResult(exchange, id, "initialize");

  const opened: McpSession = { id: exchange.sessionId, fingerprint: fingerprintOf(cfg) };

  // A notification carries no id and expects no response (Trek answers 202).
  await postRpc(cfg, opts, { jsonrpc: "2.0", method: "notifications/initialized" }, opened.id).catch(
    (err: unknown) => {
      throw translateAuth(err);
    },
  );

  session = opened;
  return opened;
}

async function ensureSession(cfg: TrekConfig, opts: TrekCallOptions): Promise<McpSession> {
  const fingerprint = fingerprintOf(cfg);
  if (session !== null && session.fingerprint === fingerprint) return session;
  return initializeSession(cfg, opts);
}

async function callTool(
  cfg: TrekConfig,
  opts: TrekCallOptions,
  open: McpSession,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const id = rpcId();
  const exchange = await postRpc(
    cfg,
    opts,
    { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } },
    open.id,
  );
  return readToolPayload(rpcResult(exchange, id, `tools/call ${tool}`), tool);
}

/**
 * One tool call, re-initialising at most ONCE when the credential or the session
 * is refused.
 *
 * `wrap` is where the read/write asymmetry lives: reads pass `withRetry`, writes
 * pass a plain call. The single-re-init bound matters twice over — it stops a
 * permanently-rejected token from becoming a handshake loop, and for a toggle it
 * keeps the number of times the tool can reach the server at exactly one per
 * attempt, since both 401 and a rejected session are decided before dispatch.
 */
async function mcpCall(
  cfg: TrekConfig,
  opts: TrekCallOptions,
  tool: string,
  args: Record<string, unknown>,
  wrap: (fn: () => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
  const open = await ensureSession(cfg, opts);
  try {
    return await wrap(() => callTool(cfg, opts, open, tool, args));
  } catch (err) {
    if (!isAuthRejection(err) && !isSessionRejection(err)) throw err;
    session = null;
    const fresh = await initializeSession(cfg, opts);
    try {
      return await wrap(() => callTool(cfg, opts, fresh, tool, args));
    } catch (retryErr) {
      throw translateAuth(retryErr);
    }
  }
}

/**
 * Trek nests a tool's payload under a key that has been seen at more than one
 * depth (`{entries:{entries:[…]}}` for the entries tool), so the wrapper is
 * peeled rather than assumed. Bounded, and it stops at the first array or at
 * anything that no longer carries the key.
 */
function unwrapPayload(value: unknown, key: string): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(current)) return current;
    const record = asRecord(current);
    if (record === null || !(key in record)) return current;
    current = record[key];
  }
  return current;
}

function parseOrThrow<T>(schema: ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError(
      TREK,
      `unexpected ${what} payload shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      raw,
      false,
    );
  }
  return parsed.data;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getEntries(
  year: number,
  opts: TrekCallOptions,
): Promise<TrekEntry[]> {
  const cfg = opts.config;
  const payload = await mcpCall(cfg, opts, "get_vacay_entries", { year }, (fn) =>
    withRetry(fn, retryPolicy(opts)),
  );
  return parseOrThrow(entryListSchema, unwrapPayload(payload, "entries"), "entries");
}

/**
 * Allowance / used / remaining, straight from Trek.
 *
 * Preferred over recomputing locally because Trek already honours the
 * configured leave-year window (calendar / fiscal / anniversary) and carry-over,
 * neither of which this app models.
 *
 * WARNING: this tool PERSISTS carry-over as a side effect. It is not a pure
 * read — call it once per sync, never inside a loop.
 */
export async function getStats(
  year: number,
  opts: TrekCallOptions,
): Promise<TrekYearStats | null> {
  const cfg = opts.config;
  const payload = await mcpCall(cfg, opts, "get_vacay_stats", { year }, (fn) =>
    withRetry(fn, retryPolicy(opts)),
  );

  const unwrapped = unwrapPayload(payload, "stats");
  // An empty year is a legitimate answer, and `[]` fails the single-row branch
  // of the union with a confusing message — short-circuit it here instead.
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
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type ToggleOutcome = "applied" | "weekend_blocked" | "unexpected_action" | "failed";

export interface ToggleResult {
  date: string;
  op: ToggleOp;
  outcome: ToggleOutcome;
  /** What the server said it did; `null` when the request never landed. */
  action: ToggleAction | null;
  error?: string;
}

export interface ApplyDesiredStateInput {
  year: number;
  desired: readonly DesiredDay[];
  /** Explicit — days to remove. Never inferred from absence in `desired`. */
  removals?: readonly string[];
}

export interface ApplyDesiredStateResult {
  results: ToggleResult[];
  unchanged: string[];
  alreadyAbsent: string[];
  /** The year as Trek reported it BEFORE the writes; the diff's input. */
  before: TrekEntry[];
}

/**
 * One toggle. Deliberately NOT wrapped in `withRetry`: see the header. A
 * timeout or a 5xx here leaves the outcome unknown, and the only safe response
 * to an unknown outcome is to stop and let the next read-diff-toggle pass sort
 * it out, never to repeat the request.
 */
async function toggleOnce(
  cfg: TrekConfig,
  opts: TrekCallOptions,
  step: TogglePlanStep,
): Promise<ToggleResult> {
  try {
    const payload = await mcpCall(
      cfg,
      opts,
      "toggle_vacay_entry",
      // No `targetUserId`: the token's own user is the right one, and naming
      // another would write to someone else's calendar.
      { date: step.date, fraction: step.fraction, kind: step.kind },
      (fn) => fn(),
    );
    const body = parseOrThrow(toggleSchema, payload, "toggle");

    const wanted = expectedAction(step.op);
    if (body.action !== wanted) {
      // The plan was computed from a read that has since gone stale — someone
      // edited the same day in Trek in between. Reported, never "fixed" with a
      // second toggle, which would compound the divergence.
      return {
        date: step.date,
        op: step.op,
        outcome: "unexpected_action",
        action: body.action,
        error: `expected the server to report "${wanted}" but it reported "${body.action}"; the day changed in Trek since this plan was read`,
      };
    }
    return { date: step.date, op: step.op, outcome: "applied", action: body.action };
  } catch (err) {
    if (isWeekendBlockedError(err)) {
      return { date: step.date, op: step.op, outcome: "weekend_blocked", action: null };
    }
    return {
      date: step.date,
      op: step.op,
      outcome: "failed",
      action: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The ONLY sanctioned write path: read the year, diff, toggle the differences.
 *
 * Steps run one at a time rather than in parallel — they share a single upstream
 * row per date, and a serial loop keeps the reported results in a defensible
 * order when one of them fails.
 */
export async function applyDesiredState(
  input: ApplyDesiredStateInput,
  opts: TrekCallOptions,
): Promise<ApplyDesiredStateResult> {
  const cfg = opts.config;
  const before = await getEntries(input.year, opts);
  const plan = planToggles(before, input.desired, input.removals ?? []);

  const results: ToggleResult[] = [];
  for (const step of plan.steps) {
    results.push(await toggleOnce(cfg, opts, step));
  }

  return {
    results,
    unchanged: plan.unchanged,
    alreadyAbsent: plan.alreadyAbsent,
    before,
  };
}
