/**
 * Trek client tests.
 *
 * ⚠ EVERY case here runs against a mocked `fetch`. Nothing in this suite has
 * ever touched the live server — and it must not. A stray toggle would silently
 * corrupt the owner's real leave calendar, which is exactly what the
 * delete-on-identical semantics make so easy to do by accident.
 *
 * The transport below reproduces what was verified by hand against Trek 4.1.1's
 * MCP endpoint:
 *   POST /mcp  `initialize`      → SSE, plus an `Mcp-Session-Id` HTTP header
 *   POST /mcp  `notifications/initialized`
 *   POST /mcp  `tools/call`      → SSE; `result.content[0].text` is a JSON
 *                                  STRING that has to be parsed a second time
 *
 * And the payloads inside that text:
 *   get_vacay_entries {year} → {"entries":{"entries":[…],"companyHolidays":[]}}
 *                              ← note the double nesting; verified live
 *   get_vacay_stats   {year} → a stats object/list with the snake_case fields
 *   toggle_vacay_entry {date,fraction,kind} → {"action":"added"|"updated"|"removed"}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpstreamError } from "@/lib/contracts";
import {
  applyDesiredState,
  expectedAction,
  getEntries,
  getStats,
  isWeekendBlocked,
  isWeekendBlockedError,
  planToggles,
  resetTrekAuthCache,
  trekConfigured,
  type DesiredDay,
  type TrekEntry,
} from "./trek";

const tokenFile = join(mkdtempSync(join(tmpdir(), "trek-token-")), "token");
writeFileSync(tokenFile, "trek_live_abcdef\n");

process.env.DATABASE_URL = "postgres://dashboard@localhost/dashboard";
process.env.AUTH_URL = "https://dash.example.test";
process.env.AUTH_SECRET = "a".repeat(40);
process.env.OIDC_ISSUER = "https://auth.example.test/application/o/dashboard/";
process.env.OIDC_CLIENT_ID = "client";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.AUTHORIZED_SUB = "sub-123";
process.env.TEABLE_URL = "https://teable.example.test";
process.env.TEABLE_TOKEN = "teable-token";
process.env.PAPERLESS_URL = "https://paperless.example.test";
process.env.PAPERLESS_TOKEN = "paperless-token";
process.env.CRON_SECRET = "c".repeat(20);
process.env.WEBHOOK_SECRET = "w".repeat(20);
process.env.WALLET_TOKEN_FILE = "/nonexistent-wallet-token";
process.env.TREK_URL = "https://trek.example.test";
process.env.TREK_TOKEN_FILE = tokenFile;

const SESSION_ID = "sess-1234";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

// ── The wire format ──────────────────────────────────────────────────────────

/** Everything Trek's MCP endpoint answers with is an SSE frame, never plain JSON. */
function sse(message: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

/** A tool result: the payload is a JSON string nested inside `content[0].text`. */
function toolResult(id: unknown, payload: unknown, isError = false): Response {
  return sse({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      ...(isError ? { isError: true } : {}),
    },
  });
}

function jsonError(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Rpc {
  method: string;
  id: unknown;
  tool: string | null;
  args: Record<string, unknown>;
  headers: Record<string, string>;
}

function rpcOf(call: unknown[]): Rpc {
  const init = call[1] as RequestInit;
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  const params = (body.params ?? {}) as Record<string, unknown>;
  return {
    method: String(body.method),
    id: body.id,
    tool: typeof params.name === "string" ? params.name : null,
    args: (params.arguments ?? {}) as Record<string, unknown>,
    headers: (init.headers ?? {}) as Record<string, string>,
  };
}

function rpcs(): Rpc[] {
  return fetchMock.mock.calls.map((c) => rpcOf(c as unknown[]));
}

function callsTo(method: string, tool?: string): Rpc[] {
  return rpcs().filter((r) => r.method === method && (tool === undefined || r.tool === tool));
}

/**
 * Answers the handshake, and delegates every `tools/call` to `handler`, which
 * returns either a ready Response or the payload to wrap in a tool result.
 */
type ToolHandler = (tool: string, args: Record<string, unknown>, id: unknown) => unknown;

function serve(handler: ToolHandler) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (body.method === "initialize") {
      return sse(
        {
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "trek" } },
        },
        { "mcp-session-id": SESSION_ID },
      );
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });

    const params = (body.params ?? {}) as Record<string, unknown>;
    const out = handler(
      String(params.name),
      (params.arguments ?? {}) as Record<string, unknown>,
      body.id,
    );
    return out instanceof Response ? out : toolResult(body.id, out);
  });
}

/** The live 2026 shape, trimmed to the fields the client contracts on. */
function liveEntry(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    plan_id: 1,
    user_id: 1,
    date: "2026-07-06",
    note: "",
    fraction: 0.5,
    kind: "vacation",
    person_name: "mattia",
    person_color: "#6366f1",
    ...over,
  };
}

/** The verified double nesting: `parsed.entries.entries` is the array. */
function entriesPayload(entries: unknown[]) {
  return { entries: { entries, companyHolidays: [] } };
}

const LIVE_STATS = {
  user_id: 1,
  person_name: "mattia",
  year: 2026,
  vacation_days: 33,
  carried_over: 0,
  total_available: 33,
  used: 26,
  remaining: 7,
  comp_used: 0,
  window_start: "2026-01-01",
  window_end: "2027-01-01",
};

beforeEach(() => {
  fetchMock.mockReset();
  resetTrekAuthCache();
  writeFileSync(tokenFile, "trek_live_abcdef\n");
});

// ── The pure toggle plan: the safety-critical piece ──────────────────────────

describe("planToggles", () => {
  const entry = (date: string, fraction: 1 | 0.5, kind: "vacation" | "comp"): TrekEntry => ({
    id: 1,
    date,
    note: "",
    fraction,
    kind,
  });
  const want = (date: string, fraction: 1 | 0.5, kind: "vacation" | "comp"): DesiredDay => ({
    date,
    fraction,
    kind,
  });

  it("inserts a day Trek does not have", () => {
    const plan = planToggles([], [want("2026-03-02", 1, "vacation")]);
    expect(plan.steps).toEqual([
      { date: "2026-03-02", op: "insert", fraction: 1, kind: "vacation", from: null },
    ]);
  });

  it("issues NO request when Trek already agrees — a toggle would delete it", () => {
    const current = [entry("2026-03-02", 1, "vacation")];
    const plan = planToggles(current, [want("2026-03-02", 1, "vacation")]);
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toEqual(["2026-03-02"]);
  });

  it("updates in place when only the fraction differs (full → half)", () => {
    const current = [entry("2026-03-02", 1, "vacation")];
    const plan = planToggles(current, [want("2026-03-02", 0.5, "vacation")]);
    expect(plan.steps).toEqual([
      {
        date: "2026-03-02",
        op: "update",
        fraction: 0.5,
        kind: "vacation",
        from: { fraction: 1, kind: "vacation" },
      },
    ]);
  });

  it("updates in place when only the kind differs (vacation → comp)", () => {
    const current = [entry("2026-03-02", 1, "vacation")];
    const plan = planToggles(current, [want("2026-03-02", 1, "comp")]);
    expect(plan.steps[0]?.op).toBe("update");
    expect(plan.steps[0]?.kind).toBe("comp");
  });

  it("deletes by echoing the entry's CURRENT fraction and kind, not the desired one", () => {
    const current = [entry("2026-03-02", 0.5, "comp")];
    const plan = planToggles(current, [], ["2026-03-02"]);
    expect(plan.steps).toEqual([
      {
        date: "2026-03-02",
        op: "delete",
        fraction: 0.5,
        kind: "comp",
        from: { fraction: 0.5, kind: "comp" },
      },
    ]);
  });

  it("issues NO request for a removal Trek has already lost — it would re-create it", () => {
    const plan = planToggles([], [], ["2026-03-02"]);
    expect(plan.steps).toEqual([]);
    expect(plan.alreadyAbsent).toEqual(["2026-03-02"]);
  });

  it("never infers a deletion from a day merely absent from `desired`", () => {
    const current = [entry("2026-03-02", 1, "vacation"), entry("2026-03-03", 1, "vacation")];
    const plan = planToggles(current, [want("2026-03-02", 1, "vacation")]);
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toEqual(["2026-03-02"]);
  });

  it("handles a mixed batch: insert, update, unchanged, delete, already-absent", () => {
    const current = [
      entry("2026-03-02", 1, "vacation"), // unchanged
      entry("2026-03-03", 1, "vacation"), // → half
      entry("2026-03-05", 1, "comp"), // → deleted
    ];
    const plan = planToggles(
      current,
      [
        want("2026-03-02", 1, "vacation"),
        want("2026-03-03", 0.5, "vacation"),
        want("2026-03-04", 0.5, "comp"),
      ],
      ["2026-03-05", "2026-03-09"],
    );
    expect(plan.steps.map((s) => [s.date, s.op])).toEqual([
      ["2026-03-03", "update"],
      ["2026-03-04", "insert"],
      ["2026-03-05", "delete"],
    ]);
    expect(plan.unchanged).toEqual(["2026-03-02"]);
    expect(plan.alreadyAbsent).toEqual(["2026-03-09"]);
  });

  it("maps each op to the action the server must report", () => {
    expect(expectedAction("insert")).toBe("added");
    expect(expectedAction("update")).toBe("updated");
    expect(expectedAction("delete")).toBe("removed");
  });
});

// ── Weekends ─────────────────────────────────────────────────────────────────

describe("isWeekendBlocked", () => {
  it("blocks Saturday and Sunday, computed in UTC like Trek does", () => {
    expect(isWeekendBlocked("2026-03-07")).toBe(true); // Saturday
    expect(isWeekendBlocked("2026-03-08")).toBe(true); // Sunday
    expect(isWeekendBlocked("2026-03-06")).toBe(false); // Friday
    expect(isWeekendBlocked("2026-03-09")).toBe(false); // Monday
  });
});

// ── The MCP handshake ────────────────────────────────────────────────────────

describe("the MCP session", () => {
  it("initializes once, notifies, and reuses the session across calls", async () => {
    serve(() => entriesPayload([liveEntry()]));

    await getEntries(2026);
    await getEntries(2026);

    expect(callsTo("initialize")).toHaveLength(1);
    expect(callsTo("notifications/initialized")).toHaveLength(1);
    expect(callsTo("tools/call", "get_vacay_entries")).toHaveLength(2);

    // The notification is exactly that — no id, so no response is expected.
    expect(callsTo("notifications/initialized")[0]?.id).toBeUndefined();
    // Every request after the handshake carries the captured session id.
    for (const call of rpcs().slice(1)) {
      expect(call.headers["mcp-session-id"]).toBe(SESSION_ID);
    }
  });

  it("presents the static token as a bearer on every request", async () => {
    serve(() => entriesPayload([]));
    await getEntries(2026);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of rpcs()) {
      expect(call.headers.authorization).toBe("Bearer trek_live_abcdef");
      expect(call.headers.accept).toContain("text/event-stream");
    }
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toBe("https://trek.example.test/mcp");
    }
  });

  it("re-initializes once on a 401, then succeeds", async () => {
    let toolCalls = 0;
    serve((_tool, _args, id) => {
      toolCalls += 1;
      if (toolCalls === 1) return jsonError({ error: "invalid token" }, 401);
      return toolResult(id, entriesPayload([liveEntry()]));
    });

    const entries = await getEntries(2026);

    expect(entries).toHaveLength(1);
    expect(callsTo("initialize")).toHaveLength(2);
    expect(callsTo("tools/call")).toHaveLength(2);
  });

  it("gives up after a second 401 rather than looping", async () => {
    serve(() => jsonError({ error: "invalid token" }, 401));

    const err = (await getEntries(2026).catch((e: unknown) => e)) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("MCP token");
    // One original attempt plus exactly one after re-initializing.
    expect(callsTo("tools/call")).toHaveLength(2);
    expect(callsTo("initialize")).toHaveLength(2);
  });

  it("explains the MCP token when the credential is refused outright", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "www-authenticate": "Bearer", "content-type": "application/json" },
      }),
    );

    const err = (await getEntries(2026, { sleep: async () => {} }).catch(
      (e: unknown) => e,
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("vacay scope group");
    // The handshake itself was refused, so no tool was ever called.
    expect(callsTo("tools/call")).toHaveLength(0);
  });

  it("re-initializes when the session id is rejected", async () => {
    let toolCalls = 0;
    serve((_tool, _args, id) => {
      toolCalls += 1;
      if (toolCalls === 1) return jsonError({ error: "session not found" }, 404);
      return toolResult(id, entriesPayload([]));
    });

    await getEntries(2026);

    expect(callsTo("initialize")).toHaveLength(2);
    expect(callsTo("tools/call")).toHaveLength(2);
  });

  it("reads the token file per call, so a rotated secret takes effect", async () => {
    serve(() => entriesPayload([]));
    await getEntries(2026);
    writeFileSync(tokenFile, "trek_rotated_999\n");
    await getEntries(2026);

    // The session is keyed to the credential, so rotating forces a new handshake.
    expect(callsTo("initialize")).toHaveLength(2);
    const last = rpcs().at(-1);
    expect(last?.headers.authorization).toBe("Bearer trek_rotated_999");
  });
});

// ── Degrading when unconfigured ──────────────────────────────────────────────

describe("when no credential is configured", () => {
  it("reports itself off and never reaches the network", async () => {
    writeFileSync(tokenFile, "");
    expect(trekConfigured()).toBe(false);
    await expect(getEntries(2026)).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────

describe("getEntries", () => {
  it("parses the double-nested live shape and keeps 0.5 a half day", async () => {
    serve(() => entriesPayload([liveEntry()]));

    const entries = await getEntries(2026);

    expect(entries).toEqual([
      { id: 7, date: "2026-07-06", note: "", fraction: 0.5, kind: "vacation" },
    ]);
    const read = callsTo("tools/call", "get_vacay_entries")[0];
    expect(read?.args).toEqual({ year: 2026 });
  });

  it("coerces any fraction that is not 0.5 to a full day, as Trek's server does", async () => {
    serve(() => entriesPayload([liveEntry({ fraction: 0.25 })]));
    const entries = await getEntries(2026);
    expect(entries[0]?.fraction).toBe(1);
  });

  it("sums the live 2026 data to 26 days over 27 entries", async () => {
    const entries = [
      ...Array.from({ length: 25 }, (_, i) => liveEntry({ id: i + 1, fraction: 1 })),
      liveEntry({ id: 26, fraction: 0.5 }),
      liveEntry({ id: 27, fraction: 0.5 }),
    ];
    serve(() => entriesPayload(entries));

    const parsed = await getEntries(2026);
    expect(parsed).toHaveLength(27);
    expect(parsed.reduce((sum, e) => sum + e.fraction, 0)).toBe(26);
  });

  it("fails loudly on an unknown kind rather than guessing a stats bucket", async () => {
    serve(() => entriesPayload([liveEntry({ kind: "sabbatical" })]));
    const err = (await getEntries(2026).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.retryable).toBe(false);
  });

  it("still reads a singly-nested payload, should Trek ever stop wrapping twice", async () => {
    serve(() => ({ entries: [liveEntry()] }));
    expect(await getEntries(2026)).toHaveLength(1);
  });
});

describe("getStats", () => {
  it("maps the live shape to camelCase", async () => {
    serve(() => ({ stats: [LIVE_STATS] }));

    const stats = await getStats(2026);

    expect(stats).toEqual({
      year: 2026,
      personName: "mattia",
      vacationDays: 33,
      carriedOver: 0,
      totalAvailable: 33,
      used: 26,
      remaining: 7,
      compUsed: 0,
      windowStart: "2026-01-01",
      windowEnd: "2027-01-01",
    });
    expect(callsTo("tools/call", "get_vacay_stats")[0]?.args).toEqual({ year: 2026 });
  });

  it("reads the same row through the entries tool's double nesting", async () => {
    serve(() => ({ stats: { stats: [LIVE_STATS] } }));
    expect((await getStats(2026))?.used).toBe(26);
  });

  it("reads a bare single row too, since the nesting is not pinned upstream", async () => {
    serve(() => ({ stats: LIVE_STATS }));
    expect((await getStats(2026))?.remaining).toBe(7);
  });

  it("returns null rather than throwing when Trek reports no rows", async () => {
    serve(() => ({ stats: [] }));
    expect(await getStats(2026)).toBeNull();
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

describe("applyDesiredState", () => {
  /** Serves a fixed year, and the given answer to every toggle. */
  function serveYear(entries: unknown[], toggle: ToolHandler) {
    serve((tool, args, id) => {
      if (tool === "get_vacay_entries") return entriesPayload(entries);
      if (tool === "toggle_vacay_entry") return toggle(tool, args, id);
      throw new Error(`unexpected tool ${tool}`);
    });
  }

  it("reads first and toggles only the days that actually differ", async () => {
    serveYear([liveEntry({ id: 1, date: "2026-03-02", fraction: 1 })], () => ({
      action: "added",
      fraction: 1,
      kind: "vacation",
    }));

    const result = await applyDesiredState({
      year: 2026,
      desired: [
        { date: "2026-03-02", fraction: 1, kind: "vacation" }, // already agrees
        { date: "2026-03-03", fraction: 1, kind: "vacation" }, // new
      ],
    });

    const toggles = callsTo("tools/call", "toggle_vacay_entry");
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.args).toEqual({
      date: "2026-03-03",
      fraction: 1,
      kind: "vacation",
    });
    // Never `targetUserId`: the token's own user is the only correct one.
    expect(toggles[0]?.args).not.toHaveProperty("targetUserId");
    expect(result.unchanged).toEqual(["2026-03-02"]);
    expect(result.results).toEqual([
      { date: "2026-03-03", op: "insert", outcome: "applied", action: "added" },
    ]);
  });

  it("does not touch Trek at all when the desired state already holds", async () => {
    serveYear([liveEntry({ date: "2026-03-02", fraction: 0.5, kind: "comp" })], () => {
      throw new Error("must not toggle");
    });

    const result = await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-02", fraction: 0.5, kind: "comp" }],
    });

    expect(callsTo("tools/call", "toggle_vacay_entry")).toHaveLength(0);
    expect(result.results).toEqual([]);
  });

  it("updates a half day in place, which only 4.1.1's tool can express", async () => {
    serveYear([liveEntry({ date: "2026-03-02", fraction: 1, kind: "vacation" })], () => ({
      action: "updated",
      fraction: 0.5,
      kind: "vacation",
    }));

    const result = await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-02", fraction: 0.5, kind: "vacation" }],
    });

    expect(callsTo("tools/call", "toggle_vacay_entry")[0]?.args).toEqual({
      date: "2026-03-02",
      fraction: 0.5,
      kind: "vacation",
    });
    expect(result.results[0]).toEqual({
      date: "2026-03-02",
      op: "update",
      outcome: "applied",
      action: "updated",
    });
  });

  it("removes a day by echoing its current values back", async () => {
    serveYear([liveEntry({ date: "2026-03-02", fraction: 0.5, kind: "comp" })], () => ({
      action: "removed",
    }));

    const result = await applyDesiredState({
      year: 2026,
      desired: [],
      removals: ["2026-03-02"],
    });

    expect(callsTo("tools/call", "toggle_vacay_entry")[0]?.args).toEqual({
      date: "2026-03-02",
      fraction: 0.5,
      kind: "comp",
    });
    expect(result.results[0]?.outcome).toBe("applied");
    expect(result.results[0]?.action).toBe("removed");
  });

  it("treats a blocked weekend as a domain outcome, not a failure", async () => {
    serveYear([], (_tool, _args, id) =>
      toolResult(id, { error: "Weekend days are blocked on this plan" }, true),
    );

    const result = await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-07", fraction: 1, kind: "vacation" }],
    });

    expect(result.results).toEqual([
      { date: "2026-03-07", op: "insert", outcome: "weekend_blocked", action: null },
    ]);
  });

  it("recognises the weekend refusal even without the isError flag", async () => {
    // Trek has been seen reporting the refusal both ways: as a flagged error
    // result, and as a plain result whose text is `{"error":…}`.
    serveYear([], () => ({ error: "Weekend days are blocked on this plan" }));

    const result = await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-08", fraction: 1, kind: "vacation" }],
    });

    expect(result.results[0]?.outcome).toBe("weekend_blocked");
  });

  it("reports a mismatch instead of toggling again when the day changed under it", async () => {
    // Planned an insert, but the server says it updated — someone else got
    // there first. A second toggle here would delete the day.
    serveYear([], () => ({ action: "updated" }));

    const result = await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-03", fraction: 1, kind: "vacation" }],
    });

    expect(result.results[0]?.outcome).toBe("unexpected_action");
    expect(callsTo("tools/call", "toggle_vacay_entry")).toHaveLength(1);
  });

  it("NEVER repeats a toggle whose outcome is unknown", async () => {
    serveYear([], () => jsonError({ error: "boom" }, 500));

    const result = await applyDesiredState(
      { year: 2026, desired: [{ date: "2026-03-03", fraction: 1, kind: "vacation" }] },
      { sleep: async () => {} },
    );

    // A 500 is retryable in general, but a retried toggle can silently DELETE.
    expect(callsTo("tools/call", "toggle_vacay_entry")).toHaveLength(1);
    expect(result.results[0]?.outcome).toBe("failed");
  });

  it("keeps going after one day fails, and reports each day's outcome", async () => {
    let n = 0;
    serveYear([], () => {
      n += 1;
      return n === 1 ? jsonError({ error: "boom" }, 500) : { action: "added" };
    });

    const result = await applyDesiredState(
      {
        year: 2026,
        desired: [
          { date: "2026-03-03", fraction: 1, kind: "vacation" },
          { date: "2026-03-04", fraction: 0.5, kind: "vacation" },
        ],
      },
      { sleep: async () => {} },
    );

    expect(result.results.map((r) => r.outcome)).toEqual(["failed", "applied"]);
  });

  it("only ever calls the two vacay tools it is allowed to", async () => {
    serveYear([], () => ({ action: "added" }));
    await applyDesiredState({
      year: 2026,
      desired: [{ date: "2026-03-03", fraction: 1, kind: "vacation" }],
    });
    // Never the company-holiday tool, which wipes every user's day.
    const tools = callsTo("tools/call").map((r) => r.tool);
    expect(new Set(tools)).toEqual(new Set(["get_vacay_entries", "toggle_vacay_entry"]));
  });
});

describe("isWeekendBlockedError", () => {
  it("ignores anything that is not Trek's weekend refusal", () => {
    expect(isWeekendBlockedError(new Error("weekend"))).toBe(false);
  });
});
