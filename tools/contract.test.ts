// The automatic checks of the contract (rewrite plan R2, 08-agents.md §8.2: «OpenAPI solo additivo,
// primitive comuni, nomi del glossario»). They run with `npm test`, before any route exists.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_ROUTES,
  CONTRACT_ROUTES,
  CONTRACT_SCOPES,
  SETTINGS_ROUTES,
  TRANSACTIONS_ROUTES,
  type RouteContract,
} from "@ledgerly/api-contract";
import * as wire from "../packages/api-contract/src/accounts/shared";
import * as transactionsWire from "../packages/api-contract/src/transactions/shared";
import * as rulesWire from "../packages/api-contract/src/transactions/rules";
import * as domain from "@domain/modules/accounts/rules";
import * as transactionsDomain from "@domain/modules/transactions/rules";
import * as rulesDomain from "@domain/modules/transactions/categorize/user-rules";
import { MANUAL_KINDS } from "@domain/modules/transactions/manual-rules";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@domain/modules/transactions/queries/filters";
import { breakingChanges, DOCUMENT, generated, RELEASED } from "../scripts/openapi";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SEGMENT = /^([a-z][a-z0-9]*(-[a-z0-9]+)*|\{[a-z][A-Za-z0-9]*\})$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;

/** Every key of every object of a value: the wire speaks camelCase (glossary of the contract). */
function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      keysOf(item, found);
    }
  }
  return found;
}

const label = (route: RouteContract) => `${route.method} ${route.path}`;

describe("the contract of /api/v1", () => {
  it("has the OpenAPI document the descriptors give (npm run openapi)", () => {
    expect(readFileSync(DOCUMENT, "utf8")).toBe(generated());
  });

  it("only adds to the OpenAPI document of the last release", () => {
    expect(breakingChanges(json(RELEASED), json(DOCUMENT))).toEqual([]);
  });

  it("names each route once, in snake_case, on a kebab-case path", () => {
    const ids = CONTRACT_ROUTES.map((route) => route.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    expect(ids.filter((id) => !SNAKE.test(id))).toEqual([]);
    const keys = CONTRACT_ROUTES.map(label);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
    const badPaths = CONTRACT_ROUTES.filter(
      (route) =>
        !route.path
          .split("/")
          .slice(1)
          .every((s) => SEGMENT.test(s)),
    );
    expect(badPaths.map(label)).toEqual([]);
  });

  it("declares the schema of every parameter of a path, and nothing else", () => {
    const wrong = CONTRACT_ROUTES.filter((route) => {
      const named = [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      return JSON.stringify(named) !== JSON.stringify(Object.keys(route.params?.shape ?? {}).sort());
    });
    expect(wrong.map(label)).toEqual([]);
  });

  it("asks a scope of the contract on every route but /meta", () => {
    const open = CONTRACT_ROUTES.filter((route) => route.scope === null).map((route) => route.id);
    expect(open).toEqual(["get_meta"]);
    const unknown = CONTRACT_ROUTES.filter(
      (route) => route.scope !== null && !CONTRACT_SCOPES.includes(route.scope),
    );
    expect(unknown.map(label)).toEqual([]);
  });

  it("makes an MCP tool only of a read with the scope read", () => {
    const wrong = CONTRACT_ROUTES.filter(
      (route) => route.mcp && (route.method !== "GET" || route.scope !== "read"),
    );
    expect(wrong.map(label)).toEqual([]);
  });

  it("answers no body with 204, and a body only with a status that has one", () => {
    const wrong = CONTRACT_ROUTES.filter((route) =>
      route.response === null ? route.status !== 204 && route.status !== 202 : route.status === 204,
    );
    expect(wrong.map(label)).toEqual([]);
  });

  it.each(CONTRACT_ROUTES.map((route) => [label(route), route] as const))(
    "%s: the example fits the schemas",
    (_, route) => {
      if (route.params) expect(route.params.safeParse(route.example.params).error).toBeUndefined();
      else expect(route.example.params).toBeUndefined();
      if (route.query) expect(route.query.safeParse(route.example.query ?? {}).error).toBeUndefined();
      if (route.body) expect(route.body.safeParse(route.example.body).error).toBeUndefined();
      else expect(route.example.body).toBeUndefined();
      if (route.response) expect(route.response.safeParse(route.example.response).error).toBeUndefined();
      else expect(route.example.response).toBeUndefined();
    },
  );

  it("speaks camelCase in every example", () => {
    const wrong = CONTRACT_ROUTES.flatMap((route) =>
      keysOf([route.example.body, route.example.response])
        .filter((key) => !CAMEL.test(key) && !(route.id.includes("undo") || key.startsWith("acc-")))
        .map((key) => `${label(route)}: ${key}`),
    );
    expect(wrong).toEqual([]);
  });
});

/**
 * The Server Actions of users and settings (05-refactor.md §5.5) and the route each one calls the
 * same use case of (R2 criterion 4). An action left out is in `EXCLUDED`, with its reason: the
 * written list of exclusions of the module.
 */
const SETTINGS_ACTION_FILES = [
  "apps/web/src/modules/users/actions.ts",
  "apps/web/src/app/(auth)/actions.ts",
  "apps/web/src/app/(app)/settings/security/actions.ts",
  "apps/web/src/app/(app)/settings/categories/actions.ts",
  "apps/web/src/app/(app)/settings/categories/source-actions.ts",
  "apps/web/src/app/(app)/settings/integrations/actions.ts",
  "apps/web/src/app/(app)/settings/integrations/deactivate-actions.ts",
  "apps/web/src/app/(app)/settings/integrations/plugin-actions.ts",
  "apps/web/src/app/(app)/banks/connect/actions.ts",
];

const EXCLUDED: Record<string, string> = {
  revokeOtherSessionsAction: "web cookie: «the other sessions» are the ones that are not the cookie's",
  acceptInviteAction: "web cookie: it creates the account and signs it in, before any token exists",
  coreConnectionAction: "Wallet and Trek «test» and «history» until R5c: the routes answer `core_provider`",
  // The providers of the core keep their cards on the web until they are plugins (R5c): moving
  // their use cases out of the web would name them in a new file (rule M12).
  connectWalletAction: "Wallet until R5c",
  walletAccountsAction: "Wallet until R5c",
  chooseWalletAccountsAction: "Wallet until R5c",
  disconnectWalletAction: "Wallet until R5c",
  connectTrekAction: "Trek until R5c",
  disconnectTrekAction: "Trek until R5c",
};

describe("the Server Actions of users and settings", () => {
  const actions = SETTINGS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(SETTINGS_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0])));

  it("each have a route or a written exclusion", () => {
    expect(actions.filter((name) => !routed.has(name) && !(name in EXCLUDED))).toEqual([]);
  });

  it("are named by the routes only when they exist", () => {
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
    expect(Object.keys(EXCLUDED).filter((name) => !actions.includes(name))).toEqual([]);
  });
});

/** The Server Actions of accounts (05-refactor.md §5.5) and their routes; no exclusion. */
const ACCOUNTS_ACTION_FILES: string[] = [];

describe("the Server Actions of accounts", () => {
  const actions = ACCOUNTS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(ACCOUNTS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(wire.ACCOUNT_TYPES).toEqual(domain.ACCOUNT_TYPES);
    expect(wire.ACCOUNT_STATES).toEqual(domain.ACCOUNT_STATES);
    expect(wire.ACCOUNT_ORIGINS).toEqual(domain.ACCOUNT_ORIGINS);
    expect(wire.ENTRY_SOURCES).toEqual(domain.ENTRY_SOURCES);
    expect(wire.REMINDERS).toEqual(domain.REMINDERS);
    expect(wire.TRENDS).toEqual(domain.TRENDS);
    expect(wire.CONNECTION_CHANNELS).toEqual(domain.CONNECTION_CHANNELS);
    expect(wire.SNAPSHOT_STATES).toEqual(domain.SNAPSHOT_STATES);
  });
});

/**
 * The Server Actions of transactions (05-refactor.md §5.5) and Expenses' manual movement, and their
 * routes; no exclusion. The palette's two searches have no action left: it calls `/api/v1`. `name:variant` is one action that calls two use cases.
 */
const TRANSACTIONS_ACTION_FILES: string[] = [];

describe("the Server Actions of transactions", () => {
  const actions = TRANSACTIONS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(
    TRANSACTIONS_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0])),
  );

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(transactionsWire.TRANSACTION_TYPES).toEqual(transactionsDomain.TRANSACTION_TYPES);
    expect(transactionsWire.TRANSACTION_STATES).toEqual(transactionsDomain.TRANSACTION_STATES);
    expect(transactionsWire.TRANSACTION_ORIGINS).toEqual(transactionsDomain.TRANSACTION_ORIGINS);
    expect(transactionsWire.SEND_STATES).toEqual(transactionsDomain.SEND_STATES);
    expect(transactionsWire.MANUAL_KINDS).toEqual(MANUAL_KINDS);
    expect([transactionsWire.DEFAULT_TRANSACTIONS, transactionsWire.MAX_TRANSACTIONS]).toEqual([
      DEFAULT_LIMIT,
      MAX_LIMIT,
    ]);
    expect(rulesWire.TEXT_OPS).toEqual(rulesDomain.TEXT_OPS);
    expect(rulesWire.COUNTERPARTY_OPS).toEqual(rulesDomain.COUNTERPARTY_OPS);
    expect(rulesWire.AMOUNT_OPS).toEqual(rulesDomain.AMOUNT_OPS);
    expect(rulesWire.DIRECTIONS).toEqual(rulesDomain.DIRECTIONS);
    expect(rulesWire.RULE_SOURCES).toEqual(rulesDomain.RULE_SOURCES);
    expect(rulesWire.MAX_CONDITIONS).toEqual(rulesDomain.MAX_CONDITIONS);
  });
});

describe("breakingChanges", () => {
  const doc = (body: object, answer: object) => ({
    paths: {
      "/x": {
        post: {
          requestBody: { content: { "application/json": { schema: body } } },
          responses: { "200": { content: { "application/json": { schema: answer } } } },
        },
      },
    },
  });
  const answer = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
  const body = { type: "object", properties: { b: { type: "string" } }, required: [] };

  it("lets a field or an optional input in", () => {
    const more = { ...answer, properties: { ...answer.properties, c: { type: "number" } } };
    const optional = { ...body, properties: { ...body.properties, d: { type: "string" } } };
    expect(breakingChanges(doc(body, answer), doc(optional, more))).toEqual([]);
  });

  it("refuses a field gone, a new required input, a route gone", () => {
    const required = { ...body, required: ["b"] };
    expect(breakingChanges(doc(body, answer), doc(required, { type: "object", properties: {} }))).toEqual([
      "POST /x body.b: newly required",
      "POST /x 200.a: gone",
      "POST /x 200.a: no longer always there",
    ]);
    expect(breakingChanges(doc(body, answer), { paths: {} })).toEqual(["POST /x: gone"]);
  });
});
