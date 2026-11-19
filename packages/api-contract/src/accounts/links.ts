// Accounts · what hangs off an account (rewrite plan R2, 05-refactor.md §5.5; spec §7.1, owner
// 2026-09-21): the direct debits and standing orders on its IBAN, what is charged to its card. The
// domain calls them «connections» (`account_connections`); on the wire they are under the account,
// apart from the connections to a provider (`/connections`).
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";
import { ACCOUNT_ERRORS, ACCOUNT_ID, byAccount, CONNECTION_CHANNELS } from "./shared";

const LINK_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

const link = z.object({
  id: id(),
  channel: z.enum(CONNECTION_CHANNELS),
  name: z.string(),
  note: z.string().nullable(),
});

const linkInput = z
  .object({
    channel: z.enum(CONNECTION_CHANNELS),
    name: z.string().trim().min(1).max(60),
    note: z.string().max(120).nullable().optional(),
  })
  .strict();

const LINK_EXAMPLE = { id: LINK_ID, channel: "iban", name: "Electricity", note: "Direct debit, monthly" };
const byLink = z.object({ id: id(), linkId: id() });

export const listAccountLinks = defineRoute({
  id: "list_account_links",
  method: "GET",
  path: "/accounts/{id}/links",
  scope: "read",
  capability: "accounts",
  summary: "What hangs off an account: direct debits on its IBAN, charges on its card.",
  actions: [],
  params: byAccount,
  response: z.object({ links: z.array(link) }),
  errors: ["invalid", "not_found"],
  example: { params: { id: ACCOUNT_ID }, response: { links: [LINK_EXAMPLE] } },
});

export const addAccountLink = defineRoute({
  id: "add_account_link",
  method: "POST",
  path: "/accounts/{id}/links",
  scope: "write",
  capability: "accounts",
  summary: "Adds what hangs off an account; the same name twice on one channel is `conflict`.",
  actions: ["addConnectionAction"],
  params: byAccount,
  body: linkInput,
  response: link,
  status: 201,
  errors: ACCOUNT_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { channel: "iban", name: "Electricity", note: "Direct debit, monthly" },
    response: LINK_EXAMPLE,
  },
});

export const updateAccountLink = defineRoute({
  id: "update_account_link",
  method: "PUT",
  path: "/accounts/{id}/links/{linkId}",
  scope: "write",
  capability: "accounts",
  summary: "Changes what hangs off an account.",
  actions: ["updateConnectionAction"],
  params: byLink,
  body: linkInput,
  response: link,
  errors: ACCOUNT_ERRORS,
  example: {
    params: { id: ACCOUNT_ID, linkId: LINK_ID },
    body: { channel: "card", name: "Streaming", note: null },
    response: { id: LINK_ID, channel: "card", name: "Streaming", note: null },
  },
});

export const removeAccountLink = defineRoute({
  id: "remove_account_link",
  method: "DELETE",
  path: "/accounts/{id}/links/{linkId}",
  scope: "write",
  capability: "accounts",
  summary: "Removes what hangs off an account.",
  actions: ["removeConnectionAction"],
  params: byLink,
  response: null,
  status: 204,
  errors: ["invalid", "not_found"],
  example: { params: { id: ACCOUNT_ID, linkId: LINK_ID } },
});
