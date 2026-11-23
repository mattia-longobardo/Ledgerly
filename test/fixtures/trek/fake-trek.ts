// A Trek made of `year.json` for the parity of a leave pass (rewrite plan R5c): the OAuth token
// endpoint, `/oauth/userinfo` and MCP over SSE, with the toggle's real semantics (absent inserts,
// a different pair updates, the same pair removes). A date of `weekend` is refused as Trek refuses
// a weekend; a date of `failOnce` answers HTTP 500 the first time it is toggled. Every tool call is
// logged, so two engines can be held to the same calls. Synthetic data only; nothing leaves the
// process.
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  id: number;
  user_id: number;
  date: string;
  note: string | null;
  fraction: number;
  kind: string;
}

interface Year {
  ownUser: number;
  entries: Row[];
  stats: Record<string, unknown>;
  weekend: string[];
  failOnce: string[];
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

const sse = (message: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", "mcp-session-id": "fixture-session" },
  });
const text = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

/** A Trek holding the year of the fixture; `scope` is what its token endpoint grants. */
export function fakeTrek(scope = "vacay:read vacay:write") {
  const year: Year = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/trek/year.json"), "utf8"));
  const rows = new Map(year.entries.map((row) => [`${row.user_id}:${row.date}`, { ...row }]));
  const failed = new Set<string>();
  const calls: ToolCall[] = [];
  let nextId = 100;

  function toggle(args: { date: string; fraction: number; kind: string }) {
    if (year.weekend.includes(args.date)) {
      return { isError: true, content: [{ type: "text", text: "Cannot book a weekend day" }] };
    }
    const key = `${year.ownUser}:${args.date}`;
    const has = rows.get(key);
    if (has === undefined) {
      rows.set(key, { id: (nextId += 1), user_id: year.ownUser, note: null, ...args });
      return text({ action: "added" });
    }
    if (has.fraction === args.fraction && has.kind === args.kind) {
      rows.delete(key);
      return text({ action: "removed" });
    }
    rows.set(key, { ...has, fraction: args.fraction, kind: args.kind });
    return text({ action: "updated" });
  }

  function tool(name: string, args: Record<string, unknown>): Response {
    calls.push({ tool: name, args });
    if (name === "get_vacay_entries")
      return sse({ jsonrpc: "2.0", id: 0, result: text({ entries: [...rows.values()] }) });
    if (name === "get_vacay_stats")
      return sse({ jsonrpc: "2.0", id: 0, result: text({ stats: year.stats }) });
    const date = String(args.date);
    if (year.failOnce.includes(date) && !failed.has(date)) {
      failed.add(date);
      return new Response("upstream failure", { status: 500 });
    }
    return sse({
      jsonrpc: "2.0",
      id: 0,
      result: toggle(args as { date: string; fraction: number; kind: string }),
    });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      return Response.json({ access_token: "fixture-access", token_type: "Bearer", expires_in: 3600, scope });
    }
    if (url.endsWith("/oauth/userinfo")) return Response.json({ sub: String(year.ownUser) });
    const body = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: Record<string, unknown>;
    };
    if (body.method === "initialize") return sse({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    const params = body.params ?? {};
    const answer = tool(String(params.name), (params.arguments ?? {}) as Record<string, unknown>);
    // The id of the answer is the request's own: the fake does not count them.
    if (answer.headers.get("content-type") !== "text/event-stream") return answer;
    const message = JSON.parse((await answer.text()).slice("event: message\ndata: ".length));
    return sse({ ...message, id: body.id });
  };

  return {
    fetch,
    calls,
    /** The token owner's days, by date: what Trek holds now. */
    held: () =>
      [...rows.values()]
        .filter((row) => row.user_id === year.ownUser)
        .map((row) => `${row.date} ${row.fraction} ${row.kind}`)
        .sort(),
  };
}
