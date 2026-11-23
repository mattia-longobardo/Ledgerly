// The Trek plugin through its own server, as the core calls it: the kit of the contract, the
// manifest, and each call of a leave calendar against a Trek made of canned MCP answers.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLUGIN_PATHS, SECRET_HEADER } from "@plugin-contract/calls";
import {
  CALENDAR_PATHS,
  leaveFiguresResponseSchema,
  leaveReadResponseSchema,
  leaveWriteResponseSchema,
} from "@plugin-contract/calls-calendar";
import { checkPlugin } from "@plugin-contract/kit";
import { manifestSchema } from "@plugin-contract/manifest";
import type { Deps } from "./handlers";
import { MANIFEST } from "./manifest";

process.env.PLUGIN_NO_LISTEN = "1";

const SECRET = "a-shared-secret-of-the-core-and-the-plugin";
const CREDENTIALS = {
  baseUrl: "https://trek.example",
  clientId: "trekci_abc",
  clientSecret: "trekcs_secret",
};
const NOW = Date.parse("2026-06-10T08:00:00.000Z");

interface Row {
  user_id: number;
  date: string;
  fraction: number;
  kind: string;
}

interface TrekState {
  rows: Row[];
  /** The scope the token endpoint grants; `null` leaves it out. */
  scope?: string | null;
  /** Dates refused as a weekend. */
  weekend?: string[];
  /** Every MCP request answers this status, before any tool. */
  mcpStatus?: number;
  /** The token endpoint answers this status. */
  tokenStatus?: number;
}

const sse = (result: unknown, id: unknown) =>
  new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, {
    headers: { "content-type": "text/event-stream", "mcp-session-id": "s-1" },
  });
const payload = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** Trek of the person, user 7, with the toggle's semantics; every tool call is recorded. */
function fakeTrek(state: TrekState) {
  const tools: { name: string; args: Record<string, unknown> }[] = [];
  const toggle = (args: { date: string; fraction: number; kind: string }) => {
    if (state.weekend?.includes(args.date))
      return { isError: true, content: [{ type: "text", text: "weekend" }] };
    const index = state.rows.findIndex((row) => row.user_id === 7 && row.date === args.date);
    const has = state.rows[index];
    if (has === undefined) {
      state.rows.push({ user_id: 7, ...args });
      return payload({ action: "added" });
    }
    if (has.fraction === args.fraction && has.kind === args.kind) {
      state.rows.splice(index, 1);
      return payload({ action: "removed" });
    }
    state.rows[index] = { ...has, ...args };
    return payload({ action: "updated" });
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    expect(url.startsWith("https://trek.example/")).toBe(true);
    if (url.endsWith("/oauth/token")) {
      if (state.tokenStatus) return new Response('{"error":"invalid_client"}', { status: state.tokenStatus });
      const scope = state.scope === undefined ? "vacay:read vacay:write" : (state.scope ?? undefined);
      return Response.json({ access_token: "a-1", expires_in: 3600, scope });
    }
    if (url.endsWith("/oauth/userinfo")) return Response.json({ sub: "7" });
    if (state.mcpStatus) return new Response("Trek's own words", { status: state.mcpStatus });
    const body = JSON.parse(String(init?.body));
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    if (body.method === "initialize") return sse({}, body.id);
    const { name, arguments: args } = body.params;
    tools.push({ name, args });
    if (name === "get_vacay_stats") {
      return sse(payload({ stats: { year: 2026, total_available: 28, used: 9, remaining: 19 } }), body.id);
    }
    return sse(
      name === "toggle_vacay_entry"
        ? toggle(args)
        : payload({ entries: state.rows.map((row, id) => ({ id, ...row })) }),
      body.id,
    );
  };
  const deps: Deps = { fetch: fetchFn, sleep: async () => undefined, jitter: () => 0, now: () => NOW };
  return { deps, tools };
}

async function serve(deps: Deps): Promise<{ origin: string; close: () => Promise<void> }> {
  const { createHandler } = await import("./server");
  const server = createServer(createHandler(SECRET, deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function call(deps: Deps, path: string, body: object): Promise<{ status: number; body: unknown }> {
  const { origin, close } = await serve(deps);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
      body: JSON.stringify({ credentials: CREDENTIALS, ...body }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await close();
  }
}

const row = (date: string, fraction = 1, kind = "vacation", user = 7): Row => ({
  user_id: user,
  date,
  fraction,
  kind,
});

describe("the contract", () => {
  let origin = "";
  let close: () => Promise<void> = async () => {};
  beforeAll(async () => {
    ({ origin, close } = await serve(fakeTrek({ rows: [], mcpStatus: 500 }).deps));
  });
  afterAll(() => close());

  it("is kept, as the kit checks it", async () => {
    expect(await checkPlugin({ origin, secret: SECRET, id: "trek" })).toEqual([]);
  });

  it("never sends Trek's words, only a code", async () => {
    const response = await fetch(`${origin}${CALENDAR_PATHS.read}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: SECRET },
      body: JSON.stringify({ credentials: CREDENTIALS, year: 2026 }),
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ error: { code: "provider_down" } });
    expect(text).not.toContain("own words");
  });
});

describe("the manifest", () => {
  it("is a leave calendar of contract 2, with the version of the app and the keys the core seals", () => {
    expect(manifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
    const root: unknown = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(root).toMatchObject({ version: MANIFEST.version });
    expect(MANIFEST.capabilities).toEqual(["leaveCalendar", "provider.write"]);
    expect(MANIFEST.userSettings.map((field) => field.name)).toEqual(["baseUrl", "clientId", "clientSecret"]);
    expect(
      MANIFEST.userSettings.filter((field) => field.type === "secret").every((field) => field.writeOnly),
    ).toBe(true);
    expect(MANIFEST.egress).toEqual([]);
  });
});

describe("verify", () => {
  it.each([
    ["write", "vacay:read vacay:write", "write"],
    ["read-only", "vacay:read", "read-only"],
    ["unverifiable", null, "unverifiable"],
  ])("says %s from what the token endpoint granted, after one read", async (_case, scope, access) => {
    const trek = fakeTrek({ rows: [], scope });
    expect(await call(trek.deps, PLUGIN_PATHS.verify, {})).toEqual({ status: 200, body: { access } });
    expect(trek.tools).toEqual([{ name: "get_vacay_entries", args: { year: 2026 } }]);
  });

  it("answers 403 auth when Trek refuses the machine client", async () => {
    const trek = fakeTrek({ rows: [], tokenStatus: 401 });
    expect(await call(trek.deps, PLUGIN_PATHS.verify, {})).toEqual({
      status: 403,
      body: { error: { code: "auth" } },
    });
  });

  it.each([
    ["an address that is not https", { ...CREDENTIALS, baseUrl: "http://trek.example" }, 400, "key_format"],
    ["a secret with a line break", { ...CREDENTIALS, clientSecret: "trekcs\nsecret" }, 400, "key_format"],
    ["no client id", { baseUrl: CREDENTIALS.baseUrl, clientSecret: "s" }, 400, "invalid_request"],
  ])("refuses %s before any request", async (_case, credentials, status, code) => {
    const trek = fakeTrek({ rows: [] });
    expect(await call(trek.deps, PLUGIN_PATHS.verify, { credentials })).toEqual({
      status,
      body: { error: { code } },
    });
    expect(trek.tools).toEqual([]);
  });
});

describe("read", () => {
  it("gives the person's days of the year only, in the contract's words", async () => {
    const rows = [
      row("2026-06-16", 0.5),
      row("2026-06-17", 1, "comp"),
      row("2026-06-18", 1, "vacation", 99),
      row("2027-01-04"),
    ];
    const answer = await call(fakeTrek({ rows }).deps, CALENDAR_PATHS.read, { year: 2026 });
    expect(leaveReadResponseSchema.parse(answer.body)).toEqual({
      days: [
        { day: "2026-06-16", fraction: 0.5, kind: "vacation" },
        { day: "2026-06-17", fraction: 1, kind: "comp" },
      ],
    });
  });
});

describe("write", () => {
  const write = (state: TrekState, body: object) => {
    const trek = fakeTrek(state);
    return call(trek.deps, CALENDAR_PATHS.write, { year: 2026, ...body }).then((answer) => ({
      ...answer,
      tools: trek.tools,
    }));
  };

  it("sends only what differs, says what became of each day, and answers the year after", async () => {
    const answer = await write(
      { rows: [row("2026-06-16"), row("2026-06-17", 0.5), row("2026-03-11")], weekend: ["2026-06-20"] },
      {
        desired: [
          { day: "2026-06-16", fraction: 1, kind: "vacation" },
          { day: "2026-06-17", fraction: 1, kind: "vacation" },
          { day: "2026-06-18", fraction: 0.5, kind: "vacation" },
          { day: "2026-06-20", fraction: 1, kind: "vacation" },
        ],
        remove: ["2026-03-11", "2026-03-12"],
      },
    );
    const parsed = leaveWriteResponseSchema.parse(answer.body);
    expect(parsed.outcomes).toEqual([
      { day: "2026-06-16", state: "unchanged", reason: null },
      { day: "2026-03-12", state: "unchanged", reason: null },
      { day: "2026-06-17", state: "done", reason: null },
      { day: "2026-06-18", state: "done", reason: null },
      { day: "2026-06-20", state: "refused", reason: "not_bookable" },
      { day: "2026-03-11", state: "done", reason: null },
    ]);
    expect(parsed.days.map((one) => one.day)).toEqual(["2026-06-16", "2026-06-17", "2026-06-18"]);
    // Read, the four toggles, read again.
    expect(answer.tools.map((one) => one.name)).toEqual([
      "get_vacay_entries",
      "toggle_vacay_entry",
      "toggle_vacay_entry",
      "toggle_vacay_entry",
      "toggle_vacay_entry",
      "get_vacay_entries",
    ]);
  });

  it("sends nothing and reads once when Trek already agrees", async () => {
    const answer = await write(
      { rows: [row("2026-06-16")] },
      { desired: [{ day: "2026-06-16", fraction: 1, kind: "vacation" }], remove: [] },
    );
    expect(leaveWriteResponseSchema.parse(answer.body).outcomes).toEqual([
      { day: "2026-06-16", state: "unchanged", reason: null },
    ]);
    expect(answer.tools.map((one) => one.name)).toEqual(["get_vacay_entries"]);
  });

  it("sends nothing with a token that may only read: every write is refused for permission", async () => {
    const answer = await write(
      { rows: [], scope: "vacay:read" },
      { desired: [{ day: "2026-06-16", fraction: 1, kind: "vacation" }], remove: [] },
    );
    expect(leaveWriteResponseSchema.parse(answer.body).outcomes).toEqual([
      { day: "2026-06-16", state: "refused", reason: "permission" },
    ]);
    expect(answer.tools.map((one) => one.name)).toEqual(["get_vacay_entries"]);
  });

  it.each([
    ["a date twice", [{ day: "2026-06-16", fraction: 1, kind: "vacation" }], ["2026-06-16"]],
    ["a day of another year", [{ day: "2025-06-16", fraction: 1, kind: "vacation" }], []],
    ["a kind Trek does not know", [{ day: "2026-06-16", fraction: 1, kind: "rol" }], []],
  ])("refuses %s, before any request", async (_case, desired, remove) => {
    const answer = await write({ rows: [] }, { desired, remove });
    expect(answer).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } }, tools: [] });
  });
});

describe("figures", () => {
  it("gives Trek's own count of the year", async () => {
    const answer = await call(fakeTrek({ rows: [] }).deps, CALENDAR_PATHS.figures, { year: 2026 });
    expect(leaveFiguresResponseSchema.parse(answer.body)).toEqual({
      figures: { used: 9, remaining: 19, totalAvailable: 28 },
    });
  });
});
