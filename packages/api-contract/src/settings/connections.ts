// Users and settings · connections, banks, sources and plugins (rewrite plan R2, 05-refactor.md
// §5.5): the generic actions `connect`, `test`, `syncNow`, `disconnect` on one resource, whatever the
// provider. A provider is a string (`plugin:<id>` or a provider of the core): an open vocabulary
// (rule M13): no shape names a provider (rule M12); `actions` names the Server Actions R3 deletes.
// A credential goes in and never comes
// back. A refusal answers `conflict` or `invalid` with the provider's code in `reason`.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, instant } from "../primitives";
import { SCHEDULE_PREVIEW_COUNT, syncScheduleSchema, timeOfDay } from "./schedule";
import { byId, CONNECTION_ERRORS, CONNECTION_ID } from "./shared";

const days = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every") }),
  z.object({ kind: z.literal("weekdays"), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
  /** -1 is the last day of the month. */
  z.object({
    kind: z.literal("monthDays"),
    monthDays: z.array(z.number().int().min(-1).max(31)).min(1).max(32),
  }),
]);

const schedule = z.object({
  rules: z.array(
    z.union([
      z.object({
        kind: z.literal("interval"),
        everyMinutes: z.number().int(),
        from: timeOfDay,
        until: timeOfDay,
        days,
      }),
      z.object({ kind: z.literal("times"), times: z.array(timeOfDay).min(1), days }),
      z.object({ kind: z.literal("cron"), expression: z.string().max(120) }),
    ]),
  ),
});

/** The most runs of each connection `GET /connections?runs=` gives: what the page of a source groups. */
const MAX_RUNS = 40;

const run = z.object({
  /** What the run read: `accounts`, `transactions`, … (open vocabulary). */
  kind: z.string(),
  state: z.enum(["running", "success", "failed", "skipped"]),
  origin: z.string().nullable(),
  errorCode: z.string().nullable(),
  counts: z.record(z.string(), z.number().int()).nullable(),
  startedAt: instant(),
});

const connection = z.object({
  id: id(),
  provider: z.string(),
  /** The page of its source (`GET /sources/{slug}/…`); null for an investment service. */
  source: z.string().nullable(),
  name: z.string(),
  /** What a person calls the provider («Enable Banking»): with `name`, the words of a toast. */
  providerName: z.string(),
  state: z.enum(["active", "error", "revoked"]),
  errorCode: z.string().nullable(),
  /** The failed readings in a row since the last good one; 0 after a good one. */
  consecutiveFailures: z.number().int().nonnegative(),
  lastOkAt: instant().nullable(),
  nextSyncAt: instant().nullable(),
  /** The end of a wait the provider asked for, when it is later than the schedule's next time. */
  nextAttempt: instant().nullable(),
  /** The access ends then (a bank's consent). */
  expiresAt: instant().nullable(),
  schedule,
  /** False for a connection of a plugin the person turned off. */
  providerActive: z.boolean(),
  /** False while its accounts are not chosen. */
  accountsChosen: z.boolean(),
  /** The provider refuses the person's key. */
  keyRefused: z.boolean(),
  /** Names of accounts here whose IBAN a new account of the source carries. Never an IBAN. */
  ibanConflicts: z.array(z.string()),
  /** The months of movements read today; null for a provider without a chosen depth of history. */
  historyDepth: z.number().int().nullable(),
  /** The accounts the bank's access shares; null for a connection that is not a plugin's. */
  shared: z.number().int().nonnegative().nullable(),
  /** An investment service with a key: its account, whose page has its settings; null otherwise. */
  service: z.object({ accountId: id() }).nullable(),
  /** What the connection can do: the client offers only these. */
  capabilities: z.object({
    sync: z.boolean(),
    test: z.boolean(),
    disconnect: z.boolean(),
    chooseAccounts: z.boolean(),
    renew: z.boolean(),
    /** The depths, in months, `POST /connections/{id}/history` accepts; empty when none. */
    historyMonths: z.array(z.number().int()),
  }),
  /**
   * The state of the row, by the one rule of the server (`syncStatus`): `value` of five, `text` the
   * sentence to say, `action` the one thing the person can do, or null.
   */
  status: z.object({
    value: z.enum(["ok", "running", "late", "action", "paused"]),
    text: z.enum([
      "ok",
      "running",
      "late",
      "lateNever",
      "lateLimit",
      "consentExpired",
      "keyInvalid",
      "pending",
      "pausedSchedule",
      "pausedProvider",
    ]),
    action: z.enum(["update", "renew", "replaceKey", "chooseAccounts", "resume", "enable"]).nullable(),
  }),
  /** The last runs, newest first: 10, or the `runs` of the query. */
  runs: z.array(run),
});

const CONNECTION_EXAMPLE = {
  id: CONNECTION_ID,
  provider: "plugin:enablebanking",
  source: "enablebanking",
  name: "Example Bank",
  providerName: "Enable Banking",
  state: "active",
  errorCode: null,
  consecutiveFailures: 0,
  lastOkAt: "2026-11-18T07:00:00.000Z",
  nextSyncAt: "2026-11-18T13:00:00.000Z",
  nextAttempt: null,
  expiresAt: "2027-05-17T00:00:00.000Z",
  schedule: { rules: [{ kind: "times", times: ["07:00", "13:00", "19:00"], days: { kind: "every" } }] },
  providerActive: true,
  accountsChosen: true,
  keyRefused: false,
  ibanConflicts: [],
  historyDepth: null,
  shared: 2,
  service: null,
  capabilities: {
    sync: true,
    test: false,
    disconnect: true,
    chooseAccounts: true,
    renew: true,
    historyMonths: [],
  },
  status: { value: "ok", text: "ok", action: null },
  runs: [
    {
      kind: "transactions",
      state: "success",
      origin: "schedule",
      errorCode: null,
      counts: { added: 3 },
      startedAt: "2026-11-18T07:00:00.000Z",
    },
  ],
};

export const listConnections = defineRoute({
  id: "list_connections",
  method: "GET",
  path: "/connections",
  scope: "read",
  capability: "connections",
  summary:
    "The person's connections with their state, schedule, capabilities and last runs: 10 runs each, " +
    `or \`runs\` (at most ${MAX_RUNS}).`,
  actions: [],
  query: z.object({ runs: z.coerce.number().int().min(1).max(MAX_RUNS).optional() }),
  response: z.object({ connections: z.array(connection) }),
  errors: [],
  mcp: {
    title: "Connections",
    description:
      "The user's connections to banks and services as GET /api/v1/connections: state, last good " +
      "reading, next reading, and the last runs.",
  },
  example: { response: { connections: [CONNECTION_EXAMPLE] } },
});

export const connect = defineRoute({
  id: "connect",
  method: "POST",
  path: "/connections",
  scope: "write",
  capability: "connections",
  summary:
    "Connects a provider of the core that takes credentials, or replaces them. A refusal of the credentials " +
    "is `invalid` with the card's code in `reason` (`empty`, `rejected`, `provider`).",
  // The Server Actions of the cards of the core are named in `tools/contract.test.ts`: this file names no provider (M12).
  actions: [],
  body: z.object({ provider: z.string().min(1), credentials: z.record(z.string(), z.string()) }).strict(),
  response: z.object({
    id: id(),
    /** Accounts kept by hand that went back to the provider. */
    restoredAccounts: z.number().int(),
  }),
  status: 201,
  errors: CONNECTION_ERRORS,
  example: {
    body: { provider: "example", credentials: { token: "example-token" } },
    response: { id: CONNECTION_ID, restoredAccounts: 0 },
  },
});

export const disconnect = defineRoute({
  id: "disconnect",
  method: "DELETE",
  path: "/connections/{id}",
  scope: "write",
  capability: "connections",
  summary:
    "Disconnects: the credentials go, the accounts and movements stay. Also cancels a bank connection not finished.",
  actions: [],
  params: byId,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

export const syncNow = defineRoute({
  id: "sync_now",
  method: "POST",
  path: "/connections/{id}/sync",
  scope: "write",
  capability: "connections",
  summary: "«Update now»: a reading in the worker's queue. The answer does not wait; the run is in `runs`.",
  actions: [],
  params: byId,
  response: null,
  status: 202,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

export const testConnection = defineRoute({
  id: "test_connection",
  method: "POST",
  path: "/connections/{id}/test",
  scope: "write",
  capability: "connections",
  summary: "Tries the saved credentials against the provider and records the verdict.",
  actions: [],
  params: byId,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

export const rereadHistory = defineRoute({
  id: "reread_history",
  method: "POST",
  path: "/connections/{id}/history",
  scope: "write",
  capability: "connections",
  summary: "Reads the history again, `months` back: one of `capabilities.historyMonths`.",
  actions: [],
  params: byId,
  body: z.object({ months: z.number().int().min(1) }).strict(),
  response: null,
  status: 202,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID }, body: { months: 12 } },
});

export const resumeConnection = defineRoute({
  id: "resume_connection",
  method: "POST",
  path: "/connections/{id}/resume",
  scope: "write",
  capability: "connections",
  summary: "«Turn on again»: the provider's recommended schedule.",
  actions: [],
  params: byId,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

export const enableConnection = defineRoute({
  id: "enable_connection",
  method: "POST",
  path: "/connections/{id}/enable",
  scope: "write",
  capability: "connections",
  summary: "«Turn on» the plugin of the connection; each of its connections is read at once.",
  actions: [],
  params: byId,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

export const setSchedule = defineRoute({
  id: "set_schedule",
  method: "PUT",
  path: "/connections/{id}/schedule",
  scope: "write",
  capability: "connections",
  summary: "Saves when the connection is read: times in the person's zone. No rule is «only by hand».",
  actions: [],
  params: byId,
  body: schedule,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    body: { rules: [{ kind: "times", times: ["07:30"], days: { kind: "every" } }] },
  },
});

/** What is wrong with a schedule: the same codes the editor showed when the browser computed them. */
const scheduleProblem = z.discriminatedUnion("code", [
  /** Two passes closer than the minimum gap: the first pair met, on the wall clock of `day`. */
  z.object({ code: z.literal("tooFrequent"), day: civilDate(), first: timeOfDay, second: timeOfDay }),
  /** The rule at index `rule` never runs (a cron that names 31 February). */
  z.object({ code: z.literal("neverRuns"), rule: z.number().int().min(0) }),
  /** The rule at index `rule` is not one the server accepts (a cron field out of range). */
  z.object({ code: z.literal("invalidRule"), rule: z.number().int().min(0) }),
]);

export const previewSchedule = defineRoute({
  id: "preview_schedule",
  method: "POST",
  path: "/connections/{id}/schedule/preview",
  scope: "read",
  capability: "connections",
  summary:
    "The next passes of a schedule not saved yet, in the person's zone, and what is wrong with it. Saves nothing.",
  actions: [],
  params: byId,
  body: syncScheduleSchema,
  response: z.object({
    /** Empty when there is a problem, or when no rule is left («only by hand»). */
    next: z.array(instant()).max(SCHEDULE_PREVIEW_COUNT),
    problems: z.array(scheduleProblem),
  }),
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    body: { rules: [{ kind: "times", times: ["07:30"], days: { kind: "every" } }] },
    response: {
      next: ["2026-11-20T06:30:00.000Z", "2026-11-21T06:30:00.000Z"],
      problems: [],
    },
  },
});

const exposedAccount = z.object({
  providerAccountId: z.string(),
  name: z.string(),
  currency: z.string().length(3).nullable(),
  /** The name of the account here it arrives in; null when it is not here. */
  here: z.string().nullable(),
  chosen: z.boolean(),
});

export const listConnectionAccounts = defineRoute({
  id: "list_connection_accounts",
  method: "GET",
  path: "/connections/{id}/accounts",
  scope: "read",
  capability: "connections",
  summary: "The accounts the provider exposes now, and which of them the person chose.",
  actions: [],
  params: byId,
  response: z.object({ accounts: z.array(exposedAccount) }),
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    response: {
      accounts: [
        { providerAccountId: "acc-1", name: "Current account", currency: "EUR", here: null, chosen: false },
      ],
    },
  },
});

export const chooseConnectionAccounts = defineRoute({
  id: "choose_connection_accounts",
  method: "PUT",
  path: "/connections/{id}/accounts",
  scope: "write",
  capability: "connections",
  summary: "Chooses the accounts of a connection: a new account, an account here, or left out.",
  actions: [],
  params: byId,
  body: z
    .object({
      decisions: z
        .array(
          z.object({
            providerAccountId: z.string().min(1),
            target: z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("new"), name: z.string().trim().min(1).max(80), type: z.string() }),
              z.object({ kind: z.literal("existing"), accountId: id() }),
              z.object({ kind: z.literal("skip") }),
            ]),
          }),
        )
        .min(1),
    })
    .strict(),
  response: z.object({ added: z.number().int() }),
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    body: {
      decisions: [
        { providerAccountId: "acc-1", target: { kind: "new", name: "Current account", type: "checking" } },
      ],
    },
    response: { added: 1 },
  },
});
