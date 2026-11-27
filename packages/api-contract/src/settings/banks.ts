// Users and settings · banks, sources and plugins (rewrite plan R2, 05-refactor.md §5.5): the access
// to a bank, turning a source off, and a plugin's application. A key goes in and never comes back.
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";
import { byId, CONNECTION_ERRORS, CONNECTION_ID } from "./shared";

const bankRedirect = z.object({
  /** Where the person gives the bank access, `https:` only; it comes back to the instance. */
  url: z.url({ protocol: /^https$/ }),
});

export const listBanks = defineRoute({
  id: "list_banks",
  method: "GET",
  path: "/banks",
  scope: "read",
  capability: "connections",
  summary: "The banks of a country the bank plugin can connect.",
  actions: [],
  query: z.object({ country: z.string().regex(/^[A-Z]{2}$/) }),
  response: z.object({
    banks: z.array(
      z.object({ name: z.string(), maxAccessDays: z.number().int().nullable(), connected: z.boolean() }),
    ),
  }),
  errors: ["invalid", "conflict"],
  example: {
    query: { country: "IT" },
    response: { banks: [{ name: "Example Bank", maxAccessDays: 180, connected: false }] },
  },
});

export const startBankAccess = defineRoute({
  id: "start_bank_access",
  method: "POST",
  path: "/banks/access",
  scope: "write",
  capability: "connections",
  summary: "Starts the access to a bank: the answer is the bank's page.",
  actions: [],
  body: z.object({ country: z.string().regex(/^[A-Z]{2}$/), name: z.string().min(1).max(200) }).strict(),
  response: bankRedirect,
  status: 201,
  errors: ["invalid", "conflict"],
  example: {
    body: { country: "IT", name: "Example Bank" },
    response: { url: "https://bank.example.test/authorize?state=example" },
  },
});

export const renewBankAccess = defineRoute({
  id: "renew_bank_access",
  method: "POST",
  path: "/connections/{id}/renew",
  scope: "write",
  capability: "connections",
  summary: "Renews the access to a bank before or after it ends: the answer is the bank's page.",
  actions: [],
  params: byId,
  response: bankRedirect,
  errors: CONNECTION_ERRORS,
  example: {
    params: { id: CONNECTION_ID },
    response: { url: "https://bank.example.test/authorize?state=example" },
  },
});

export const readBankNow = defineRoute({
  id: "read_bank_now",
  method: "POST",
  path: "/connections/{id}/read",
  scope: "write",
  capability: "connections",
  summary:
    "Tries the first reading of a bank again, now, after a refusal. `204` only when the reading ran. " +
    "A reading refused is `409` with a `reason` of the closed list of a run: `busy` (a reading of this " +
    "connection is already in progress), `not_active`, `pending` (the accounts are not chosen yet), " +
    "`unavailable` (the plugin does not answer), `auth`, `consent_expired`, `rate_limited`, " +
    "`provider_down`, `invalid_data`, `failed`.",
  actions: [],
  params: byId,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { id: CONNECTION_ID } },
});

const bySource = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

export const getSourceDeactivation = defineRoute({
  id: "get_source_deactivation",
  method: "GET",
  path: "/sources/{slug}/deactivation",
  scope: "read",
  capability: "connections",
  summary:
    "What turning a source off changes, before it is turned off: also for a plugin that is off and " +
    "still has data here (`needs_cleanup` of `GET /plugins`, H56).",
  actions: [],
  params: bySource,
  response: z.object({
    accounts: z.number().int(),
    categories: z.number().int(),
    rules: z.number().int(),
    unsent: z.number().int(),
    pendingDays: z.number().int(),
    /** The movements on those accounts: they stay, kept by hand (H56). */
    movements: z.number().int(),
    /** The person has credentials saved for the plugin: the dialog says they go (H56). */
    credentials: z.boolean(),
  }),
  errors: ["not_found"],
  example: {
    params: { slug: "enablebanking" },
    response: {
      accounts: 2,
      categories: 5,
      rules: 1,
      unsent: 0,
      pendingDays: 0,
      movements: 120,
      credentials: true,
    },
  },
});

export const deactivateSource = defineRoute({
  id: "deactivate_source",
  method: "POST",
  path: "/sources/{slug}/deactivate",
  scope: "write",
  capability: "connections",
  summary:
    "Turns a source off after a last reading: its accounts are kept by hand from now. A plugin that is " +
    "off is turned off too while it still has data here (`needs_cleanup`, H56). `409` `reason`: " +
    "`not_active` (off, nothing to convert), `reading_in_progress` (with `startedAt`; a reading older " +
    "than 15 minutes stops with `stopReading`), `plugin_down` (the accesses cannot be closed at the " +
    "provider: `force` turns it off all the same), `not_turned_off` (anything else: nothing changed).",
  actions: [],
  params: bySource,
  /** Optional: no body is the turn-off as before. */
  body: z
    .object({
      /** Turn off even when the plugin does not answer: the person closes the access at the provider. */
      force: z.boolean().optional(),
      /** Stop a reading that started more than 15 minutes ago, then turn off (H56, D3 = A). */
      stopReading: z.boolean().optional(),
    })
    .strict()
    .optional(),
  response: z.object({ accounts: z.number().int() }),
  errors: ["not_found", "conflict"],
  example: { params: { slug: "enablebanking" }, body: {}, response: { accounts: 2 } },
});

export const resumeSourceAccount = defineRoute({
  id: "resume_source_account",
  method: "POST",
  path: "/sources/{slug}/accounts/{externalId}/resume",
  scope: "write",
  capability: "connections",
  summary:
    "Brings back an account deleted here: the source may bring it again. A bank's account is chosen again on `reconnect`.",
  actions: [],
  params: z.object({ slug: bySource.shape.slug, externalId: z.string().min(1).max(200) }),
  response: z.object({
    /** The connection whose accounts are chosen again; null when the source reads it by itself. */
    reconnect: id().nullable(),
  }),
  errors: ["not_found", "conflict"],
  example: { params: { slug: "enablebanking", externalId: "acc-1" }, response: { reconnect: CONNECTION_ID } },
});

const byPlugin = z.object({ pluginId: z.string().regex(/^[a-z0-9-]{1,64}$/) });

// A plugin's application and its state are the web's session only, as the keys of a broker are: a
// token that replaced them would send the next bank authorisation to another application.

export const setPluginActive = defineRoute({
  id: "set_plugin_active",
  method: "PATCH",
  path: "/plugins/{pluginId}",
  scope: "session",
  capability: "connections",
  summary:
    "Turns a plugin on or off for the person. `404`: the instance has no such plugin, the refusal " +
    "`not_available` of «Activate» (H56).",
  actions: [],
  params: byPlugin,
  body: z.object({ active: z.boolean() }).strict(),
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { pluginId: "enablebanking" }, body: { active: true } },
});

export const savePluginCredentials = defineRoute({
  id: "save_plugin_credentials",
  method: "PUT",
  path: "/plugins/{pluginId}/credentials",
  scope: "session",
  capability: "connections",
  summary: "Checks and saves the credentials of a plugin's application. The key never comes back.",
  actions: [],
  params: byPlugin,
  body: z.object({ applicationId: z.string().max(200), privateKey: z.string().max(16384) }).strict(),
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: {
    params: { pluginId: "enablebanking" },
    body: {
      applicationId: "00000000-0000-4000-8000-000000000000",
      privateKey: "-----BEGIN PRIVATE KEY-----…",
    },
  },
});

export const removePluginCredentials = defineRoute({
  id: "remove_plugin_credentials",
  method: "DELETE",
  path: "/plugins/{pluginId}/credentials",
  scope: "session",
  capability: "connections",
  summary: "Removes the credentials of a plugin's application.",
  actions: [],
  params: byPlugin,
  response: null,
  status: 204,
  errors: CONNECTION_ERRORS,
  example: { params: { pluginId: "enablebanking" } },
});
