// The connection of a service to its provider (rewrite plan R2, 05-refactor.md §5.5 «investments»;
// docs/design/investments.md §4.2, §4.3, §5): connect, sync, the key's check, replacement and
// revocation, the disconnection. A key travels only in, to the session's routes, and never back.
import { z } from "zod";
import { id } from "../primitives";
import { defineRoute } from "../route";
import { connectBody, keyBody } from "./bodies";
import { ACCOUNT_ID, byService, INVESTMENT_ERRORS } from "./shared";

export const connectProvider = defineRoute({
  id: "connect_investment_provider",
  method: "POST",
  path: "/investments/connections",
  scope: "session",
  capability: "investments",
  summary:
    "Connects a provider's read-only key to an investment or crypto account: checks the key, reads the " +
    "first value and queues the history. `ipRestricted` null: the provider does not say.",
  actions: ["connectProviderAction"],
  body: connectBody,
  response: z.object({ accountId: id(), ipRestricted: z.boolean().nullable() }),
  status: 201,
  errors: INVESTMENT_ERRORS,
  example: {
    body: {
      provider: "etoro",
      credentials: { api_key: "example-public-key", user_key: "example-user-key" },
      target: { kind: "existing", accountId: ACCOUNT_ID },
    },
    response: { accountId: ACCOUNT_ID, ipRestricted: null },
  },
});

export const syncNow = defineRoute({
  id: "sync_investment",
  method: "POST",
  path: "/investments/{accountId}/sync",
  scope: "write",
  capability: "investments",
  summary:
    "«Sync now»: queues a pass of the service's connection and answers before the provider does. " +
    "`cooldown` within a minute of the last pass.",
  actions: ["syncNowAction"],
  params: byService,
  response: null,
  status: 202,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID } },
});

export const checkKey = defineRoute({
  id: "check_investment_key",
  method: "POST",
  path: "/investments/{accountId}/key/check",
  scope: "write",
  capability: "investments",
  summary:
    "Checks the key at the provider and records the result. `not_read_only` when it is not provably " +
    "read-only (it can write, or the provider cannot say).",
  actions: ["verifyKeyAction"],
  params: byService,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID } },
});

export const replaceKey = defineRoute({
  id: "replace_investment_key",
  method: "PUT",
  path: "/investments/{accountId}/key",
  scope: "session",
  capability: "investments",
  summary: "Replaces the key of a connected service; the old one waits to be confirmed revoked.",
  actions: ["replaceKeyAction"],
  params: byService,
  body: keyBody,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: {
    params: { accountId: ACCOUNT_ID },
    body: { credentials: { api_key: "example-public-key", user_key: "example-user-key" } },
  },
});

export const disconnectProvider = defineRoute({
  id: "disconnect_investment_provider",
  method: "DELETE",
  path: "/investments/{accountId}/connection",
  scope: "write",
  capability: "investments",
  summary: "Disconnects the provider: the service becomes manual and keeps its history.",
  actions: ["disconnectProviderAction"],
  params: byService,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID } },
});

export const confirmKeyRevoked = defineRoute({
  id: "confirm_investment_key_revoked",
  method: "POST",
  path: "/investments/{accountId}/key/revoked",
  scope: "write",
  capability: "investments",
  summary: "Confirms that the retired keys were deleted at the provider.",
  actions: ["confirmKeyRevokedAction"],
  params: byService,
  response: null,
  status: 204,
  errors: INVESTMENT_ERRORS,
  example: { params: { accountId: ACCOUNT_ID } },
});
