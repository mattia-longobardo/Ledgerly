// A Trek for the tests of a leave pass (rewrite plan R5c): the OAuth token endpoint,
// `/oauth/userinfo` and MCP over SSE, with the toggle's real semantics (absent inserts, a different
// pair updates, the same pair removes), so a test can make the mistake the design guards against and
// see the day disappear. A date of `weekend` is refused as Trek refuses a weekend; a date of
// `failOnce` answers HTTP 500 the first time it is toggled. Every tool call is logged. Synthetic data
// only; nothing leaves the process.
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  id: number;
  user_id: number | null;
  date: string;
  note: string | null;
  fraction: number;
  kind: string;
}

export interface TrekYear {
  /** The user the token acts as. */
  ownUser: number;
  entries: Row[];
  /** The row `get_vacay_stats` answers; `null`: no figures. */
  stats: Record<string, unknown> | null;
  weekend: string[];
  failOnce: string[];
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** The year of `year.json`: the parity's fixture. */
export function fixtureYear(): TrekYear {
  return JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/trek/year.json"), "utf8"));
}

const sse = (id: unknown, result: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", "mcp-session-id": "fixture-session" },
  });
const text = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

interface Options {
  /** What the token endpoint grants; `null` leaves the scope out. */
  scope?: string | null;
  /** Awaited by every read of the entries: a test holds a pass in the middle with it. */
  hold?: Promise<void>;
}

/** A Trek holding `year`. */
export function fakeTrek(year: Partial<TrekYear> = {}, options: Options = {}) {
  const state: TrekYear = { ownUser: 7, entries: [], stats: null, weekend: [], failOnce: [], ...year };
  const rows = new Map(state.entries.map((row) => [`${row.user_id}:${row.date}`, { ...row }]));
  const failed = new Set<string>();
  const calls: ToolCall[] = [];
  /** Every toggle that reached the tool, with what Trek said it did. */
  const toggles: { date: string; fraction: number; kind: string; action: string }[] = [];
  let failNext = 0;
  let nextId = 100;

  const mine = (row: Row) => row.user_id === state.ownUser || row.user_id === null;
  const ownKey = (date: string) => [...rows.entries()].find(([, row]) => row.date === date && mine(row))?.[0];

  function toggle(args: { date: string; fraction: number; kind: string }): unknown {
    if (state.weekend.includes(args.date)) {
      return { isError: true, content: [{ type: "text", text: "Cannot book a weekend day" }] };
    }
    const key = ownKey(args.date) ?? `${state.ownUser}:${args.date}`;
    const has = rows.get(key);
    let action = "updated";
    if (has === undefined) {
      rows.set(key, { id: (nextId += 1), user_id: state.ownUser, note: null, ...args });
      action = "added";
    } else if (has.fraction === args.fraction && has.kind === args.kind) {
      rows.delete(key);
      action = "removed";
    } else {
      rows.set(key, { ...has, fraction: args.fraction, kind: args.kind });
    }
    toggles.push({ ...args, action });
    return text({ action });
  }

  async function tool(id: unknown, name: string, args: Record<string, unknown>): Promise<Response> {
    calls.push({ tool: name, args });
    if (name === "get_vacay_entries") {
      await options.hold;
      return sse(id, text({ entries: [...rows.values()] }));
    }
    if (name === "get_vacay_stats") return sse(id, text({ stats: state.stats ?? [] }));
    const date = String(args.date);
    const once = state.failOnce.includes(date) && !failed.has(date);
    if (once || failNext > 0) {
      if (once) failed.add(date);
      else failNext -= 1;
      return new Response("upstream failure", { status: 500 });
    }
    return sse(id, toggle(args as { date: string; fraction: number; kind: string }));
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      const scope = options.scope === undefined ? "vacay:read vacay:write" : (options.scope ?? undefined);
      return Response.json({ access_token: "fixture-access", token_type: "Bearer", expires_in: 3600, scope });
    }
    if (url.endsWith("/oauth/userinfo")) return Response.json({ sub: String(state.ownUser) });
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: Record<string, unknown>;
    };
    if (body.method === "initialize") return sse(body.id, {});
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    const params = body.params ?? {};
    return tool(body.id, String(params.name), (params.arguments ?? {}) as Record<string, unknown>);
  };

  return {
    fetch,
    calls,
    toggles,
    /** The next `count` toggles answer HTTP 500: their outcome is unknown, and nothing lands. */
    failNextToggles(count: number) {
      failNext = count;
    },
    /** How many times the year was read. */
    get reads() {
      return calls.filter((one) => one.tool === "get_vacay_entries").length;
    },
    /** The token owner's days, as `date fraction kind`: what Trek holds now. */
    held: () =>
      [...rows.values()]
        .filter(mine)
        .map((row) => `${row.date} ${row.fraction} ${row.kind}`)
        .sort(),
    entryOn: (date: string) => rows.get(ownKey(date) ?? "") ?? null,
  };
}
