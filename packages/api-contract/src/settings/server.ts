// Users and settings · Admin › Server (rewrite plan R2, spec §7.10): the AI service, the sign-in
// provider, the mail transport, the backups and the jobs. Behind the scope `admin` AND the admin
// role. A secret goes in and never comes back: a view carries a hint (`…a1b2`), never the value.
// E8 (10-modularity.md §10.11): the name of the sign-in and the AI service are settings, not code.
import { z } from "zod";
import { defineRoute } from "../route";
import { instant } from "../primitives";

/** The AI services Ledgerly can read a document with: one today (spec D18). */
const AI_PROVIDERS = ["openai"] as const;

const llm = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string(),
  keyHint: z.string(),
  updatedAt: instant(),
});

const oidcOutcome = z.enum(["ok", "invalidDocument", "issuerMismatch", "unreachable"]);

const oidc = z.object({
  issuer: z.string(),
  clientId: z.string(),
  adminGroup: z.string(),
  /** What the sign-in button says; null keeps the text of today. */
  displayName: z.string().nullable(),
  secretHint: z.string(),
  /** False while nothing is saved: the values come from the environment of the instance. */
  saved: z.boolean(),
  updatedAt: instant().nullable(),
  lastCheck: z.object({ outcome: oidcOutcome, checkedAt: instant() }).nullable(),
});

const mailPolicy = z.object({
  invitations: z.boolean(),
  syncAlerts: z.boolean(),
  monthlySummary: z.boolean(),
});

const smtp = z.object({
  host: z.string(),
  port: z.number().int(),
  encryption: z.enum(["ssl", "starttls", "none"]),
  user: z.string(),
  passwordHint: z.string(),
  from: z.string(),
  policy: mailPolicy,
  saved: z.boolean(),
  updatedAt: instant().nullable(),
});

const SERVER_EXAMPLE = {
  llm: null,
  oidc: {
    issuer: "https://sso.example.test/application/o/ledgerly/",
    clientId: "ledgerly",
    adminGroup: "ledgerly-admins",
    displayName: null,
    secretHint: "…a1b2",
    saved: true,
    updatedAt: "2026-11-01T10:00:00.000Z",
    lastCheck: { outcome: "ok", checkedAt: "2026-11-18T07:10:00.000Z" },
  },
  smtp: {
    host: "mail.example.test",
    port: 587,
    encryption: "starttls",
    user: "ledgerly",
    passwordHint: "…c3d4",
    from: "Ledgerly <ledgerly@example.test>",
    policy: { invitations: true, syncAlerts: true, monthlySummary: true },
    saved: true,
    updatedAt: "2026-11-01T10:00:00.000Z",
  },
  maintenance: {
    version: "0.37.0",
    postgres: "18.1",
    lastBackup: { at: "2026-11-18T03:00:00.000Z", size: 1048576 },
    backupsKept: 7,
    lastExport: null,
  },
};

export const getServerSettings = defineRoute({
  id: "get_server_settings",
  method: "GET",
  path: "/server/settings",
  scope: "admin",
  capability: "server",
  summary: "The AI service, the sign-in provider, the mail transport and the maintenance facts. No secret.",
  actions: [],
  response: z.object({
    llm: llm.nullable(),
    oidc,
    smtp,
    maintenance: z.object({
      version: z.string(),
      postgres: z.string().nullable(),
      lastBackup: z.object({ at: instant(), size: z.number().int() }).nullable(),
      backupsKept: z.number().int(),
      lastExport: instant().nullable(),
    }),
  }),
  errors: [],
  example: { response: SERVER_EXAMPLE },
});

export const saveLlm = defineRoute({
  id: "save_llm",
  method: "PUT",
  path: "/server/llm",
  scope: "admin",
  capability: "server",
  summary:
    "Saves the AI service that reads a document when its reader cannot. An empty key keeps the saved one.",
  actions: ["saveLlmFallbackAction"],
  body: z
    .object({
      provider: z.enum(AI_PROVIDERS).default("openai"),
      model: z.string().trim().min(2).max(64),
      apiKey: z.string().max(200),
    })
    .strict(),
  response: null,
  status: 204,
  errors: ["invalid"],
  example: { body: { provider: "openai", model: "gpt-5-mini", apiKey: "" } },
});

export const testLlm = defineRoute({
  id: "test_llm",
  method: "POST",
  path: "/server/llm/test",
  scope: "admin",
  capability: "server",
  summary: "Tries the saved key and model. Saves nothing; the service's answer is never quoted.",
  actions: ["testLlmFallbackAction"],
  response: z.object({
    outcome: z.enum(["ok", "keyRejected", "modelMissing", "rateLimited", "notConfigured", "unreachable"]),
    /** Only with `ok`: the model that was saved. */
    model: z.string().optional(),
  }),
  errors: [],
  example: { response: { outcome: "ok", model: "gpt-5-mini" } },
});

export const removeLlm = defineRoute({
  id: "remove_llm",
  method: "DELETE",
  path: "/server/llm",
  scope: "admin",
  capability: "server",
  summary: "Removes the AI service and its key.",
  actions: ["removeLlmFallbackAction"],
  response: null,
  status: 204,
  errors: [],
  example: {},
});

export const saveOidc = defineRoute({
  id: "save_oidc",
  method: "PUT",
  path: "/server/oidc",
  scope: "admin",
  capability: "server",
  summary: "Saves the sign-in provider. A new issuer signs everyone out (`signedEveryoneOut`).",
  actions: ["saveOidcAction"],
  body: z
    .object({
      issuer: z.url().max(200),
      clientId: z.string().trim().min(1).max(200),
      /** Empty keeps the saved secret. */
      clientSecret: z.string().max(200),
      adminGroup: z.string().trim().min(1).max(200),
      displayName: z.string().trim().min(1).max(60).nullable().optional(),
    })
    .strict(),
  response: z.object({ signedEveryoneOut: z.boolean() }),
  errors: ["invalid"],
  example: {
    body: {
      issuer: "https://sso.example.test/application/o/ledgerly/",
      clientId: "ledgerly",
      clientSecret: "",
      adminGroup: "ledgerly-admins",
      displayName: "Example SSO",
    },
    response: { signedEveryoneOut: false },
  },
});

export const testOidc = defineRoute({
  id: "test_oidc",
  method: "POST",
  path: "/server/oidc/test",
  scope: "admin",
  capability: "server",
  summary: "Reads the discovery document of the saved provider and records the verdict.",
  actions: ["testOidcAction"],
  response: z.object({ outcome: oidcOutcome }),
  errors: [],
  example: { response: { outcome: "ok" } },
});

export const removeOidc = defineRoute({
  id: "remove_oidc",
  method: "DELETE",
  path: "/server/oidc",
  scope: "admin",
  capability: "server",
  summary: "Removes the saved provider: the values of the environment apply again.",
  actions: ["removeOidcAction"],
  response: null,
  status: 204,
  errors: [],
  example: {},
});

export const saveSmtp = defineRoute({
  id: "save_smtp",
  method: "PUT",
  path: "/server/smtp",
  scope: "admin",
  capability: "server",
  summary: "Saves the mail transport and which emails go out. An empty password keeps the saved one.",
  actions: ["saveSmtpAction"],
  body: z
    .object({
      host: z.string().trim().min(1).max(200),
      port: z.number().int().min(1).max(65535),
      encryption: z.enum(["ssl", "starttls", "none"]),
      user: z.string().trim().max(200),
      password: z.string().max(200),
      from: z.string().trim().min(3).max(200),
      invitations: z.boolean(),
      syncAlerts: z.boolean(),
      monthlySummary: z.boolean(),
    })
    .strict(),
  response: null,
  status: 204,
  errors: ["invalid"],
  example: {
    body: {
      host: "mail.example.test",
      port: 587,
      encryption: "starttls",
      user: "ledgerly",
      password: "",
      from: "Ledgerly <ledgerly@example.test>",
      invitations: true,
      syncAlerts: true,
      monthlySummary: true,
    },
  },
});

export const testSmtp = defineRoute({
  id: "test_smtp",
  method: "POST",
  path: "/server/smtp/test",
  scope: "admin",
  capability: "server",
  summary: "Sends one email to the admin who asked, through the transport as it is saved.",
  actions: ["sendTestEmailAction"],
  response: z.object({
    outcome: z.enum(["ok", "noAddress", "failed"]),
    /** With `ok`: where it went. */
    to: z.string().optional(),
    /** With `failed`: the error code of the transport, never its message. */
    reason: z.string().optional(),
  }),
  errors: [],
  example: { response: { outcome: "ok", to: "alex@example.test" } },
});

export const removeSmtp = defineRoute({
  id: "remove_smtp",
  method: "DELETE",
  path: "/server/smtp",
  scope: "admin",
  capability: "server",
  summary: "Removes the saved transport: the values of the environment apply again.",
  actions: ["removeSmtpAction"],
  response: null,
  status: 204,
  errors: [],
  example: {},
});

export const backUpNow = defineRoute({
  id: "back_up_now",
  method: "POST",
  path: "/server/backups",
  scope: "admin",
  capability: "server",
  summary: "Makes a backup of the database now and answers its size in bytes.",
  actions: ["backupNowAction"],
  response: z.object({ size: z.number().int() }),
  status: 201,
  errors: ["conflict", "server_error"],
  example: { response: { size: 1048576 } },
});

const job = z.object({
  name: z.string(),
  tier: z.enum(["minute", "hourly", "daily", "monthly", "manual", "afterSync"]),
  lastRun: z
    .object({
      startedAt: instant(),
      finishedAt: instant().nullable(),
      status: z.enum(["running", "success", "failed", "skipped"]),
      error: z.string().nullable(),
    })
    .nullable(),
});

export const listJobs = defineRoute({
  id: "list_jobs",
  method: "GET",
  path: "/server/jobs",
  scope: "admin",
  capability: "server",
  summary: "Every job of the worker with its last run.",
  actions: [],
  response: z.object({ jobs: z.array(job) }),
  errors: [],
  example: {
    response: {
      jobs: [
        {
          name: "fx-rates",
          tier: "daily",
          lastRun: {
            startedAt: "2026-11-18T05:00:00.000Z",
            finishedAt: "2026-11-18T05:00:02.000Z",
            status: "success",
            error: null,
          },
        },
      ],
    },
  },
});

export const runJob = defineRoute({
  id: "run_job",
  method: "POST",
  path: "/server/jobs/{name}/run",
  scope: "admin",
  capability: "server",
  summary: "Puts one job in the worker's queue. The answer does not wait: the run is in `GET /server/jobs`.",
  actions: ["runJobAction"],
  params: z.object({ name: z.string().min(1).max(64) }),
  response: null,
  status: 202,
  errors: ["not_found"],
  example: { params: { name: "fx-rates" } },
});
