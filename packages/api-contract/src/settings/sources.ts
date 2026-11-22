// Users and settings · what the pages of the sources read (rewrite plan R3): the steps «Accounts» and
// «Done» of a bank's connection, the person's plugins, the page of one source and the log of the
// readings. Reads only, with the numbers already counted: the client adds nothing up. No shape names
// a provider (rule M12) and no credential, key or session of a provider comes back.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, instant, money } from "../primitives";
import { byId, CONNECTION_ERRORS, CONNECTION_ID } from "./shared";

const ACCOUNT_ID = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

export const getBankChoice = defineRoute({
  id: "get_bank_choice",
  method: "GET",
  path: "/connections/{id}/choice",
  scope: "read",
  capability: "connections",
  summary:
    "The step «Accounts» of a bank's connection: the accounts the bank shares that are still to " +
    "choose, the ones already here, and where each can go. `409 complete`: nothing is left to choose.",
  actions: [],
  params: byId,
  /** `all=1`: the accounts left out before are offered again too. */
  query: z.object({ all: z.enum(["1"]).optional() }),
  response: z.object({
    bank: z.string(),
    /** False until the accounts are chosen the first time: the connection can still be cancelled. */
    chosen: z.boolean(),
    accounts: z.array(
      z.object({
        providerAccountId: z.string(),
        /** «Name · masked number · currency». Never the whole number. */
        legend: z.string(),
        currency: z.string(),
        /** The name a new account gets, unless the person writes another. */
        defaultName: z.string(),
        defaultType: z.string(),
        /** The account here with the same IBAN: it is not added twice. */
        ibanOwner: z.object({ id: id(), name: z.string(), manual: z.boolean() }).nullable(),
      }),
    ),
    /** The accounts of the bank already tied to an account here. */
    linked: z.array(z.object({ legend: z.string(), account: z.string() })),
    /** The accounts here a bank's account can be tied to. */
    existing: z.array(z.object({ id: id(), name: z.string(), currency: z.string(), archived: z.boolean() })),
    /** The accounts of another source that can move to the bank («the same account as…»). */
    sameAs: z.array(z.object({ id: id(), name: z.string(), currency: z.string(), source: z.string() })),
  }),
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    query: {},
    response: {
      bank: "Example Bank",
      chosen: false,
      accounts: [
        {
          providerAccountId: "acc-1",
          legend: "Example Bank checking · •••• 3456 · EUR",
          currency: "EUR",
          defaultName: "Example Bank checking",
          defaultType: "checking",
          ibanOwner: null,
        },
      ],
      linked: [],
      existing: [{ id: ACCOUNT_ID, name: "Cash", currency: "EUR", archived: false }],
      sameAs: [],
    },
  },
});

export const getBankOutcome = defineRoute({
  id: "get_bank_outcome",
  method: "GET",
  path: "/connections/{id}/outcome",
  scope: "read",
  capability: "connections",
  summary:
    "The step «Done» of a bank's connection: what the last reading did, account by account, how its " +
    "movements stand with the categories, and the accounts to switch. `409 not_chosen`: the accounts " +
    "are still to choose.",
  actions: [],
  params: byId,
  /** `same`: the pairs «bank account.account here» chosen as the same account, comma-separated. */
  query: z.object({ same: z.string().max(4000).optional() }),
  response: z.object({
    bank: z.string(),
    accounts: z.array(
      z.object({
        id: id(),
        name: z.string(),
        currency: z.string(),
        /** The movements read, and the day of the first; 0 and null before any. */
        movements: z.number().int(),
        firstOn: civilDate().nullable(),
        /** The balance today; null when none is known. */
        balance: money().nullable(),
        /** False: the bank no longer shares this account. */
        shared: z.boolean(),
      }),
    ),
    /** The accounts chosen as «the same account as…»: each one's switch starts from here. */
    switches: z.array(
      z.object({ bankAccountId: z.string(), accountId: id(), account: z.string(), legend: z.string() }),
    ),
    reading: z.object({
      failed: z.boolean(),
      /** Failed before any good reading. */
      neverRead: z.boolean(),
      /** The bank asked to wait until then. */
      retryAfter: instant().nullable(),
      /** The accounts the last reading could not read. */
      accountErrors: z.number().int(),
    }),
    categories: z.object({
      /** The movements of these accounts: `categorised + waiting`. */
      read: z.number().int(),
      categorised: z.number().int(),
      suggested: z.number().int(),
      open: z.number().int(),
      /** Still without a category: `suggested + open`. */
      waiting: z.number().int(),
      /** False: the person has no category yet. */
      any: z.boolean(),
    }),
    /** The accounts of the review of the movements («Review the categories»). */
    reviewAccountIds: z.array(id()),
    /** The access ends then. */
    expiresAt: instant().nullable(),
  }),
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    query: {},
    response: {
      bank: "Example Bank",
      accounts: [
        {
          id: ACCOUNT_ID,
          name: "Example Bank checking",
          currency: "EUR",
          movements: 42,
          firstOn: "2026-08-20",
          balance: "1250.00",
          shared: true,
        },
      ],
      switches: [],
      reading: { failed: false, neverRead: false, retryAfter: null, accountErrors: 0 },
      categories: { read: 42, categorised: 30, suggested: 8, open: 4, waiting: 12, any: true },
      reviewAccountIds: [ACCOUNT_ID],
      expiresAt: "2027-05-17T00:00:00.000Z",
    },
  },
});

export const listPlugins = defineRoute({
  id: "list_plugins",
  method: "GET",
  path: "/plugins",
  scope: "read",
  capability: "connections",
  summary:
    "The plugins of the instance as the person has them: on, paused (since when) or available, with " +
    "the state of the person's key. Never the key.",
  actions: [],
  response: z.object({
    plugins: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        state: z.enum(["active", "paused", "available"]),
        pausedSince: instant().nullable(),
        /** The person's connections of the plugin. */
        connections: z.number().int(),
        credentials: z.object({ saved: z.boolean(), savedAt: instant().nullable(), invalid: z.boolean() }),
        /** Where the provider sends the person back: what its application has to allow. */
        returnAddress: z.string(),
        /** The ISO codes a connection can be for (the manifest's `country` field); empty without one. */
        countries: z.array(z.string()),
      }),
    ),
  }),
  errors: [],
  example: {
    response: {
      plugins: [
        {
          id: "examplebank",
          name: "Example Banking",
          description: "Accounts from European banks",
          state: "active",
          pausedSince: null,
          connections: 1,
          credentials: { saved: true, savedAt: "2026-11-15T10:00:00.000Z", invalid: false },
          returnAddress: "https://ledgerly.example/api/v1/plugins/examplebank/callback",
          countries: ["DE", "IT"],
        },
      ],
    },
  },
});

export const getSource = defineRoute({
  id: "get_source",
  method: "GET",
  path: "/sources/{slug}",
  scope: "read",
  capability: "connections",
  summary:
    "The page of one source the person has: its accounts deleted here, what waits to be written to " +
    "it, and what «Disconnect» of each connection leaves.",
  actions: [],
  params: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) }),
  response: z.object({
    /** The connections' provider (`plugin:<id>` or a provider of the core). */
    provider: z.string(),
    /** The accounts of the source deleted here: «Bring back» offers them. */
    deletedAccounts: z.array(z.object({ externalId: z.string(), name: z.string().nullable() })),
    /** The movements waiting to be sent to the source, and the accounts they are on. */
    unsent: z.object({ count: z.number().int(), accountIds: z.array(id()) }),
    /** The days off waiting to be sent to the source. */
    pendingDays: z.number().int(),
    connections: z.array(
      z.object({
        id: id(),
        /** The accounts the access shares; null for a source that is not a plugin. */
        shared: z.number().int().nullable(),
        /** What «Disconnect» leaves: the accounts kept here, and the ones left out. */
        leave: z.object({ accounts: z.number().int(), excluded: z.number().int() }),
      }),
    ),
  }),
  errors: ["not_found"],
  example: {
    params: { slug: "examplebank" },
    response: {
      provider: "plugin:examplebank",
      deletedAccounts: [],
      unsent: { count: 0, accountIds: [] },
      pendingDays: 0,
      connections: [{ id: CONNECTION_ID, shared: 2, leave: { accounts: 2, excluded: 0 } }],
    },
  },
});

export const listConnectionRuns = defineRoute({
  id: "list_connection_runs",
  method: "GET",
  path: "/connections/runs",
  scope: "read",
  capability: "connections",
  summary:
    "The log of the readings of the last 30 days, newest first: of one connection with `connectionId`, " +
    "of all of them without. Never what a provider said: a code of the closed list only.",
  actions: [],
  query: z.object({
    connectionId: id().optional(),
    /** 50 by default, 200 at most. */
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .optional(),
  }),
  response: z.object({
    runs: z.array(
      z.object({
        id: id(),
        connectionId: id(),
        kind: z.string(),
        state: z.enum(["running", "success", "failed", "skipped"]),
        origin: z.string().nullable(),
        errorCode: z.string().nullable(),
        counts: z.record(z.string(), z.number().int()).nullable(),
        httpStatus: z.number().int().nullable(),
        appVersion: z.string().nullable(),
        startedAt: instant(),
        finishedAt: instant().nullable(),
      }),
    ),
    /** There are older runs than these. */
    more: z.boolean(),
  }),
  errors: ["not_found"],
  example: {
    query: { limit: "50" },
    response: {
      runs: [
        {
          id: ACCOUNT_ID,
          connectionId: CONNECTION_ID,
          kind: "transactions",
          state: "success",
          origin: "auto",
          errorCode: null,
          counts: { created: 3 },
          httpStatus: 200,
          appVersion: "0.57.0",
          startedAt: "2026-11-18T07:00:00.000Z",
          finishedAt: "2026-11-18T07:00:04.000Z",
        },
      ],
      more: false,
    },
  },
});
