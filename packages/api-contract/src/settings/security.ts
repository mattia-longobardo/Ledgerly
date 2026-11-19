// Users and settings · security (rewrite plan R2, 07-apps.md §7.3): the person's sessions, Client
// APIs and connected apps. Behind the scope `security`, which no self-registered client can ask for
// and which exists only with the change of the authorization server (git-policy §6 #4): today
// nothing under `/api/v1` mints or revokes a credential.
import { z } from "zod";
import { defineRoute } from "../route";
import { id, instant } from "../primitives";
import { CONTRACT_SCOPES } from "../scopes";

const session = z.object({
  id: id(),
  /** Read from the user agent; null when it names neither. */
  browser: z.string().nullable(),
  os: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: instant(),
  /** The session of the cookie that made this call; always false for a Bearer token. */
  current: z.boolean(),
});

export const listSessions = defineRoute({
  id: "list_sessions",
  method: "GET",
  path: "/sessions",
  scope: "security",
  capability: "security",
  summary: "The person's open sign-ins on the web, newest first. Never a session token.",
  actions: [],
  response: z.object({ sessions: z.array(session) }),
  errors: [],
  example: {
    response: {
      sessions: [
        {
          id: "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e",
          browser: "Firefox",
          os: "Linux",
          ipAddress: "192.0.2.10",
          createdAt: "2026-11-18T08:00:00.000Z",
          current: true,
        },
      ],
    },
  },
});

export const getSignIn = defineRoute({
  id: "get_sign_in",
  method: "GET",
  path: "/security/sign-in",
  scope: "security",
  capability: "security",
  summary:
    "How the person signs in: password, identity provider (its origin only) and the instance's second-factor policy.",
  actions: [],
  response: z.object({
    password: z.boolean(),
    sso: z.boolean(),
    /** The origin of the instance's identity provider (`https://host`), never its path or client. */
    identityProvider: z.string().nullable(),
    twoFactorPolicy: z.enum(["required", "optional"]),
  }),
  errors: [],
  example: {
    response: {
      password: true,
      sso: false,
      identityProvider: "https://sso.example.test",
      twoFactorPolicy: "required",
    },
  },
});

export const revokeSession = defineRoute({
  id: "revoke_session",
  method: "DELETE",
  path: "/sessions/{id}",
  scope: "security",
  capability: "security",
  summary: "Signs one session out. A session that is not the person's answers as one already gone.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["invalid"],
  example: { params: { id: "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e" } },
});

const apiClient = z.object({
  clientId: z.string(),
  name: z.string(),
  scopes: z.array(z.enum(CONTRACT_SCOPES)),
  createdAt: instant(),
  disabled: z.boolean(),
});

export const listApiClients = defineRoute({
  id: "list_api_clients",
  method: "GET",
  path: "/api-clients",
  scope: "security",
  capability: "security",
  summary: "The person's Client APIs (client credentials), newest first. Never a secret.",
  actions: [],
  response: z.object({ clients: z.array(apiClient) }),
  errors: [],
  example: {
    response: {
      clients: [
        {
          clientId: "lc_example",
          name: "Home Assistant",
          scopes: ["read"],
          createdAt: "2026-11-01T10:00:00.000Z",
          disabled: false,
        },
      ],
    },
  },
});

export const createApiClient = defineRoute({
  id: "create_api_client",
  method: "POST",
  path: "/api-clients",
  scope: "security",
  capability: "security",
  summary: "Creates a Client API and answers its secret once: only its hash is kept.",
  actions: ["createApiClientAction"],
  body: z
    .object({
      name: z.string().trim().min(1).max(60),
      scopes: z.array(z.enum(["read", "write", "imports", "investments:read"])).min(1),
    })
    .strict(),
  response: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    tokenEndpoint: z.url(),
    resource: z.url(),
  }),
  status: 201,
  errors: ["invalid"],
  example: {
    body: { name: "Home Assistant", scopes: ["read"] },
    response: {
      clientId: "lc_example",
      clientSecret: "example-secret",
      tokenEndpoint: "https://ledgerly.example.test/api/auth/oauth2/token",
      resource: "https://ledgerly.example.test/api/v1",
    },
  },
});

export const deleteApiClient = defineRoute({
  id: "delete_api_client",
  method: "DELETE",
  path: "/api-clients/{clientId}",
  scope: "security",
  capability: "security",
  summary: "Deletes one of the person's Client APIs; its tokens stop working at once.",
  actions: [],
  params: z.object({ clientId: z.string().min(1) }),
  response: null,
  status: 204,
  errors: ["not_found"],
  example: { params: { clientId: "lc_example" } },
});

const connectedApp = z.object({
  clientId: z.string(),
  name: z.string(),
  hosts: z.array(z.string()),
  /** A client a person made in Settings; a self-registered one is not verified. */
  verified: z.boolean(),
  scopes: z.array(z.enum(CONTRACT_SCOPES)),
  /** It holds a refresh token. */
  offline: z.boolean(),
  createdAt: instant(),
});

export const listConnectedApps = defineRoute({
  id: "list_connected_apps",
  method: "GET",
  path: "/connected-apps",
  scope: "security",
  capability: "security",
  summary: "The apps the person gave consent to, oldest first: the devices of the apps among them.",
  actions: [],
  response: z.object({ apps: z.array(connectedApp) }),
  errors: [],
  example: {
    response: {
      apps: [
        {
          clientId: "mcp_example",
          name: "Assistant",
          hosts: ["assistant.example.test"],
          verified: false,
          scopes: ["read"],
          offline: true,
          createdAt: "2026-11-02T10:00:00.000Z",
        },
      ],
    },
  },
});

export const revokeConnectedApp = defineRoute({
  id: "revoke_connected_app",
  method: "DELETE",
  path: "/connected-apps/{clientId}",
  scope: "security",
  capability: "security",
  summary: "Takes a consent back: the app's refresh tokens go, and its next sign-in asks again.",
  actions: [],
  params: z.object({ clientId: z.string().min(1) }),
  response: null,
  status: 204,
  errors: ["not_found"],
  example: { params: { clientId: "mcp_example" } },
});
