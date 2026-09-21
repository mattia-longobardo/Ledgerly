/**
 * The Trek client (plan F7 L3). Two halves, and the first is the important one:
 *
 *  - `planToggles` exhaustively, because it is what decides whether a request happens at all, and
 *    Trek's toggle does the *opposite* of what was asked when it is fired needlessly;
 *  - the transport against a fake MCP server (`fetch` replaced), so the SSE framing, the double
 *    encoding, the session handshake and the read/write retry asymmetry are all checked without a
 *    single real call.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type TogglePlanStep,
  type TrekEntry,
  TrekError,
  createTrekClient,
  expectedAction,
  isTokenRejected,
  isWeekendRefusal,
  parseMcpStream,
  planToggles,
  unwrapPayload,
} from "./client";

const CONFIG = {
  baseUrl: "https://trek.example",
  clientId: "trekci_abc",
  clientSecret: "trekcs_secret_abc",
};

function entry(date: string, fraction: 0.5 | 1, kind: "vacation" | "comp", id = 1): TrekEntry {
  return { id, userId: null, date, note: "", fraction, kind };
}

/* planToggles */

describe("planToggles", () => {
  it("inserts a day Trek does not have", () => {
    const plan = planToggles([], [{ date: "2026-06-16", fraction: 1, kind: "vacation" }]);
    expect(plan.steps).toEqual([
      { date: "2026-06-16", fraction: 1, kind: "vacation", op: "insert", from: null },
    ]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.alreadyAbsent).toEqual([]);
  });

  it("leaves a day Trek already agrees with alone — toggling it would DELETE it", () => {
    const plan = planToggles(
      [entry("2026-06-16", 1, "vacation")],
      [{ date: "2026-06-16", fraction: 1, kind: "vacation" }],
    );
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toEqual(["2026-06-16"]);
  });

  it("updates a day whose fraction differs", () => {
    const plan = planToggles(
      [entry("2026-06-16", 1, "vacation")],
      [{ date: "2026-06-16", fraction: 0.5, kind: "vacation" }],
    );
    expect(plan.steps).toEqual([
      {
        date: "2026-06-16",
        fraction: 0.5,
        kind: "vacation",
        op: "update",
        from: { fraction: 1, kind: "vacation" },
      },
    ]);
  });

  it("updates a day whose kind differs", () => {
    const plan = planToggles(
      [entry("2026-06-16", 1, "comp")],
      [{ date: "2026-06-16", fraction: 1, kind: "vacation" }],
    );
    expect(plan.steps[0]).toMatchObject({ op: "update", kind: "vacation", from: { kind: "comp" } });
  });

  it("deletes with the pair Trek is OBSERVED holding, not the one we wanted", () => {
    // The whole reason `trek_fraction`/`trek_kind` are stored: a delete sent with the desired pair
    // would differ from what Trek holds, and Trek would treat the difference as an update.
    const plan = planToggles([entry("2026-06-16", 0.5, "comp")], [], ["2026-06-16"]);
    expect(plan.steps).toEqual([
      {
        date: "2026-06-16",
        op: "delete",
        fraction: 0.5,
        kind: "comp",
        from: { fraction: 0.5, kind: "comp" },
      },
    ]);
  });

  it("leaves a removal Trek no longer has alone — toggling it would RECREATE it", () => {
    const plan = planToggles([], [], ["2026-06-16"]);
    expect(plan.steps).toEqual([]);
    expect(plan.alreadyAbsent).toEqual(["2026-06-16"]);
  });

  it("never infers a removal from a day simply not mentioned", () => {
    // Trek holds two days; we state one and ask for no removals. The other is left untouched.
    const plan = planToggles(
      [entry("2026-06-16", 1, "vacation", 1), entry("2026-06-17", 1, "vacation", 2)],
      [{ date: "2026-06-16", fraction: 1, kind: "vacation" }],
    );
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toEqual(["2026-06-16"]);
    expect(plan.alreadyAbsent).toEqual([]);
  });

  it("is a no-op when the two agree entirely, however many days there are", () => {
    const days = ["2026-06-16", "2026-06-17", "2026-06-18"];
    const plan = planToggles(
      days.map((date, index) => entry(date, 1, "vacation", index + 1)),
      days.map((date) => ({ date, fraction: 1 as const, kind: "vacation" as const })),
    );
    expect(plan.steps).toEqual([]);
    expect(plan.unchanged).toEqual(days);
  });

  it("handles every combination of the two fractions and the two kinds", () => {
    const fractions = [0.5, 1] as const;
    const kinds = ["vacation", "comp"] as const;
    for (const haveFraction of fractions) {
      for (const haveKind of kinds) {
        for (const wantFraction of fractions) {
          for (const wantKind of kinds) {
            const plan = planToggles(
              [entry("2026-06-16", haveFraction, haveKind)],
              [{ date: "2026-06-16", fraction: wantFraction, kind: wantKind }],
            );
            const same = haveFraction === wantFraction && haveKind === wantKind;
            if (same) {
              expect(plan.steps, `${haveFraction}/${haveKind} → same`).toEqual([]);
              expect(plan.unchanged).toEqual(["2026-06-16"]);
            } else {
              expect(plan.steps, `${haveFraction}/${haveKind} → ${wantFraction}/${wantKind}`).toHaveLength(1);
              expect(plan.steps[0].op).toBe("update");
              // An update always sends what we want, never what is there.
              expect(plan.steps[0].fraction).toBe(wantFraction);
              expect(plan.steps[0].kind).toBe(wantKind);
            }
          }
        }
      }
    }
  });

  it("plans an insert and a delete in one pass without confusing them", () => {
    const plan = planToggles(
      [entry("2026-06-17", 1, "vacation")],
      [{ date: "2026-06-16", fraction: 1, kind: "vacation" }],
      ["2026-06-17"],
    );
    expect(plan.steps.map((step) => [step.date, step.op])).toEqual([
      ["2026-06-16", "insert"],
      ["2026-06-17", "delete"],
    ]);
  });
});

describe("expectedAction", () => {
  it("names what Trek must report for each operation", () => {
    expect(expectedAction("insert")).toBe("added");
    expect(expectedAction("update")).toBe("updated");
    expect(expectedAction("delete")).toBe("removed");
  });
});

/* The SSE framing and the payload peeling */

describe("parseMcpStream", () => {
  it("reads the JSON-RPC messages off the data lines", () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseMcpStream(text)).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
  });

  it("ignores comments, keep-alives and the done marker", () => {
    const text = ': ping\ndata: [DONE]\ndata: \ndata: {"id":2}\n';
    expect(parseMcpStream(text)).toEqual([{ id: 2 }]);
  });

  it("accepts a plain JSON body, which a compliant server may also answer with", () => {
    expect(parseMcpStream('{"id":3,"result":null}')).toEqual([{ id: 3, result: null }]);
  });

  it("returns nothing for a body that is not JSON at all", () => {
    expect(parseMcpStream("<html>gateway timeout</html>")).toEqual([]);
    expect(parseMcpStream("")).toEqual([]);
  });
});

describe("unwrapPayload", () => {
  it("peels the key until it reaches the array", () => {
    expect(unwrapPayload({ entries: { entries: [1, 2] } }, "entries")).toEqual([1, 2]);
    expect(unwrapPayload({ entries: [3] }, "entries")).toEqual([3]);
    expect(unwrapPayload([4], "entries")).toEqual([4]);
  });

  it("stops at something that no longer carries the key", () => {
    expect(unwrapPayload({ other: 1 }, "entries")).toEqual({ other: 1 });
  });
});

/* The fake MCP server */

interface Call {
  method: string;
  tool?: string;
  args?: Record<string, unknown>;
  sessionId: string | null;
  /** The bearer the request carried, so a test can tell one grant's token from the next. */
  bearer: string | null;
}

/** One request to the token endpoint, as the fake recorded it. */
interface TokenCall {
  grantType: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  resource: string;
}

/** A tool's answer, double-encoded the way Trek sends it. */
function toolResult(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function sse(message: unknown): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

interface FakeOptions {
  /** Answers per tool, in order; the last one is reused once the queue runs down. */
  tools?: Record<string, Array<unknown | (() => unknown)>>;
  /** HTTP statuses to answer **tool calls** with, in order, before the tool is consulted. */
  statuses?: Array<{ status: number; body?: string }>;
  /** HTTP statuses to answer the **handshake** with, in order. */
  initStatuses?: Array<{ status: number; body?: string }>;
  /** HTTP statuses to answer the **token endpoint** with, in order. */
  tokenStatuses?: Array<{ status: number; body?: string }>;
  sessionId?: string | null;
  /** How long each issued token lasts, in seconds. */
  expiresIn?: number;
}

/**
 * A Trek that speaks MCP over SSE, records what it was asked, and can be told to fail. Nothing
 * here reaches the network: it is handed to the client as its `fetch`.
 */
function fakeTrek(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const statuses = [...(options.statuses ?? [])];
  const initStatuses = [...(options.initStatuses ?? [])];
  const tokenStatuses = [...(options.tokenStatuses ?? [])];
  const tokenCalls: TokenCall[] = [];
  let issued = 0;
  const tools: Record<string, Array<unknown | (() => unknown)>> = {};
  for (const [name, answers] of Object.entries(options.tools ?? {})) tools[name] = [...answers];
  const sessionId = options.sessionId === undefined ? "session-1" : options.sessionId;

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // The token endpoint speaks form encoding, not JSON-RPC: it is answered before anything else.
    if (String(url).endsWith("/oauth/token")) {
      const form = new URLSearchParams(String(init?.body));
      tokenCalls.push({
        grantType: form.get("grant_type") ?? "",
        clientId: form.get("client_id") ?? "",
        clientSecret: form.get("client_secret") ?? "",
        scope: form.get("scope") ?? "",
        resource: form.get("resource") ?? "",
      });
      const forcedToken = tokenStatuses.shift();
      if (forcedToken) return new Response(forcedToken.body ?? "", { status: forcedToken.status });
      issued += 1;
      return new Response(
        JSON.stringify({
          access_token: `access-${issued}`,
          token_type: "Bearer",
          expires_in: options.expiresIn ?? 3600,
          scope: "vacay:read vacay:write",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    const params = (body.params ?? {}) as Record<string, unknown>;
    calls.push({
      method: String(body.method),
      tool: body.method === "tools/call" ? String(params.name) : undefined,
      args: body.method === "tools/call" ? (params.arguments as Record<string, unknown>) : undefined,
      sessionId: headers.get("mcp-session-id"),
      bearer: headers.get("authorization"),
    });

    if (body.method === "initialize" || body.method === "notifications/initialized") {
      const forcedInit = initStatuses.shift();
      if (forcedInit) return new Response(forcedInit.body ?? "", { status: forcedInit.status });
    } else {
      const forced = statuses.shift();
      if (forced) return new Response(forced.body ?? "", { status: forced.status });
    }

    if (body.method === "initialize") {
      const responseHeaders = new Headers({ "content-type": "text/event-stream" });
      if (sessionId !== null) responseHeaders.set("mcp-session-id", sessionId);
      return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }), {
        status: 200,
        headers: responseHeaders,
      });
    }
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });

    const name = String(params.name);
    const queue = tools[name] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const answer = typeof next === "function" ? (next as () => unknown)() : next;
    return new Response(sse({ jsonrpc: "2.0", id: body.id, result: answer }), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });

  return {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    calls,
    tokenCalls,
    get issued() {
      return issued;
    },
  };
}

function clientFor(fake: ReturnType<typeof fakeTrek>) {
  return createTrekClient(CONFIG, { fetch: fake.fetch, sleep: async () => {}, jitter: () => 0 });
}

describe("the MCP handshake", () => {
  it("initialises once, notifies, and carries the session id on every later call", async () => {
    const fake = fakeTrek({
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    const client = clientFor(fake);
    await client.getEntries(2026);
    await client.getEntries(2026);

    expect(fake.calls.map((call) => call.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    // The handshake happens once; both tool calls carry the id the server handed back.
    expect(fake.calls[2].sessionId).toBe("session-1");
    expect(fake.calls[3].sessionId).toBe("session-1");
  });

  it("works against a server that runs sessionless", async () => {
    const fake = fakeTrek({
      sessionId: null,
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    await clientFor(fake).getEntries(2026);
    expect(fake.calls.at(-1)?.sessionId).toBeNull();
  });

  it("never puts the client secret in a thrown message or detail", async () => {
    const fake = fakeTrek({ initStatuses: [{ status: 401, body: "nope" }] });
    const client = clientFor(fake);
    const error = await client.getEntries(2026).catch((e: unknown) => e);
    expect(isTokenRejected(error)).toBe(true);
    expect(String((error as TrekError).message)).not.toContain(CONFIG.clientSecret);
    expect(JSON.stringify((error as TrekError).detail)).not.toContain(CONFIG.clientSecret);
  });

  it("keeps the secret out of a refusal from the token endpoint too", async () => {
    const fake = fakeTrek({
      tokenStatuses: [{ status: 401, body: '{"error":"invalid_client"}' }],
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect(isTokenRejected(error)).toBe(true);
    expect(String((error as TrekError).message)).not.toContain(CONFIG.clientSecret);
    expect(JSON.stringify((error as TrekError).detail)).not.toContain(CONFIG.clientSecret);
  });
});

/* The machine client (plan M0) */

describe("the client_credentials grant", () => {
  it("asks for a token once and reuses it for the whole hour", async () => {
    const fake = fakeTrek({ tools: { get_vacay_entries: [toolResult({ entries: [] })] } });
    const client = clientFor(fake);
    await client.getEntries(2026);
    await client.getEntries(2026);

    expect(fake.issued).toBe(1);
    expect(fake.tokenCalls).toHaveLength(1);
    expect(fake.tokenCalls[0]).toEqual({
      grantType: "client_credentials",
      clientId: CONFIG.clientId,
      clientSecret: CONFIG.clientSecret,
      // Only what a leave sync needs: this client never asks to read anybody's trips.
      scope: "vacay:read vacay:write",
      resource: "https://trek.example/mcp",
    });
    // Every MCP request carries the token it was issued.
    for (const call of fake.calls) expect(call.bearer).toBe("Bearer access-1");
  });

  it("asks again once the token has run out", async () => {
    let clock = 1_000_000;
    const fake = fakeTrek({
      expiresIn: 3600,
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    const client = createTrekClient(CONFIG, {
      fetch: fake.fetch,
      sleep: async () => {},
      jitter: () => 0,
      now: () => clock,
    });

    await client.getEntries(2026);
    expect(fake.issued).toBe(1);
    // Fifty-nine minutes on: still inside the hour, but past the one-minute margin.
    clock += 59 * 60_000 + 1;
    await client.getEntries(2026);
    expect(fake.issued).toBe(2);
    expect(fake.calls.at(-1)?.bearer).toBe("Bearer access-2");
  });

  it("gets a fresh token when Trek refuses the one in hand, and retries once", async () => {
    const fake = fakeTrek({
      // The first tool call is answered 401: the token expired between the grant and the call.
      statuses: [{ status: 401, body: "expired" }],
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    expect(await clientFor(fake).getEntries(2026)).toEqual([]);
    expect(fake.issued).toBe(2);
    expect(fake.calls.at(-1)?.bearer).toBe("Bearer access-2");
  });

  it("does not keep asking when the machine client itself is refused", async () => {
    const fake = fakeTrek({
      tokenStatuses: [
        { status: 401, body: '{"error":"invalid_client"}' },
        { status: 401, body: '{"error":"invalid_client"}' },
        { status: 401, body: '{"error":"invalid_client"}' },
      ],
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect((error as TrekError).kind).toBe("client_rejected");
    // A rejected secret will not come right by being sent again.
    expect(fake.tokenCalls).toHaveLength(1);
    // And nothing was ever asked of the MCP endpoint.
    expect(fake.calls).toHaveLength(0);
  });

  it("says what to fix when the client is not allowed this grant", async () => {
    const fake = fakeTrek({
      tokenStatuses: [{ status: 400, body: '{"error":"unauthorized_client"}' }],
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect((error as TrekError).message).toContain("machine client");
    expect((error as TrekError).message).toContain("vacay:write");
  });

  it("treats a token endpoint that is merely down as worth another go", async () => {
    const fake = fakeTrek({
      tokenStatuses: [{ status: 503, body: "maintenance" }],
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    expect(await clientFor(fake).getEntries(2026)).toEqual([]);
    expect(fake.tokenCalls).toHaveLength(2);
  });
});

describe("reading the year", () => {
  it("decodes the double-encoded payload and the nested wrapper", async () => {
    const fake = fakeTrek({
      tools: {
        get_vacay_entries: [
          toolResult({
            entries: {
              entries: [{ id: 7, date: "2026-06-16", note: "afternoon", fraction: 0.5, kind: "vacation" }],
            },
          }),
        ],
      },
    });
    expect(await clientFor(fake).getEntries(2026)).toEqual([
      { id: 7, userId: null, date: "2026-06-16", note: "afternoon", fraction: 0.5, kind: "vacation" },
    ]);
  });

  it("coerces a fraction Trek would coerce itself, rather than failing the year", async () => {
    const fake = fakeTrek({
      tools: {
        get_vacay_entries: [
          toolResult({ entries: [{ id: 1, date: "2026-06-16", fraction: 0.25, kind: "vacation" }] }),
        ],
      },
    });
    const [only] = await clientFor(fake).getEntries(2026);
    expect(only.fraction).toBe(1);
    expect(only.note).toBe("");
  });

  it("is loud about a kind it does not know", async () => {
    const fake = fakeTrek({
      tools: {
        get_vacay_entries: [
          toolResult({ entries: [{ id: 1, date: "2026-06-16", fraction: 1, kind: "sabbatical" }] }),
        ],
      },
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrekError);
    expect((error as TrekError).kind).toBe("payload");
  });

  it("retries a read through a 500 and then succeeds", async () => {
    const fake = fakeTrek({
      statuses: [{ status: 500, body: "boom" }],
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    expect(await clientFor(fake).getEntries(2026)).toEqual([]);
    expect(fake.calls.filter((call) => call.tool === "get_vacay_entries")).toHaveLength(2);
  });

  it("gives up after the last attempt", async () => {
    const fake = fakeTrek({
      statuses: [
        { status: 500, body: "1" },
        { status: 500, body: "2" },
        { status: 500, body: "3" },
      ],
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect((error as TrekError).kind).toBe("http");
    expect(fake.calls.filter((call) => call.tool === "get_vacay_entries")).toHaveLength(3);
  });

  it("re-initialises once when the session is refused, and only once", async () => {
    const fake = fakeTrek({
      // The first tool call is answered 404 (an expired session); everything after works.
      statuses: [{ status: 404, body: "unknown session" }],
      tools: { get_vacay_entries: [toolResult({ entries: [] })] },
    });
    expect(await clientFor(fake).getEntries(2026)).toEqual([]);
    expect(fake.calls.filter((call) => call.method === "initialize")).toHaveLength(2);
  });

  it("does not loop when the token stays refused", async () => {
    const fake = fakeTrek({
      initStatuses: [
        { status: 401, body: "no" },
        { status: 401, body: "no" },
        { status: 401, body: "no" },
        { status: 401, body: "no" },
      ],
    });
    const error = await clientFor(fake)
      .getEntries(2026)
      .catch((e: unknown) => e);
    expect(isTokenRejected(error)).toBe(true);
    // Bounded: the handshake is not attempted over and over.
    expect(fake.calls.filter((call) => call.method === "initialize").length).toBeLessThanOrEqual(2);
  });
});

describe("whose days they are, and which year (N4)", () => {
  /** Trek answers `get_vacay_entries` for the whole plan, over the viewer's own leave year. */
  function withEntries(rows: unknown[], userinfo: unknown = { sub: "1" }) {
    const fake = fakeTrek({ tools: { get_vacay_entries: [toolResult({ entries: { entries: rows } })] } });
    const inner = fake.fetch as unknown as (u: unknown, i?: RequestInit) => Promise<Response>;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/userinfo")) {
        return userinfo === null
          ? new Response("no", { status: 404 })
          : new Response(JSON.stringify(userinfo), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
      }
      return inner(url, init);
    });
    return createTrekClient(CONFIG, {
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      sleep: async () => {},
      jitter: () => 0,
    });
  }

  const row = (date: string, userId: number | null) => ({
    id: Math.abs(date.split("-").join("") as unknown as number) || 1,
    user_id: userId,
    date,
    fraction: 1,
    kind: "vacation",
  });

  it("keeps only the days of the user the token acts as", async () => {
    // A shared plan hands back a colleague's leave beside yours; booking it against your own
    // allowance would be wrong in a way nobody notices until the year is counted.
    const client = withEntries([
      { ...row("2026-06-16", 1), id: 1 },
      { ...row("2026-06-17", 2), id: 2 },
    ]);
    expect((await client.getEntries(2026)).map((one) => one.date)).toEqual(["2026-06-16"]);
  });

  it("keeps only the days of the year it asked for", async () => {
    // The range Trek answers over is the viewer's leave year, month-aligned: a fiscal or
    // anniversary window hands back dates either side of the calendar year.
    const client = withEntries([
      { ...row("2025-12-29", 1), id: 1 },
      { ...row("2026-01-05", 1), id: 2 },
      { ...row("2027-01-04", 1), id: 3 },
    ]);
    expect((await client.getEntries(2026)).map((one) => one.date)).toEqual(["2026-01-05"]);
  });

  it("keeps a half day a half day", async () => {
    const client = withEntries([{ ...row("2026-06-16", 1), id: 1, fraction: 0.5 }]);
    expect((await client.getEntries(2026))[0].fraction).toBe(0.5);
  });

  it("keeps everything when Trek will not say who the token is", async () => {
    // A filter that cannot tell whose day it is must not decide that none of them are.
    const client = withEntries(
      [
        { ...row("2026-06-16", 1), id: 1 },
        { ...row("2026-06-17", 2), id: 2 },
      ],
      null,
    );
    expect(await client.getEntries(2026)).toHaveLength(2);
  });
});

describe("the stats", () => {
  it("normalises a single row and a list to the same shape", async () => {
    const row = {
      year: 2026,
      person_name: "Test Person",
      vacation_days: 26,
      carried_over: 3,
      total_available: 29,
      used: 11,
      remaining: 18,
      comp_used: 1,
      window_start: "2026-01-01",
      window_end: "2026-12-31",
    };
    const asRow = fakeTrek({ tools: { get_vacay_stats: [toolResult({ stats: row })] } });
    const asList = fakeTrek({ tools: { get_vacay_stats: [toolResult({ stats: [row] })] } });
    const expected = {
      year: 2026,
      personName: "Test Person",
      vacationDays: 26,
      carriedOver: 3,
      totalAvailable: 29,
      used: 11,
      remaining: 18,
      compUsed: 1,
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    };
    expect(await clientFor(asRow).getStats(2026)).toEqual(expected);
    expect(await clientFor(asList).getStats(2026)).toEqual(expected);
  });

  it("answers null for a year with no stats at all", async () => {
    const fake = fakeTrek({ tools: { get_vacay_stats: [toolResult({ stats: [] })] } });
    expect(await clientFor(fake).getStats(2026)).toBeNull();
  });
});

/* The writes: the part that must never be repeated blindly */

const insertStep: TogglePlanStep = {
  date: "2026-06-16",
  op: "insert",
  fraction: 1,
  kind: "vacation",
  from: null,
};

describe("toggling a day", () => {
  it("sends the date, the fraction and the kind — and never a target user", async () => {
    const fake = fakeTrek({
      tools: { toggle_vacay_entry: [toolResult({ action: "added", fraction: 1, kind: "vacation" })] },
    });
    const result = await clientFor(fake).toggleEntry(insertStep);
    expect(result).toEqual({ date: "2026-06-16", op: "insert", outcome: "applied", action: "added" });

    const args = fake.calls.find((call) => call.tool === "toggle_vacay_entry")?.args;
    expect(args).toEqual({ date: "2026-06-16", fraction: 1, kind: "vacation" });
    expect(args).not.toHaveProperty("targetUserId");
  });

  it("NEVER retries a write, however the server fails", async () => {
    const fake = fakeTrek({
      statuses: [{ status: 500, body: "boom" }],
      tools: { toggle_vacay_entry: [toolResult({ action: "added" })] },
    });
    const result = await clientFor(fake).toggleEntry(insertStep);
    expect(result.outcome).toBe("failed");
    // The whole point: exactly one attempt reached the tool. A second could delete the day.
    expect(fake.calls.filter((call) => call.tool === "toggle_vacay_entry")).toHaveLength(1);
  });

  it("does not retry a write whose outcome is unknown, which is the dangerous case", async () => {
    // The handshake works; the toggle's request dies on the wire. Trek may well have stored the
    // day — that is exactly why the client must not ask again.
    const fake = fakeTrek({ tools: { toggle_vacay_entry: [toolResult({ action: "added" })] } });
    let toggleAttempts = 0;
    const flaky = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      // The token request is form-encoded and none of this test's business: pass it straight on.
      if (String(url).endsWith("/oauth/token")) {
        return (fake.fetch as (u: unknown, i?: RequestInit) => Promise<Response>)(url, init);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const params = (body.params ?? {}) as Record<string, unknown>;
      if (body.method === "tools/call" && params.name === "toggle_vacay_entry") {
        toggleAttempts += 1;
        throw new TypeError("fetch failed");
      }
      return (fake.fetch as (u: unknown, i?: RequestInit) => Promise<Response>)(url, init);
    });
    const client = createTrekClient(CONFIG, {
      fetch: flaky as unknown as typeof globalThis.fetch,
      sleep: async () => {},
      jitter: () => 0,
    });

    await expect(client.toggleEntry(insertStep)).resolves.toMatchObject({ outcome: "failed" });
    expect(toggleAttempts).toBe(1);
  });

  it("reports an action it did not expect instead of toggling again", async () => {
    // We planned an insert; Trek says it updated, so somebody else touched the day meanwhile.
    const fake = fakeTrek({
      tools: { toggle_vacay_entry: [toolResult({ action: "updated" })] },
    });
    const result = await clientFor(fake).toggleEntry(insertStep);
    expect(result.outcome).toBe("unexpected_action");
    expect(result.action).toBe("updated");
    expect(fake.calls.filter((call) => call.tool === "toggle_vacay_entry")).toHaveLength(1);
  });

  it("calls a weekend refusal a weekend, not a failure", async () => {
    const fake = fakeTrek({
      tools: {
        toggle_vacay_entry: [{ isError: true, content: [{ type: "text", text: "cannot book a weekend" }] }],
      },
    });
    const result = await clientFor(fake).toggleEntry({ ...insertStep, date: "2026-06-13" });
    expect(result).toEqual({
      date: "2026-06-13",
      op: "insert",
      outcome: "weekend_blocked",
      action: null,
    });
  });

  it("sends the observed pair for a delete", async () => {
    const fake = fakeTrek({ tools: { toggle_vacay_entry: [toolResult({ action: "removed" })] } });
    await clientFor(fake).toggleEntry({
      date: "2026-06-16",
      op: "delete",
      fraction: 0.5,
      kind: "comp",
      from: { fraction: 0.5, kind: "comp" },
    });
    expect(fake.calls.find((call) => call.tool === "toggle_vacay_entry")?.args).toEqual({
      date: "2026-06-16",
      fraction: 0.5,
      kind: "comp",
    });
  });
});

describe("isWeekendRefusal", () => {
  it("is true only for a refusal that names a weekend", () => {
    expect(isWeekendRefusal(new TrekError("refused", "cannot book a WEEKEND"))).toBe(true);
    expect(isWeekendRefusal(new TrekError("refused", "quota exceeded"))).toBe(false);
    expect(isWeekendRefusal(new TrekError("http", "weekend", 500))).toBe(false);
    expect(isWeekendRefusal(new Error("weekend"))).toBe(false);
  });
});
